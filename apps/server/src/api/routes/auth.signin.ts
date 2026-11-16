import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  requireAuth,
  requireVerificationAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { buildPublicWebLink, requirePublicWebBase } from '../utils/publicLinks.js';
import { establishSession, revokeSessionByToken } from '../utils/sessionAuth.js';
import { displayNameSchema, invalidNameBodyFor } from '../utils/displayName.js';
import { deliveringEmailModule } from '../utils/emailProof.js';
import { manualConfirmationEnabled } from '../utils/manualConfirmation.js';
import {
  beginInviteVerification,
  pendingInviteForUser,
  verificationPending,
  verificationBindingRequired,
} from '../utils/inviteVerification.js';
import { isInternalOwner as checkInternalOwner } from '../utils/tenantMembership.js';
import { hasBillingModule } from '../../billingLoader.js';
import { hasAdminEnterpriseModule } from '../../adminLoader.js';
import { getTenancyModule } from '../../tenancyLoader.js';
import { isNativeClientRequest, getRequestToken, buildSigninResponseBody } from './auth.helpers.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import { getDeniedTenant, isTenantAccessDenied } from '../utils/tenantAccessState.js';
import * as inviteLifecycle from '../utils/inviteLifecycle.js';

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
  const baseUrl = requirePublicWebBase(res, 'auth.invite');
  if (!baseUrl) return;

  const normalizedEmail = normalizeEmailForStorage(parse.data.email);
  const existingMember = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
      memberships: { some: { tenantId: tenant.id, inviteVerificationRequired: false } },
    },
    select: { id: true },
  });
  if (existingMember) {
    res.status(409).json({ error: 'already_member' });
    return;
  }
  const openInvite = await prisma.invite.findFirst({
    where: { tenantId: tenant.id, email: normalizedEmail, usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const invite = openInvite
    ? await prisma.invite.update({
        where: { id: openInvite.id },
        data: { expiresAt: inviteLifecycle.inviteExpiry(), role: allowedRole },
      })
    : await prisma.invite.create({
        data: {
          code: crypto.randomBytes(12).toString('hex'),
          email: normalizedEmail,
          createdBy: auth.userId,
          tenantId: tenant.id,
          role: allowedRole,
          expiresAt: inviteLifecycle.inviteExpiry(),
        },
      });
  const inviteUrl = buildPublicWebLink(baseUrl, `?invite=${invite.code}`);
  const emailSent = await inviteLifecycle.deliverInvite(prisma, {
    invite: { id: invite.id, email: invite.email, tenantId: invite.tenantId, expiresAt: invite.expiresAt },
    inviterUserId: auth.userId,
    tenantName: tenant.name,
    inviteUrl,
  });
  res.json(inviteLifecycle.inviteResponse(invite, inviteUrl, emailSent));
}

const registerSchema = z.object({
  code: z.string().min(4),
  name: displayNameSchema.optional(),
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
    res.status(400).json(invalidNameBodyFor(parse.error) ?? { error: 'code, email, password required' });
    return;
  }
  const { code, name, email, password } = parse.data;
  const invite = await prisma.invite.findUnique({ where: { code } });
  if (!invite || invite.usedAt) {
    res.status(400).json({ error: 'invite_unavailable' });
    return;
  }
  if (inviteLifecycle.deriveInviteStatus(invite) === 'expired') {
    res.status(400).json({ error: 'invite_expired' });
    return;
  }
  if (!inviteLifecycle.inviteEmailMatches(invite.email, email)) {
    res.status(403).json({ error: 'invite_email_mismatch' });
    return;
  }
  if (!(await deliveringEmailModule()) && !manualConfirmationEnabled()) {
    res.status(503).json({
      code: 'EMAIL_DELIVERY_UNAVAILABLE',
      error: 'This invitation requires email confirmation. Configure a delivery provider or contact an administrator.',
    });
    return;
  }
  if (!requirePublicWebBase(res, 'auth.register')) return;
  const now = new Date();
  let user;
  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    // Grant no membership or invitation role until mailbox ownership is proven.
    user = await inviteLifecycle.registerInvitedUser(prisma, {
      code,
      email,
      name,
      passwordHash,
      role: invite.role,
      tenantId: invite.tenantId,
      now,
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      res.status(409).json({
        code: 'ACCOUNT_LOGIN_REQUIRED',
        error: 'An account already exists for this email address. Sign in to accept the invitation.',
      });
      return;
    }
    if (e instanceof inviteLifecycle.InviteUnavailableError) {
      res.status(400).json({ error: 'invite_unavailable' });
      return;
    }
    logger.error({ event: 'auth.register.failed', errorName: e instanceof Error ? e.name : typeof e });
    res.status(500).json({ error: 'registration failed' });
    return;
  }

  try {
    await establishSession({ prisma, req, res, userId: user.id, tenantId: invite.tenantId, verificationOnly: true });
  } catch (e: unknown) {
    // No session row means no revocable session, so we do not hand out a
    // cookie either. The account and the redeemed invite survive; the user
    // simply logs in.
    logger.error({ event: 'auth.register.session_create_failed', userId: user.id, error: String(e) });
    res.status(500).json({ error: 'registration failed' });
    return;
  }

  // Allow the cookie to perform verification actions without granting tenant access.
  verificationPending(res, await beginInviteVerification(prisma, user.id, invite.id));
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

// Returns true when the response was sent.
async function respondPendingInviteLogin(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
  userId: string,
  requestedTenant: { id: string } | null | undefined,
): Promise<boolean> {
  const pendingInvite = await pendingInviteForUser(prisma, userId, requestedTenant?.id);
  const marked = requestedTenant
    ? await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: requestedTenant.id, userId: userId } },
      })
    : null;
  if (marked?.inviteVerificationRequired || pendingInvite) {
    if (!pendingInvite) {
      verificationBindingRequired(res);
      return true;
    }
    await establishSession({
      prisma,
      req,
      res,
      userId: userId,
      tenantId: pendingInvite.tenantId,
      verificationOnly: true,
    });
    verificationPending(res, await beginInviteVerification(prisma, userId, pendingInvite.id));
    return true;
  }
  return false;
}

// Returns null when the response was sent.
async function resolveLoginTenantOrRespond(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
  userId: string,
  requestedTenant: { id: string } | null | undefined,
) {
  const tenantResolution = await resolveTenantForLogin(prisma, userId, req);
  if (!tenantResolution.ok) {
    // An existing account without membership needs a session to accept an invitation.
    // The 409 response does not grant tenant access.
    if (tenantResolution.error === 'not_member_of_tenant' && requestedTenant) {
      await establishSession({
        prisma,
        req,
        res,
        userId: userId,
        tenantId: requestedTenant.id,
        verificationOnly: true,
      });
      res.status(409).json({
        code: 'INVITE_ACCEPT_REQUIRED',
        error: 'Open your invitation link to continue with this account. Request a new invitation if it has expired.',
      });
      return null;
    }
    res.status(tenantResolution.status).json({ error: tenantResolution.error });
    return null;
  }
  return tenantResolution.tenant;
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
    await recordAuthEvent(prisma, { type: 'login', success: false, userId: user?.id ?? null, email, req });
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
    await recordAuthEvent(prisma, { type: 'login', success: false, userId: user.id, req });
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }

  const requestedTenant = getTenantFromReq(req) ?? getDeniedTenant(req);
  if (await respondPendingInviteLogin(prisma, req, res, user.id, requestedTenant)) {
    return;
  }
  const tenant = await resolveLoginTenantOrRespond(prisma, req, res, user.id, requestedTenant);
  if (!tenant) {
    return;
  }

  let established;
  try {
    established = await establishSession({ prisma, req, res, userId: user.id, tenantId: tenant.id });
  } catch (e: unknown) {
    logger.error({ event: 'auth.login.session_create_failed', userId: user.id, error: String(e) });
    res.status(500).json({ error: 'login failed' });
    return;
  }

  await recordAuthEvent(prisma, { type: 'login', success: true, userId: user.id, tenantId: tenant.id, req });

  res.json(buildSigninResponseBody(user, established.token, isNativeClientRequest(req)));
}

export async function handleAuthLogout(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  try {
    const currentToken = getRequestToken(req);
    if (currentToken) await revokeSessionByToken(prisma, currentToken);
  } catch (e) {
    logger.warn({ event: 'auth.logout.session_delete_failed', error: String(e) });
  }

  await recordAuthEvent(prisma, {
    type: 'logout',
    success: true,
    userId: auth?.userId ?? null,
    tenantId: auth?.tenantId ?? null,
    req,
  });

  res.clearCookie('auth_token', { path: '/' });
  res.json({ ok: true });
}

// Returns true when the response was sent.
async function respondVerificationGate(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
  auth: NonNullable<ReturnType<typeof requireVerificationAuth>>,
): Promise<boolean> {
  if (auth.verificationOnly) {
    const pending = await pendingInviteForUser(prisma, auth.userId, auth.tenantId);
    if (pending) verificationPending(res);
    else res.status(409).json({ code: 'ACCOUNT_LOGIN_REQUIRED', error: 'Please sign in to continue.' });
    return true;
  }
  const resolvedTenant = getTenantFromReq(req) ?? getDeniedTenant(req);
  if (resolvedTenant) {
    const marked = await prisma.membership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: resolvedTenant.id,
          userId: auth.userId,
        },
      },
    });
    const pending = await pendingInviteForUser(prisma, auth.userId, resolvedTenant.id);
    if (marked?.inviteVerificationRequired || pending) {
      if (!pending) verificationBindingRequired(res);
      else verificationPending(res);
      return true;
    }
  }
  return false;
}

async function loadMeCapabilities(): Promise<{
  hasBilling: boolean;
  hasAdminEnterprise: boolean;
  isMultiTenant: boolean;
}> {
  const tenancyModule = await getTenancyModule();
  return {
    hasBilling: await hasBillingModule(),
    hasAdminEnterprise: await hasAdminEnterpriseModule(),
    isMultiTenant: tenancyModule.isMultiTenantEnabled(),
  };
}

function meResponseBody(
  user: {
    id: string;
    email: string;
    name: string | null;
    avatarId: string | null;
    emailVerifiedAt: Date | null;
    onboardingCompleted: boolean;
    presences: Array<{
      x: number;
      y: number;
      direction: string;
      mapName: string | null;
    }>;
  },
  tenant: { slug: string },
  member: { role: string; expiresAt: Date | null },
  isInternalOwner: boolean,
  capabilities: {
    hasBilling: boolean;
    hasAdminEnterprise: boolean;
    isMultiTenant: boolean;
  },
): Record<string, unknown> {
  const lastPosition = user.presences[0];
  return {
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
  };
}

export async function handleAuthMe(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireVerificationAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (await respondVerificationGate(prisma, req, res, auth)) {
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant && isTenantAccessDenied(req)) {
    // Same answer as before the central guard: the caller is signed in but
    // not a member of the tenant the request names.
    res.status(403).json({ error: 'not_member_of_tenant' });
    return;
  }
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
  const isInternalOwner = await checkInternalOwner(prisma, auth.userId);
  const capabilities = await loadMeCapabilities();
  res.json(meResponseBody(user, tenant, member, isInternalOwner, capabilities));
}
