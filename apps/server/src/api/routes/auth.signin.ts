import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  requireAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
  normalizeEmailForMatching,
} from '../utils/authHelpers.js';
import { establishSession, revokeSessionByToken } from '../utils/sessionAuth.js';
import { startEmailVerification } from './auth.verify.js';
import { hasBillingModule } from '../../billingLoader.js';
import { hasAdminEnterpriseModule } from '../../adminLoader.js';
import { getTenancyModule } from '../../tenancyLoader.js';
import { sendIfAvailable } from '../../emailLoader.js';
import { isNativeClientRequest, getRequestToken, buildSigninResponseBody } from './auth.helpers.js';

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

  // Best-effort email when a mail module is loaded (EE-tenancy or
  // OSS-SMTP). In the OSS-console-fallback case this becomes a logged
  // no-op: the code is returned in the JSON response below and shared
  // manually by the admin.
  //
  // Locale chain (Block C): params.locale (not exposed on /auth/invite) →
  // inviter.locale (DB) → MAIL_DEFAULT_LOCALE / 'de' (resolver default).
  // The invitee is not a known user yet, so we fall back to the
  // inviter's UI locale — closer to "what language did the admin see
  // when they sent this" than guessing the recipient's.
  const inviter = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { name: true, email: true, locale: true },
  });
  const inviterName = inviter?.name || inviter?.email || 'Someone';
  const inviterLocale = inviter?.locale === 'en' ? 'en' : inviter?.locale === 'de' ? 'de' : undefined;
  const baseUrl = process.env.PUBLIC_BASE_URL || process.env.BILLING_PUBLIC_URL || '';
  const inviteUrl = baseUrl ? `${baseUrl.replace(/\/$/, '')}/#/?invite=${inv.code}` : `/#/?invite=${inv.code}`;
  void sendIfAvailable(
    (mod) =>
      mod.sendInvite({
        to: normalizedEmail,
        inviterName,
        // The company NAME, not the slug: the slug is a routing key ("acme-2")
        // and the invite mail's subject line puts this in front of a human.
        tenantName: tenant.name,
        inviteUrl,
        locale: inviterLocale,
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
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  let user;
  try {
    const emailForStorage = normalizeEmailForStorage(email);
    // No `emailVerifiedAt` here: the address is unverified until the user
    // proves it via the mail sent below. Stamping it at creation time is what
    // made the entire verification flow (model, endpoints, badge) dead code —
    // and password-reset links are mailed to this address, so the proof has to
    // be real. An unverified user is not locked out; the client shows a banner
    // (GET /auth/me -> emailVerified).
    user = await prisma.user.create({
      data: { email: emailForStorage, name, passwordHash: hash },
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

  let established;
  try {
    established = await establishSession({ prisma, req, res, userId: user.id, tenantId: invite.tenantId });
  } catch (e: unknown) {
    // No session row means no revocable session, so we do not hand out a
    // cookie either. The account and the redeemed invite survive; the user
    // simply logs in.
    logger.error({ event: 'auth.register.session_create_failed', userId: user.id, error: String(e) });
    res.status(500).json({ error: 'registration failed' });
    return;
  }

  // Detached: a slow or dead mail provider must not fail a registration that
  // already succeeded. The user can re-trigger via POST /auth/verify/request.
  void startEmailVerification({ prisma, userId: user.id, req }).catch((e: unknown) =>
    logger.warn({ event: 'auth.register.verification_start_failed', userId: user.id, error: String(e) }),
  );

  res.json(buildSigninResponseBody(user, established.token, isNativeClientRequest(req)));
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

/**
 * bcrypt cost factor for every password this module hashes or verifies against.
 * Named so the dummy hash below cannot drift away from the real ones: a cheaper
 * dummy would reintroduce the very timing gap it exists to close.
 */
const BCRYPT_COST = 10;

/**
 * A genuine bcrypt hash of a random secret nobody holds, computed once at boot.
 *
 * `/auth/login` used to skip the bcrypt comparison entirely when no account
 * matched. Both answers were an identical 401, but a miss returned ~10x faster
 * than a hit (measured against the dev stack: ~6ms vs ~65ms), which made the
 * endpoint a reliable account-enumeration oracle — and handed away exactly the
 * information `/auth/forgot` deliberately withholds. Verifying against this hash
 * instead spends the same work on a miss as on a hit.
 *
 * It can never authenticate anyone: the input is random, discarded, and the
 * result is forced to false below.
 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), BCRYPT_COST);

/**
 * Verify `password` against `hash` — or burn the identical amount of work
 * against {@link DUMMY_PASSWORD_HASH} when there is no hash to verify against
 * (unknown address, or an account without a password such as a guest). Always
 * returns false in that case, regardless of what bcrypt says.
 */
async function verifyPasswordConstantWork(password: string, hash: string | null | undefined): Promise<boolean> {
  const matches = await bcrypt.compare(password, hash || DUMMY_PASSWORD_HASH);
  return !!hash && matches;
}

function findLoginUser(prisma: PrismaClient, email: string) {
  const emailLookup = normalizeEmailForStorage(email);
  return prisma.user.findFirst({ where: { email: { equals: emailLookup, mode: 'insensitive' } } });
}

type LoginUser = Awaited<ReturnType<typeof findLoginUser>>;

async function checkGuestRedirect(prisma: PrismaClient, user: LoginUser): Promise<{ guest: boolean }> {
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
  // Run the comparison BEFORE any early return, so that a miss costs the same as
  // a hit. Moving it below the `!user` check is what made this an enumeration
  // oracle; see DUMMY_PASSWORD_HASH.
  const passwordOk = await verifyPasswordConstantWork(password, user?.passwordHash);
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
  if (!passwordOk) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const tenantResolution = await resolveTenantForLogin(prisma, user.id, req);
  if (!tenantResolution.ok) {
    res.status(tenantResolution.status).json({ error: tenantResolution.error });
    return;
  }
  const { tenant } = tenantResolution;

  let established;
  try {
    established = await establishSession({ prisma, req, res, userId: user.id, tenantId: tenant.id });
  } catch (e: unknown) {
    logger.error({ event: 'auth.login.session_create_failed', userId: user.id, error: String(e) });
    res.status(500).json({ error: 'login failed' });
    return;
  }

  res.json(buildSigninResponseBody(user, established.token, isNativeClientRequest(req)));
}

export async function handleAuthLogout(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const currentToken = getRequestToken(req);
    if (currentToken) await revokeSessionByToken(prisma, currentToken);
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
    // The authenticated tenant's slug. The web client sends this as the
    // Colyseus join `options.tenant` so it partitions into ITS tenant's
    // WorldRoom even on an apex domain where no subdomain slug exists.
    tenantSlug: tenant.slug,
    avatarId: user.avatarId || null,
    // Verification status of `email`. An unverified user is deliberately NOT
    // locked out (someone who just paid must not be blocked), so the client
    // needs the flag to show its "not verified" banner and the resend action.
    emailVerified: !!user.emailVerifiedAt,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
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
