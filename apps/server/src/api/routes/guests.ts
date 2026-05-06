import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  getJwtSecret,
  setAuthCookie,
  requireAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { getTenancyModule } from '../../tenancyLoader.js';
import { sendIfAvailable } from '../../emailLoader.js';

type GuestAdminGate = {
  ok: true;
  auth: NonNullable<ReturnType<typeof requireAuth>>;
  tenant: NonNullable<ReturnType<typeof getTenantFromReq>>;
} | { ok: false; status: number; error: string };

async function gateGuestAdminRequest(prisma: PrismaClient, req: express.Request): Promise<GuestAdminGate> {
  const auth = requireAuth(req);
  if (!auth) return { ok: false, status: 401, error: 'unauthorized' };
  const tenant = getTenantFromReq(req);
  if (!tenant) return { ok: false, status: 400, error: 'tenant_required' };
  const membership = await requireMembership(req, auth.userId, prisma);
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    return { ok: false, status: 403, error: 'forbidden' };
  }
  const tenancy = await getTenancyModule();
  if (!tenancy.isMultiTenantEnabled()) {
    return { ok: false, status: 403, error: 'enterprise_required' };
  }
  return { ok: true, auth, tenant };
}

const createGuestSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  expiresAt: z.string(),
});

async function ensureGuestUser(prisma: PrismaClient, normalizedEmail: string, name?: string) {
  let user = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: name || null,
        passwordHash: null,
        emailVerifiedAt: new Date(),
      },
    });
  }
  return user;
}

async function upsertGuestMembership(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  expiresAt: Date,
): Promise<{ ok: true; membership: any } | { ok: false; status: number; error: string }> {
  const existingOther = await prisma.membership.findFirst({
    where: { userId, tenantId: { not: tenantId } },
  });
  if (existingOther) return { ok: false, status: 400, error: 'user_has_other_membership' };

  let guestMembership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
  });

  if (guestMembership) {
    if ((guestMembership as any).role !== 'guest') {
      return { ok: false, status: 400, error: 'user_already_member' };
    }
    guestMembership = await prisma.membership.update({
      where: { id: guestMembership.id },
      data: { expiresAt },
    });
    await prisma.guestToken.deleteMany({ where: { membershipId: guestMembership.id } });
  } else {
    guestMembership = await prisma.membership.create({
      data: { tenantId, userId, role: 'guest', expiresAt },
    });
  }
  return { ok: true, membership: guestMembership };
}

async function issueGuestToken(prisma: PrismaClient, membershipId: string, expiresAt: Date) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.guestToken.create({
    data: { token: tokenHash, membershipId, expiresAt },
  });
  return rawToken;
}

async function sendGuestInviteEmail(
  prisma: PrismaClient,
  inviterId: string,
  tenantId: string,
  tenantSlug: string,
  user: { name: string | null; email: string },
  name: string | undefined,
  rawToken: string,
  expiresAt: Date,
  normalizedEmail: string,
): Promise<string> {
  const tenantRecord = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const slug = tenantRecord?.slug || tenantSlug;
  // Public base URL: Self-Hoster setzen `PUBLIC_BASE_URL` oder
  // `BILLING_PUBLIC_URL`. Brand-Domain (`*.meetropolis.de`) ist nur im
  // Enterprise-Brand-Setup gesetzt — kein Fallback im OSS.
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BILLING_PUBLIC_URL || '';
  const magicLink = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/#/guest?token=${rawToken}`
    : `/#/guest?token=${rawToken}`;

  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { name: true, email: true } });
  const inviterName = inviter?.name || inviter?.email || 'Someone';
  const tenantName = tenantRecord?.name || slug;

  void sendIfAvailable(
    (mod) => mod.sendGuestInvite({
      to: normalizedEmail,
      inviterName,
      tenantName,
      guestName: name || user.name || '',
      magicLinkUrl: magicLink,
      expiresAt: expiresAt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    }),
    'guest.invite.email_failed',
    { email: normalizedEmail },
  );

  return magicLink;
}

async function handleCreateGuest(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const gate = await gateGuestAdminRequest(prisma, req);
  if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
  const { auth, tenant } = gate;

  const parse = createGuestSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'email and expiresAt required' }); return; }

  const { email, name, expiresAt: expiresAtStr } = parse.data;
  const expiresAt = new Date(expiresAtStr);
  if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 60 * 60 * 1000) {
    res.status(400).json({ error: 'expiresAt must be at least 1 hour in the future' });
    return;
  }

  const normalizedEmail = normalizeEmailForStorage(email);
  const user = await ensureGuestUser(prisma, normalizedEmail, name);

  const upsert = await upsertGuestMembership(prisma, tenant.id, user.id, expiresAt);
  if (!upsert.ok) { res.status(upsert.status).json({ error: upsert.error }); return; }
  const guestMembership = upsert.membership;

  const rawToken = await issueGuestToken(prisma, guestMembership.id, expiresAt);
  const magicLink = await sendGuestInviteEmail(
    prisma,
    auth.userId,
    tenant.id,
    tenant.slug,
    user,
    name,
    rawToken,
    expiresAt,
    normalizedEmail,
  );

  res.json({
    id: guestMembership.id,
    email: normalizedEmail,
    expiresAt: expiresAt.toISOString(),
    magicLink,
  });
}

async function handleListGuests(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const gate = await gateGuestAdminRequest(prisma, req);
  if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
  const { tenant } = gate;

  const guests = await prisma.membership.findMany({
    where: { tenantId: tenant.id, role: 'guest' },
    include: { user: { select: { email: true, name: true } } },
    orderBy: { createdAt: 'desc' },
  });

  res.json(guests.map((g) => ({
    id: g.id,
    email: g.user.email,
    name: g.user.name,
    expiresAt: g.expiresAt?.toISOString() || null,
    createdAt: g.createdAt.toISOString(),
  })));
}

async function handleRevokeGuest(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const gate = await gateGuestAdminRequest(prisma, req);
  if (!gate.ok) { res.status(gate.status).json({ error: gate.error }); return; }
  const { tenant } = gate;

  const membershipId = pathParam(req, 'membershipId');
  const guestMembership = await prisma.membership.findFirst({
    where: { id: membershipId, tenantId: tenant.id, role: 'guest' },
  });
  if (!guestMembership) { res.status(404).json({ error: 'guest_not_found' }); return; }

  await prisma.guestToken.deleteMany({ where: { membershipId } });
  await prisma.session.deleteMany({ where: { userId: guestMembership.userId } });
  await prisma.membership.delete({ where: { id: membershipId } });

  res.json({ ok: true });
}

const guestLoginSchema = z.object({ token: z.string().min(1) });

async function createGuestSession(prisma: PrismaClient, userId: string, jwtToken: string, req: express.Request) {
  try {
    const sessionTokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await prisma.session.create({
      data: { userId, tokenHash: sessionTokenHash, userAgent, ipAddress, expiresAt },
    });
  } catch (e) {
    logger.warn({ event: 'auth.guest.session_create_failed', userId, error: String(e) });
  }
}

async function handleGuestLogin(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const parse = guestLoginSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'token required' }); return; }

  const { token: rawToken } = parse.data;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const guestToken = await prisma.guestToken.findUnique({
    where: { token: tokenHash },
    include: {
      membership: {
        include: {
          user: { select: { id: true, email: true, name: true } },
          tenant: { select: { id: true, slug: true } },
        },
      },
    },
  });

  if (!guestToken) { res.status(401).json({ error: 'invalid_token' }); return; }
  if (guestToken.expiresAt < new Date()) { res.status(401).json({ error: 'token_expired' }); return; }
  if (guestToken.membership.expiresAt && guestToken.membership.expiresAt < new Date()) {
    res.status(401).json({ error: 'guest_expired' });
    return;
  }

  const user = guestToken.membership.user;
  const tenantId = guestToken.membership.tenant.id;

  const jwtToken = jwt.sign({ sub: user.id, tid: tenantId }, getJwtSecret(), { expiresIn: '30d' });
  setAuthCookie(res, jwtToken);

  await createGuestSession(prisma, user.id, jwtToken, req);

  const origin = req.headers.origin || '';
  const isNativeClient = !origin || origin.startsWith('tauri://');
  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    ...(isNativeClient && { token: jwtToken }),
  });
}

export function registerGuestRoutes(app: express.Application, prisma: PrismaClient) {
  app.post('/guests', (req, res) => handleCreateGuest(prisma, req, res));
  app.get('/guests', (req, res) => handleListGuests(prisma, req, res));
  app.delete('/guests/:membershipId', (req, res) => handleRevokeGuest(prisma, req, res));
  app.post('/auth/guest', (req, res) => handleGuestLogin(prisma, req, res));
}
