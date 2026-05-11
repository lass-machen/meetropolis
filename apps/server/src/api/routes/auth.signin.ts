import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  getJwtSecret,
  setAuthCookie,
  requireAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
  normalizeEmailForMatching,
} from '../utils/authHelpers.js';
import { hasBillingModule } from '../../billingLoader.js';
import { hasAdminEnterpriseModule } from '../../adminLoader.js';
import { getTenancyModule } from '../../tenancyLoader.js';
import { sendIfAvailable } from '../../emailLoader.js';
import { recordSession, isNativeClientRequest, getRequestToken } from './auth.helpers.js';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']).optional().default('member'),
});

export async function handleAuthInvite(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  const membership = await requireMembership(req, auth.userId, prisma);
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parse = inviteSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'email required' });
    return;
  }
  const requestedRole = parse.data.role;
  const allowedRole = membership.role === 'owner' ? requestedRole : 'member';
  const code = crypto.randomBytes(12).toString('hex');
  const normalizedEmail = normalizeEmailForStorage(parse.data.email);
  const inv = await prisma.invite.create({
    data: { code, email: normalizedEmail, createdBy: auth.userId, tenantId: tenant.id, role: allowedRole },
  });

  // Best-effort email when the tenancy mail module is loaded. In the OSS
  // build without the submodule this is a silent no-op: the code is
  // returned in the JSON response below and shared manually by the admin.
  const inviter = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { name: true, email: true },
  });
  const inviterName = inviter?.name || inviter?.email || 'Someone';
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BILLING_PUBLIC_URL || '';
  const inviteUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/#/?invite=${inv.code}` : `/#/?invite=${inv.code}`;
  void sendIfAvailable(
    (mod) =>
      mod.sendInvite({
        to: normalizedEmail,
        inviterName,
        tenantName: tenant.slug,
        inviteUrl,
      }),
    'invite.email_failed',
    { tenantId: tenant.id, inviteCode: inv.code },
  );

  res.json({ code: inv.code, role: allowedRole, inviteUrl });
}

const registerSchema = z.object({
  code: z.string().min(4),
  name: z.string().min(1).optional(),
  email: z.string().email(),
  password: z.string().min(8),
});

export async function handleAuthRegister(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = registerSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'code, email, password required' });
    return;
  }
  const { code, name, email, password } = parse.data;
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.usedAt) {
    res.status(400).json({ error: 'invalid or used invite' });
    return;
  }
  if (invite.email && normalizeEmailForMatching(invite.email) !== normalizeEmailForMatching(email)) {
    res.status(400).json({ error: 'invite does not match email' });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  let user;
  try {
    const emailForStorage = normalizeEmailForStorage(email);
    user = await prisma.user.create({
      data: { email: emailForStorage, name, passwordHash: hash, emailVerifiedAt: new Date() },
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      res.status(400).json({ error: 'email already in use' });
      return;
    }
    res.status(400).json({ error: 'registration failed' });
    return;
  }
  await prisma.invite.update({ where: { code }, data: { usedAt: new Date(), usedById: user.id } });
  try {
    if (invite.tenantId) {
      await prisma.membership.upsert({
        where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
        update: {},
        create: { tenantId: invite.tenantId, userId: user.id, role: invite.role || 'member' },
      });
    }
  } catch {}
  const token = jwt.sign({ sub: user.id, tid: invite.tenantId }, getJwtSecret(), { expiresIn: '30d' });
  setAuthCookie(res, token);

  await recordSession(prisma, user.id, token, req, 'auth.register.session_create_failed');

  const isNative = isNativeClientRequest(req);
  res.json({ id: user.id, email: user.email, name: user.name, ...(isNative && { token }) });
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

function findLoginUser(prisma: PrismaClient, email: string) {
  const emailLookup = normalizeEmailForStorage(email);
  return prisma.user.findFirst({ where: { email: { equals: emailLookup, mode: 'insensitive' } } });
}

async function checkGuestRedirect(prisma: PrismaClient, user: any): Promise<{ guest: boolean }> {
  if (user && !user.passwordHash) {
    const guestMembership = await prisma.membership.findFirst({
      where: { userId: user.id, role: 'guest' },
    });
    if (guestMembership) return { guest: true };
  }
  return { guest: false };
}

async function resolveTenantForLogin(prisma: PrismaClient, userId: string, req: express.Request) {
  let tenant = getTenantFromReq(req);
  if (!tenant) return { ok: false as const, status: 400, error: 'tenant_required' };
  let membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId } },
  });
  if (!membership) {
    const firstMembership = await prisma.membership.findFirst({
      where: { userId },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!firstMembership?.tenant) return { ok: false as const, status: 403, error: 'not_member_of_tenant' };
    tenant = firstMembership.tenant;
    membership = firstMembership;
  }
  return { ok: true as const, tenant, membership };
}

export async function handleAuthLogin(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const parse = loginSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'email and password required' });
    return;
  }
  const { email, password } = parse.data;
  const user = await findLoginUser(prisma, email);
  if (!user || !user.passwordHash) {
    const guestCheck = await checkGuestRedirect(prisma, user);
    if (guestCheck.guest) {
      res
        .status(401)
        .json({ error: 'guest_login_not_allowed', message: 'Guest users must use their magic link to login' });
      return;
    }
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const tenantResolution = await resolveTenantForLogin(prisma, user.id, req);
  if (!tenantResolution.ok) {
    res.status(tenantResolution.status).json({ error: tenantResolution.error });
    return;
  }
  const { tenant } = tenantResolution;

  const token = jwt.sign({ sub: user.id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
  setAuthCookie(res, token);

  await recordSession(prisma, user.id, token, req, 'auth.login.session_create_failed');

  const isNative = isNativeClientRequest(req);
  res.json({ id: user.id, email: user.email, name: user.name, ...(isNative && { token }) });
}

export async function handleAuthLogout(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const currentToken = getRequestToken(req);
    if (currentToken) {
      const tokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');
      await prisma.session.deleteMany({ where: { tokenHash } });
    }
  } catch (e) {
    logger.warn({ event: 'auth.logout.session_delete_failed', error: String(e) });
  }

  res.clearCookie('auth_token', { path: '/' });
  res.json({ ok: true });
}

async function loadInternalOwnerFlag(prisma: PrismaClient, userId: string): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    if (!internal) return false;
    const internalMember = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: internal.id, userId } },
    });
    return internalMember?.role === 'owner';
  } catch {
    return false;
  }
}

export async function handleAuthMe(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  const member = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: tenant.id, userId: auth.userId } },
    select: { id: true, role: true, expiresAt: true },
  });
  if (!member) {
    res.status(403).json({ error: 'not_member_of_tenant' });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    include: {
      presences: {
        where: { tenantId: tenant.id },
        orderBy: { updatedAt: 'desc' },
        take: 1,
      },
    },
  });
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const isInternalOwner = await loadInternalOwnerFlag(prisma, auth.userId);
  const lastPosition = user.presences[0];
  const tenancyModule = await getTenancyModule();
  const capabilities = {
    hasBilling: await hasBillingModule(),
    hasAdminEnterprise: await hasAdminEnterpriseModule(),
    isMultiTenant: tenancyModule.isMultiTenantEnabled(),
  };
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarId: user.avatarId || null,
    role: member.role,
    isGuest: member.role === 'guest',
    guestExpiresAt: member.expiresAt?.toISOString() || null,
    isInternalOwner,
    capabilities,
    onboardingCompleted: user.onboardingCompleted,
    lastPosition: lastPosition
      ? {
          x: lastPosition.x,
          y: lastPosition.y,
          direction: lastPosition.direction,
          mapName: lastPosition.mapName || null,
        }
      : null,
  });
}
