import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { Role } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { z } from 'zod';
import { requireAuth, requireVerificationAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { buildPublicWebLink, publicWebBase, requirePublicWebBase } from '../utils/publicLinks.js';
import { pathParam } from '../utils/requestHelpers.js';
import {
  inviteAcceptRateLimiter,
  invitePreviewRateLimiter,
  inviteResendRateLimiter,
} from '../middleware/inviteRateLimit.js';
import {
  consumeInvite,
  deriveInviteStatus,
  deliverInvite,
  inviteEmailMatches,
  inviteExpiry,
  inviteResponse,
  InviteUnavailableError,
  maskInviteEmail,
} from '../utils/inviteLifecycle.js';
import { deliveringEmailModule, lockEmailAccount } from '../utils/emailProof.js';
import { beginInviteVerification, verificationPending } from '../utils/inviteVerification.js';
import { establishSession } from '../utils/sessionAuth.js';
import { buildSigninResponseBody, isNativeClientRequest } from './auth.helpers.js';

const inviteCodeSchema = z.object({ code: z.string().min(4) });

async function handleListInvites(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireTenantAdmin(prisma, req, res);
  if (!admin) return;
  const { tenant } = admin;
  const list = await prisma.invite.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
  const baseUrl = publicWebBase();
  res.json(
    list.map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: deriveInviteStatus(invite),
      expiresAt: invite.expiresAt,
      lastSentAt: invite.lastSentAt,
      lastSendError: invite.lastSendError,
      createdAt: invite.createdAt,
      usedAt: invite.usedAt,
      url: baseUrl ? buildPublicWebLink(baseUrl, `?invite=${invite.code}`) : null,
    })),
  );
}

async function handleDeleteInvite(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireTenantAdmin(prisma, req, res);
  if (!admin) return;
  const { tenant } = admin;
  const id = pathParam(req, 'id');
  if (!/^c[0-9a-z]{24}$/.test(id)) {
    res.status(400).json({ code: 'invite_id_invalid', error: 'Update the application and use the current invitation list to revoke invitations.' });
    return;
  }
  try {
    const invite = await prisma.invite.findUnique({ where: { id } });
    if (!invite || invite.tenantId !== tenant.id) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (invite.usedAt) {
      res.status(400).json({ error: 'already used' });
      return;
    }
    await prisma.invite.delete({ where: { id } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'delete failed' });
  }
}

async function requireTenantAdmin(prisma: PrismaClient, req: express.Request, res: express.Response) {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return null;
  }
  const membership = await requireMembership(req, auth.userId, prisma);
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return { auth, tenant };
}

async function handleResendInvite(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireTenantAdmin(prisma, req, res);
  if (!admin) return;
  const id = pathParam(req, 'id');
  const invite = await prisma.invite.findUnique({ where: { id } });
  if (!invite || invite.tenantId !== admin.tenant.id) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (invite.usedAt) {
    res.status(400).json({ error: 'already used' });
    return;
  }
  const baseUrl = requirePublicWebBase(res, 'invites.resend');
  if (!baseUrl) return;
  const updated = await prisma.invite.update({ where: { id }, data: { expiresAt: inviteExpiry() } });
  const inviteUrl = buildPublicWebLink(baseUrl, `?invite=${updated.code}`);
  const emailSent = await deliverInvite(prisma, {
    invite: { id: updated.id, email: updated.email, tenantId: updated.tenantId, expiresAt: updated.expiresAt },
    inviterUserId: admin.auth.userId,
    tenantName: admin.tenant.name,
    inviteUrl,
  });
  res.json(inviteResponse(updated, inviteUrl, emailSent));
}

async function handlePublicInvitePreview(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = inviteCodeSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'code required' });
    return;
  }
  const invite = await prisma.invite.findUnique({
    where: { code: parse.data.code },
    include: { tenant: { select: { name: true } } },
  });
  if (!invite) {
    res.status(404).json({ code: 'invite_invalid', error: 'This invitation link is invalid. Request a new invitation or update the application.' });
    return;
  }
  res.json({
    tenantName: invite.tenant.name,
    role: invite.role,
    status: deriveInviteStatus(invite),
    emailMasked: maskInviteEmail(invite.email),
  });
}

async function acceptInviteTransaction(
  prisma: PrismaClient,
  invite: { id: string; tenantId: string; role: Role },
  code: string,
  userId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockEmailAccount(tx, userId);
    await tx.$queryRaw`SELECT "id" FROM "Invite" WHERE "id" = ${invite.id} FOR UPDATE`;
    const account = await tx.user.findUnique({ where: { id: userId } });
    const current = await tx.invite.findUnique({ where: { id: invite.id } });
    if (!account?.emailVerifiedAt || !current || !inviteEmailMatches(current.email, account.email)) throw new InviteUnavailableError();
    if (!(await consumeInvite(tx, code, userId, now))) throw new InviteUnavailableError();
    const membership = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: invite.tenantId, userId } },
    });
    if (membership?.inviteVerificationRequired) {
      await tx.membership.update({ where: { id: membership.id }, data: { role: invite.role, inviteVerificationRequired: false } });
      return false;
    }
    if (membership) return true;
    await tx.membership.create({ data: { tenantId: invite.tenantId, userId, role: invite.role } });
    return false;
  });
}

async function handleAcceptInvite(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireVerificationAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const parse = inviteCodeSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'code required' });
    return;
  }
  const { code } = parse.data;
  try {
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (deriveInviteStatus(invite) !== 'pending') {
      res.status(409).json({ error: 'invite_unavailable' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) throw new Error('Authenticated invite account not found');
    if (!inviteEmailMatches(invite.email, user.email)) {
      res.status(403).json({ error: 'invite_email_mismatch' });
      return;
    }
    if (!user.emailVerifiedAt) {
      if (!(await deliveringEmailModule())) {
        res.status(503).json({ code: 'EMAIL_DELIVERY_UNAVAILABLE', error: 'This invitation requires confirmation email delivery. Please contact an administrator.' });
        return;
      }
      const outcome = await beginInviteVerification(prisma, user.id, invite.id);
      await establishSession({ prisma, req, res, userId: user.id, tenantId: invite.tenantId, verificationOnly: true });
      verificationPending(res, outcome);
      return;
    }
    const alreadyMember = await acceptInviteTransaction(prisma, invite, code, user.id, new Date());
    if (auth.verificationOnly) {
      res.status(409).json({ code: 'ACCOUNT_LOGIN_REQUIRED', error: 'Please sign in to complete the invitation.' });
      return;
    }
    const session = await establishSession({ prisma, req, res, userId: user.id, tenantId: invite.tenantId });
    res.json({ ...buildSigninResponseBody(user, session.token, isNativeClientRequest(req)), alreadyMember });
  } catch (error: unknown) {
    if (error instanceof InviteUnavailableError) {
      res.status(409).json({ error: 'invite_unavailable' });
      return;
    }
    logger.error({
      event: 'invites.accept_failed',
      userId: auth.userId,
      errorName: error instanceof Error ? error.name : typeof error,
    });
    res.status(500).json({ error: 'accept_failed' });
  }
}

export function registerInviteRoutes(app: express.Application, prisma: PrismaClient): void {
  app.post('/invites/accept', inviteAcceptRateLimiter, (req, res) => handleAcceptInvite(prisma, req, res));
  app.post('/public/invites/preview', invitePreviewRateLimiter, (req, res) =>
    handlePublicInvitePreview(prisma, req, res),
  );
  app.get('/invites', (req, res) => handleListInvites(prisma, req, res));
  app.delete('/invites/:id', (req, res) => handleDeleteInvite(prisma, req, res));
  app.post('/invites/:id/resend', inviteResendRateLimiter, (req, res) => handleResendInvite(prisma, req, res));
}
