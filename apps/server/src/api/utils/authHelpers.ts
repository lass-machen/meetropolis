import type express from 'express';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { logger } from '../../logger.js';
import { type AuthTokenPayload } from '../../types/authShapes.js';
import { getAuthResolution } from './authState.js';

/** Holder for the dev-only ephemeral JWT secret. */
interface DevJwtSecretHolder {
  __DEV_JWT_SECRET__?: string;
}

const COOKIE_NAME = 'auth_token';

let cachedJwtSecret: string | null = null;
let cachedApiTokenPepper: string | null = null;

export function getJwtSecret(): string {
  if (cachedJwtSecret) return cachedJwtSecret;
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) {
    cachedJwtSecret = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET missing in production');
  }
  // Development: ephemeral secret, only used for local sessions.
  const holder = globalThis as DevJwtSecretHolder;
  const key = holder.__DEV_JWT_SECRET__;
  if (key && key.length > 0) return key;
  const devSecret = crypto.randomBytes(32).toString('hex');
  try {
    logger.warn('[SECURITY] JWT_SECRET missing, using an ephemeral dev secret.');
  } catch {}
  holder.__DEV_JWT_SECRET__ = devSecret;
  cachedJwtSecret = devSecret;
  return devSecret;
}

export function getApiTokenPepper(): string {
  if (cachedApiTokenPepper) return cachedApiTokenPepper;
  const fromEnv = process.env.API_TOKEN_PEPPER;
  if (fromEnv && fromEnv.length > 0) {
    cachedApiTokenPepper = fromEnv;
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] API_TOKEN_PEPPER missing in production');
  }
  const devPepper = crypto.randomBytes(32).toString('hex');
  logger.warn('[SECURITY] API_TOKEN_PEPPER missing, using an ephemeral dev pepper. Tokens lose validity on restart.');
  cachedApiTokenPepper = devPepper;
  return devPepper;
}

export function setAuthCookie(res: express.Response, token: string) {
  const isProduction = process.env.NODE_ENV === 'production';
  // Allow explicit override of secure cookie flag (useful for local Docker testing)
  const cookieSecureEnv = process.env.COOKIE_SECURE;
  const secure = cookieSecureEnv !== undefined ? cookieSecureEnv === 'true' : isProduction;
  // Use 'strict' in production for CSRF protection, 'lax' in development for easier testing
  // Note: 'strict' prevents cookie from being sent on cross-site navigation,
  // which provides strong CSRF protection but may require users to re-login after following external links
  const sameSite = isProduction ? 'strict' : 'lax';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: sameSite,
    secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

/**
 * Verify a raw JWT (cookie or Bearer value) against our signing secret and
 * extract the identity it carries. Single verification path shared by REST
 * (`requireAuth` below) and the Colyseus world-join gate
 * (rooms/lifecycle/onAuth.ts) so both surfaces trust the same signature and
 * payload shape — see AGENTS.md "no swallowed errors" / avoid drift between
 * auth paths.
 */
export function verifyAuthJwt(raw: string): { userId: string; tenantId?: string } | null {
  try {
    const payload = jwt.verify(raw, getJwtSecret()) as AuthTokenPayload;
    if (typeof payload.sub !== 'string') return null;
    const tenantId = typeof payload.tid === 'string' ? payload.tid : undefined;
    return { userId: payload.sub, tenantId };
  } catch {
    return null;
  }
}

/**
 * The authenticated identity behind this request, or null.
 *
 * Authority is the `Session` row, not the JWT signature: the token has already
 * been verified AND matched against a live session by the session-auth
 * middleware (createSessionAuthMiddleware in sessionAuth.ts), which publishes
 * the outcome for this synchronous read. A revoked session therefore stops
 * authenticating immediately — previously a valid signature alone was enough,
 * so revoking a session or changing the password left the cookie working for
 * the remaining 30 days of the token's lifetime.
 *
 * Fails closed when the middleware never ran (route registered ahead of it, or
 * an Express app that does not mount it): without a resolution we have no
 * validated identity, and inventing one from the signature is exactly the hole
 * this replaces.
 */
export function requireAuth(req: express.Request): { userId: string; tenantId?: string } | null {
  const resolution = getAuthResolution(req);
  if (!resolution) {
    logger.error({
      event: 'auth.session_middleware_missing',
      path: typeof req.path === 'string' ? req.path : undefined,
    });
    return null;
  }
  const { auth } = resolution;
  if (!auth) return null;
  return { userId: auth.userId, tenantId: auth.tenantId };
}

export async function requireApiToken(req: express.Request, prisma: PrismaClient): Promise<{ userId: string } | null> {
  const authz = req.headers['authorization']?.toString();
  if (!authz || !authz.startsWith('Bearer ')) return null;
  const token = authz.slice('Bearer '.length).trim();
  if (!token || token.split('.').length === 3) {
    // Looks like a JWT -> do not treat as an API token
    return null;
  }
  const hash = crypto
    .createHash('sha256')
    .update(getApiTokenPepper() + token)
    .digest('hex');
  const found = await prisma.apiToken.findUnique({ where: { hash } });
  if (!found) return null;
  await prisma.apiToken.update({ where: { hash }, data: { lastUsedAt: new Date() } });
  return { userId: found.userId };
}

/**
 * Projection of the resolved tenant for route handlers.
 *
 * `name` is the human-readable company/team name and is what any user-facing
 * text must show; `slug` is the URL/routing key and reads like an ID to a
 * recipient ("acme-gmbh-2" rather than "Acme GmbH"). Both are carried so a
 * caller never has to reach for the slug when it means the name.
 */
export function getTenantFromReq(
  req: express.Request,
): { id: string; slug: string; name: string; bypassLimits?: boolean; isInternal?: boolean } | null {
  const t: Tenant | undefined = req.tenant;
  if (t && t.id && t.slug)
    return { id: t.id, slug: t.slug, name: t.name, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  return null;
}

export function getUserIdFromReq(req: express.Request): string | null {
  const auth = requireAuth(req);
  return auth?.userId ?? null;
}

export async function requireMembership(
  req: express.Request,
  userId: string,
  prisma: PrismaClient,
): Promise<{ role: string } | null> {
  const tenant = getTenantFromReq(req);
  if (!tenant) return null;
  const m = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId } } });
  if (!m) return null;
  return { role: m.role };
}

export async function requireSuperAdmin(
  req: express.Request,
  prisma: PrismaClient,
): Promise<{ userId: string } | null> {
  const auth = requireAuth(req) || (await requireApiToken(req, prisma));
  if (!auth) return null;
  const ok = await requireInternalOwner(req, auth.userId, prisma);
  if (!ok) return null;
  return auth;
}

export async function requireInternalOwner(
  _req: express.Request,
  userId: string,
  prisma: PrismaClient,
): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    if (!internal) return false;
    const member = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: internal.id, userId } },
    });
    if (!member) return false;
    return member.role === 'owner';
  } catch {
    return false;
  }
}

/**
 * Tenant roles that confer administrative authority over a tenant (billing and
 * tenant-scoped admin actions). `owner` and `admin` qualify; `member` and
 * `guest` do not. Stored as strings because the Prisma `Role` enum resolves to a
 * string-literal union at runtime.
 */
const TENANT_ADMIN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

/**
 * Express middleware factory guarding tenant-administrative routes — chiefly the
 * enterprise `/billing/*` surface, into which the OSS host injects this guard via
 * the billing loader config (see api.ts / billingLoader.ts).
 *
 * The guard enforces, in order:
 *   1. a valid authenticated session (`requireAuth`)             -> 401 otherwise;
 *   2. a tenant resolved into `req.tenant` by `tenantMiddleware`  -> 400 otherwise;
 *   3. the caller administers that resolved tenant — i.e. holds an owner/admin
 *      Membership in it, OR is a platform super-admin.
 *
 * Step 3 is the security-critical part (M2/M4). Tenant resolution (tenancy.ts)
 * trusts the `X-Tenant` request header, so WITHOUT a membership lookup any
 * authenticated user could drive a foreign tenant's billing routes — create or
 * overwrite its Stripe customer, open a checkout, change or cancel its plan —
 * merely by sending that header. Binding the caller's identity to a membership in
 * the resolved tenant makes access strictly tenant-scoped: a spoofed header names
 * a tenant the caller does not administer and the request is refused.
 *
 * A platform super-admin (internal owner) is allowed through because it governs
 * every tenant by design — it already administers all tenants via the
 * `requireSuperAdmin`-gated `/admin/*` routes — so gating it out here would be a
 * false denial, not added safety. This also preserves the super-admin goodwill
 * tools that place `requireTenantAdmin` in front of an inner `requireSuperAdmin`
 * check (e.g. `/billing/start-trial`). The super-admin lookup runs only on the
 * fallback path, after the membership lookup misses, so the common tenant-admin
 * request costs a single indexed lookup.
 *
 * A missing tenant, a missing membership and an insufficient role deliberately
 * all resolve to the same 403 so a caller cannot use status codes to tell "not my
 * tenant" apart from "no such access" and thereby enumerate tenants or roles.
 *
 * The returned handler is synchronous (returns void, matching the loader
 * contract) and runs its asynchronous checks in a self-contained task whose
 * errors are handled internally — no rejection escapes to Express.
 */
export function createRequireTenantAdmin(
  prisma: PrismaClient,
): (req: express.Request, res: express.Response, next: express.NextFunction) => void {
  return (req, res, next) => {
    void (async () => {
      try {
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
        const membership = await prisma.membership.findUnique({
          where: { tenantId_userId: { tenantId: tenant.id, userId: auth.userId } },
          select: { role: true },
        });
        if (membership && TENANT_ADMIN_ROLES.has(membership.role)) {
          next();
          return;
        }
        // Fallback: a platform super-admin administers every tenant by design.
        const superAdmin = await requireSuperAdmin(req, prisma);
        if (superAdmin) {
          next();
          return;
        }
        res.status(403).json({ error: 'forbidden' });
      } catch (err) {
        logger.error({
          event: 'auth.require_tenant_admin.error',
          error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.status(500).json({ error: 'membership_check_failed' });
        }
      }
    })();
  };
}

export function normalizeEmailForStorage(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeEmailForMatching(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const plusIndex = local.indexOf('+');
  const localBase = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
  return `${localBase}@${domain}`;
}

/** Narrow projection of a Colyseus world player used by usage calculation. */
interface UsagePlayer {
  identity?: string;
  isNpc?: boolean;
}

/** Narrow projection of a Colyseus world room used by tenant usage calculation. */
interface UsageRoom {
  metadata?: { tenant?: string };
  state?: { players?: { forEach?: (cb: (p: UsagePlayer) => void) => void } };
}

/**
 * Canonical live concurrency per tenant (E3.1/E3.2): distinct, non-NPC
 * identities currently present in Colyseus, aggregated across ALL rooms of a
 * tenant (global in-memory registry). One identity = one connection, so a user
 * present in several room shards or with a transient duplicate session counts
 * once. This single count is the source for the adminLoader usage display AND —
 * via the loader-v3 `getConcurrentUsage` injection (see api.ts) — the EE
 * billing status route, so displayed and enforced concurrency cannot diverge.
 *
 * Single-node only: `global.activeWorldRooms` is process-local. Horizontal
 * scaling would need a shared (Redis) presence set — see design doc F/D11.
 */
export function computeOnlineUsageByTenantSlug(): Record<string, number> {
  const identitiesByTenant: Record<string, Set<string>> = {};
  try {
    const activeWorldRooms = global.activeWorldRooms as unknown as Set<UsageRoom> | undefined;
    const rooms: UsageRoom[] = activeWorldRooms ? Array.from(activeWorldRooms.values()) : [];
    for (const r of rooms) {
      const slug = r.metadata?.tenant || 'default';
      const set = (identitiesByTenant[slug] ??= new Set<string>());
      r.state?.players?.forEach?.((p) => {
        const identity = p?.identity;
        if (!identity) return;
        if (p?.isNpc === true || identity.startsWith('npc-')) return;
        set.add(identity);
      });
    }
  } catch {}
  const usage: Record<string, number> = {};
  for (const [slug, set] of Object.entries(identitiesByTenant)) {
    usage[slug] = set.size;
  }
  return usage;
}
