import type express from 'express';
import { z } from 'zod';
import { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { requireAuth, requireSuperAdmin, requireMembership, getTenantFromReq } from '../utils/authHelpers.js';
import { issuePasswordResetToken } from '../utils/passwordResetTokens.js';

const paramsSchema = z.object({ id: z.string().min(1) });

/**
 * Admin endpoint that creates a password-reset token for a user. The token is
 * returned in the response and handed over out of band.
 *
 * This is the FALLBACK path, kept for managed tenants and for users with no
 * reachable mailbox. The primary path is self-service: POST /auth/forgot mails
 * the user a link (see routes/auth.password.ts). Both issue the token through
 * the same module, so a token from either path behaves identically.
 *
 * Authorisation: a global SuperAdmin, OR a tenant owner/admin for users
 * in their own tenant.
 */
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
    select: { id: true, email: true, name: true },
  });
  if (!target) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }

  const isSuperAdmin = await requireSuperAdmin(req, prisma);
  if (!isSuperAdmin) {
    const tenant = getTenantFromReq(req);
    if (!tenant) {
      res.status(400).json({ error: 'tenant_required' });
      return;
    }
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const targetMembership = await prisma.membership.findFirst({
      where: { userId: targetUserId, tenantId: tenant.id },
    });
    if (!targetMembership) {
      res.status(403).json({ error: 'user_not_in_tenant' });
      return;
    }
  }

  // Shared issuer (api/utils/passwordResetTokens.ts): stores the token hashed
  // and drops the user's previous unused token, so only one valid reset link
  // per user exists. It MUST be used here — a hand-rolled row would store a
  // plaintext token that POST /auth/reset can no longer match.
  const { token, expiresAt } = await issuePasswordResetToken(prisma, targetUserId);

  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BILLING_PUBLIC_URL || '';
  const resetUrl = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/#/reset?token=${token}&email=${encodeURIComponent(target.email)}`
    : `/#/reset?token=${token}&email=${encodeURIComponent(target.email)}`;

  logger.info({
    event: 'admin.password_reset.token_created',
    actorUserId: auth.userId,
    targetUserId,
    superAdmin: !!isSuperAdmin,
  });

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
