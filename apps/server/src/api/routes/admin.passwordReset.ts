import type express from 'express';
import { z } from 'zod';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { requireAuth, requireSuperAdmin, requireMembership, getTenantFromReq } from '../utils/authHelpers.js';
import { buildPublicWebLink, requirePublicWebBase } from '../utils/publicLinks.js';
import {
  issuePasswordResetToken,
  revokePasswordResetToken,
  PASSWORD_RESET_TTL_MINUTES,
} from '../utils/passwordResetTokens.js';
import { renderPasswordResetMail } from '../utils/passwordResetMail.js';
import { deliveringEmailModule } from '../utils/emailProof.js';

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Admin endpoint that creates a password-reset token for a user.
 * A global SuperAdmin receives the token in the response for out-of-band
 * handover. A tenant owner/admin triggers a reset mail to the user instead
 * and receives only a delivery confirmation.
 *
 * This is the FALLBACK path, kept for managed tenants and for users with no
 * reachable mailbox. The primary path is self-service: POST /auth/forgot mails
 * the user a link (see routes/auth.password.ts). Both issue the token through
 * the same module, so a token from either path behaves identically.
 *
 * Authorisation: a global SuperAdmin, OR a tenant owner/admin for users
 * in their own tenant.
 */
// Returns true when allowed.
async function authorizeTenantAdminReset(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
  actorUserId: string,
  targetUserId: string,
): Promise<boolean> {
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return false;
  }
  const membership = await requireMembership(req, actorUserId, prisma);
  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  const targetMembership = await prisma.membership.findFirst({
    where: { userId: targetUserId, tenantId: tenant.id },
  });
  if (!targetMembership) {
    res.status(403).json({ error: 'user_not_in_tenant' });
    return false;
  }
  const memberships = await prisma.membership.count({
    where: { userId: targetUserId },
  });
  if (targetMembership.role === 'owner' || memberships > 1) {
    res.status(403).json({ error: 'platform_admin_required' });
    return false;
  }
  return true;
}

async function deliverResetMail(
  prisma: PrismaClient,
  mail: Awaited<ReturnType<typeof deliveringEmailModule>>,
  target: { email: string; name: string | null; locale: string },
  token: string,
  resetUrl: string,
  res: express.Response,
): Promise<void> {
  let sent = false;
  try {
    sent =
      !!mail &&
      (await mail.sendRaw(
        renderPasswordResetMail({
          to: target.email,
          name: target.name ?? '',
          resetUrl,
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
          locale: target.locale === 'en' ? 'en' : 'de',
        }),
      ));
  } catch {
    // Do not log provider messages containing mail data.
  }
  if (!sent) {
    try {
      await revokePasswordResetToken(prisma, token);
    } catch {
      // Best effort: the 503 below is the contract, not the cleanup.
    }
    res.status(503).json({
      code: 'EMAIL_DELIVERY_UNAVAILABLE',
      error: 'Password reset email could not be delivered.',
    });
    return;
  }
  res.json({ ok: true, sent: true });
}

async function handleAdminCreateResetToken(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parse = paramsSchema.safeParse(req.params);
  if (!parse.success) {
    res.status(400).json({ error: 'invalid_user_id' });
    return;
  }
  const targetUserId = parse.data.id;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, name: true, locale: true },
  });
  if (!target) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }

  const isSuperAdmin = await requireSuperAdmin(req, prisma);
  if (!isSuperAdmin && !(await authorizeTenantAdminReset(prisma, req, res, auth.userId, targetUserId))) {
    return;
  }

  // Shared issuer (api/utils/passwordResetTokens.ts): stores the token hashed
  // and drops the user's previous unused token, so only one valid reset link
  // per user exists. It MUST be used here — a hand-rolled row would store a
  // plaintext token that POST /auth/reset can no longer match.
  const baseUrl = requirePublicWebBase(res, 'admin.password_reset');
  if (!baseUrl) return;

  const mail = !isSuperAdmin ? await deliveringEmailModule() : null;
  if (!isSuperAdmin && !mail) {
    res.status(503).json({
      code: 'EMAIL_DELIVERY_UNAVAILABLE',
      error: 'Password reset delivery is unavailable. Please contact a platform administrator.',
    });
    return;
  }
  const { token, expiresAt } = await issuePasswordResetToken(prisma, targetUserId);
  const resetUrl = buildPublicWebLink(baseUrl, `reset?token=${token}&email=${encodeURIComponent(target.email)}`);

  logger.info({
    event: 'admin.password_reset.token_created',
    actorUserId: auth.userId,
    targetUserId,
    superAdmin: !!isSuperAdmin,
  });

  if (!isSuperAdmin) {
    await deliverResetMail(prisma, mail, target, token, resetUrl, res);
    return;
  }
  res.json({
    userId: target.id,
    email: target.email,
    token,
    resetUrl,
    expiresAt: expiresAt.toISOString(),
  });
}

export function registerAdminPasswordResetRoutes(app: express.Application, prisma: PrismaClient) {
  app.post('/admin/users/:id/reset-token', (req, res) => handleAdminCreateResetToken(prisma, req, res));
}
