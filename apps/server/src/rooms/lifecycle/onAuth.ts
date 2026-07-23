/**
 * H4 hardening (identity binding + client-version gate) for the `world`
 * Colyseus room.
 *
 * `WorldRoom.onAuth` (instance-level, see WorldRoom.ts) delegates here.
 * Colyseus calls this during the room join handshake, before `onJoin`
 * runs, and attaches the resolved `WorldAuth` to `client.auth` (see
 * node_modules/@colyseus/core/build/Room.mjs `_onJoin`). Every downstream
 * consumer of "who is this client" (onJoin.ts, sessionHandlers.ts) must
 * read `client.auth`, never `options.identity` — the latter is
 * client-supplied and was the actual privacy hole this module closes: the
 * H4 zone-privacy allow-lists are keyed on identity, so an unverified
 * identity would let a client claim someone else's zone membership.
 *
 * Fail-closed when enforcement is on (`ZONE_PRIVACY_AUTH_ENFORCE=true`): every
 * rejection path throws `ServerError`, which Colyseus turns into a
 * `client.error(code, message)` + clean disconnect (see Room.mjs `_onJoin`'s
 * catch block). During staged rollout (enforcement off, the default) a
 * token-less or old-version join is admitted with a warning so a server deploy
 * does not lock out desktop clients that predate the join-token change — see
 * `isAuthEnforced()` below. Even in staged mode a resolvable token always binds
 * the identity to the verified JWT subject; the client-supplied identity is
 * only ever used as the transitional fallback for a token-less join.
 */
import crypto from 'crypto';
import { ServerError, type AuthContext } from 'colyseus';
import { logger } from '../../logger.js';
import { validateSessionToken } from '../../api/utils/sessionAuth.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION, ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { RoomOptions } from '../WorldRoom.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

/**
 * Prisma surface onAuth needs: `session` to resolve the presented token against
 * its live session row, `tenant` to resolve a tenant's slug from its verified id.
 *
 * Required, not optional: session validation cannot happen without it, and an
 * "authenticate anyway" fallback for a caller that forgot to pass it is exactly
 * the signature-only trust this gate exists to remove.
 */
type WorldJoinPrisma = Pick<PrismaClient, 'tenant' | 'session'>;

/** Dedicated close/error codes for this gate, distinct from the existing
 * 4001-4007 range used by onJoin.limiter.ts / onJoin.completion.ts / guest
 * expiry, so the client can branch on "must re-login" vs "must update". */
export const AUTH_REJECTED_CODE = 4401;
export const CLIENT_TOO_OLD_CODE = 4426;

export interface WorldAuth {
  identity: string;
  tenantId?: string;
  // The AUTHENTICATED tenant slug, resolved from the JWT-verified tenantId.
  // Join-path consumers (presence seeding, guest expiry, map/bounds) must scope
  // by this, never by the client-supplied options.tenant, to avoid leaking
  // another tenant's members/presence. Absent for NPC and token-less joins.
  tenantSlug?: string;
  isNpc: boolean;
  zonePrivacyVersion: number;
}

/** Runtime shape check for `client.auth`. Colyseus types `Client.auth` as
 * `any` (arbitrary user data); this narrows it with a property check
 * instead of an unchecked cast, per LIBRARY_BOUNDARIES.md pattern 3. */
export function isWorldAuth(value: unknown): value is WorldAuth {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.identity === 'string' && typeof v.isNpc === 'boolean' && typeof v.zonePrivacyVersion === 'number';
}

/** Minimal manual cookie parser: `context.headers` is a Fetch `Headers`
 * instance (WebSocketTransport wraps the WS-upgrade request headers), not
 * an Express `Request` — cookie-parser does not apply here. Mirrors
 * cookie-parser's basic decode-per-pair behavior for the one cookie we need. */
function parseCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key !== name) continue;
    const value = part.slice(eqIdx + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

/** Order: Bearer/query token (Native/Tauri, via `client.auth.token` on the
 * SDK -> `_authToken` query param on the WS handshake) before the
 * `auth_token` cookie (Browser, sent automatically on the WS handshake for
 * same-site requests). Deterministic precedence when both are present. */
function resolveRawAuthToken(context: AuthContext): string | null {
  if (context.token) return context.token;
  const cookieHeader = context.headers.get('cookie');
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, 'auth_token');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

/** Analogous to getJwtSecret() in authHelpers.ts: refuses the known
 * insecure default once NODE_ENV=production, instead of only checking
 * "is it set at all" (a deployer could set NPC_SERVICE_SECRET=dev-npc-secret
 * verbatim and still pass an "is it set" check). */
function getNpcServiceSecret(): string {
  const fromEnv = process.env.NPC_SERVICE_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';
  if (fromEnv && fromEnv.length > 0) {
    if (isProduction && fromEnv === 'dev-npc-secret') {
      throw new ServerError(AUTH_REJECTED_CODE, 'npc_service_secret_insecure');
    }
    return fromEnv;
  }
  if (isProduction) {
    throw new ServerError(AUTH_REJECTED_CODE, 'npc_service_secret_missing');
  }
  return 'dev-npc-secret';
}

function authenticateNpc(options: RoomOptions): WorldAuth {
  const identity = options.identity;
  if (!identity) {
    throw new ServerError(AUTH_REJECTED_CODE, 'npc_identity_missing');
  }
  const expected = getNpcServiceSecret();
  const provided = options.serviceToken;
  if (!provided || !timingSafeEqualStrings(provided, expected)) {
    logger.warn('[WorldRoom] Rejected NPC join: invalid service token', { identity });
    throw new ServerError(AUTH_REJECTED_CODE, 'npc_service_token_invalid');
  }
  // NPCs are server-controlled (npc-service authenticates via
  // NPC_SERVICE_SECRET, not a per-user JWT) and are exempt from the
  // client zone-privacy version gate: they never publish LiveKit tracks.
  return { identity, isNpc: true, zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION };
}

/**
 * Staged rollout switch. When unset/false the gate BINDS the identity whenever
 * a token resolves (browsers via cookie, updated native clients via token) but
 * ADMITS a token-less or old-version join with a warning instead of rejecting
 * it. This lets the server ship before every independently-updating client
 * (the bundled desktop app) sends the join token / version, so a deploy does
 * not lock those users out of the world. Flip `ZONE_PRIVACY_AUTH_ENFORCE=true`
 * once client adoption is confirmed (watch the admit warnings) to make the
 * identity binding and version gate fully fail-closed. Browsers and the
 * npc-service update atomically with the server deploy and are unaffected by
 * the toggle.
 */
function isAuthEnforced(): boolean {
  return process.env.ZONE_PRIVACY_AUTH_ENFORCE === 'true';
}

/**
 * Independent staged-rollout switch for the TENANT-ROOM match check
 * (enforceTenantMatch), deliberately DECOUPLED from ZONE_PRIVACY_AUTH_ENFORCE.
 *
 * ZONE_PRIVACY_AUTH_ENFORCE (the H4 identity + client-version gate) is already
 * =true in production (set 2026-07-08). The tenant-room match must NOT ride on
 * that same flag: old clients (the bundled desktop app ships the auth-slug send
 * only in a later release) post `options.tenant='default'` for every tenant on
 * an apex domain, so enforcing the match under the already-on H4 flag would
 * mass-reject / lock those users out. Keep this DEFAULT-OFF (warn+log only) and
 * flip ZONE_PRIVACY_TENANT_ENFORCE=true once client adoption is confirmed —
 * before public launch. The fail-closed presence/map scoping (onJoin.completion)
 * and the per-client StateView room-state filter (WorldRoom players @view())
 * already isolate all DATA regardless of this flag; this only closes the
 * residual Colyseus room-partition sharing.
 */
function isTenantEnforced(): boolean {
  return process.env.ZONE_PRIVACY_TENANT_ENFORCE === 'true';
}

/**
 * Enforce that the room the client asked to join (`options.tenant`, the
 * Colyseus `filterBy(['tenant'])` partition key) matches the JWT-verified
 * tenant. Otherwise the player shares one WorldRoom with another tenant.
 *
 * Note: on an apex/root domain the web client derives no subdomain and, until
 * it ships the auth-slug send, posts `options.tenant='default'` for EVERY
 * tenant, collapsing all tenants into the 'default' room. This check is gated by
 * its OWN flag ZONE_PRIVACY_TENANT_ENFORCE (NOT the already-on
 * ZONE_PRIVACY_AUTH_ENFORCE — see isTenantEnforced): default-off warns+logs (so
 * those pre-update clients are not locked out right after a deploy), on rejects
 * the mismatch. The fail-closed presence/map scoping and the per-client
 * StateView room-state filter already isolate all DATA regardless; this only
 * closes the residual room-partition sharing. Flip enforce=on once clients send
 * the auth slug (see lib/colyseus.ts) — before public launch.
 */
function enforceTenantMatch(options: RoomOptions | undefined, authSlug: string | undefined, identity: string): void {
  const requested = options?.tenant;
  if (!authSlug || !requested || requested === authSlug) return;
  if (isTenantEnforced()) {
    logger.warn('[WorldRoom] Rejected join: options.tenant does not match authenticated tenant', {
      identity,
      requested,
      authenticated: authSlug,
    });
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_mismatch');
  }
  logger.warn('[WorldRoom] Admitted join with options.tenant != authenticated tenant (enforcement off)', {
    identity,
    requested,
    authenticated: authSlug,
  });
}

/** Resolve a tenant's slug from its (JWT-verified) id. Best-effort: returns
 * undefined on a missing id, missing resolver or a DB error, so a lookup
 * failure never blocks the join — the caller then falls back to the
 * client-supplied slug for non-security-critical uses only. */
async function resolveTenantSlug(
  prisma: Pick<WorldJoinPrisma, 'tenant'>,
  tenantId: string | undefined,
): Promise<string | undefined> {
  if (!tenantId) return undefined;
  try {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    return t?.slug ?? undefined;
  } catch (e) {
    logger.debug('[WorldRoom] Failed to resolve authenticated tenant slug', e);
    return undefined;
  }
}

async function authenticateUser(
  options: RoomOptions | undefined,
  context: AuthContext,
  prisma: WorldJoinPrisma,
): Promise<WorldAuth> {
  const raw = resolveRawAuthToken(context);
  // The SESSION ROW is the authority, not the JWT signature. Verifying the
  // signature alone (the previous behaviour) meant logout, session revocation
  // and password reset closed the REST door while leaving the world — presence,
  // camera, microphone — open for the token's remaining 30 days. The world is
  // the product, so it must apply the same authority REST does.
  const verified = raw ? await validateSessionToken(prisma, raw) : null;

  if (!verified) {
    if (isAuthEnforced()) {
      throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
    }
    // Staged rollout: a legacy client (old bundled desktop build) that predates
    // sending the join token. Fall back to the client-supplied identity — the
    // pre-H4 behavior — so it is not locked out. Zone privacy for this client
    // rests on an unverified identity until it updates; acceptable transitional
    // state, made observable via this warning.
    const fallbackId = options?.identity;
    if (!fallbackId) {
      throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
    }
    logger.warn('[WorldRoom] Admitted world join with UNVERIFIED identity (enforcement off)', {
      identity: fallbackId,
    });
    return { identity: fallbackId, isNpc: false, zonePrivacyVersion: options?.zonePrivacyVersion ?? 0 };
  }

  // Resolve the authoritative tenant slug once, then enforce that the room the
  // client asked for (options.tenant) matches it (flag-gated; warn-only during
  // rollout).
  const tenantSlug = await resolveTenantSlug(prisma, verified.tenantId);
  enforceTenantMatch(options, tenantSlug, verified.userId);

  const zonePrivacyVersion = options?.zonePrivacyVersion;
  if (typeof zonePrivacyVersion !== 'number' || zonePrivacyVersion < MIN_ZONE_PRIVACY_CLIENT_VERSION) {
    if (isAuthEnforced()) {
      logger.warn('[WorldRoom] Rejected join: client zone-privacy protocol version too old', {
        identity: verified.userId,
        zonePrivacyVersion,
        minRequired: MIN_ZONE_PRIVACY_CLIENT_VERSION,
      });
      throw new ServerError(CLIENT_TOO_OLD_CODE, 'client_too_old');
    }
    logger.warn('[WorldRoom] Admitted join from old zone-privacy client (enforcement off)', {
      identity: verified.userId,
      zonePrivacyVersion,
      minRequired: MIN_ZONE_PRIVACY_CLIENT_VERSION,
    });
    const legacy: WorldAuth = {
      identity: verified.userId,
      isNpc: false,
      zonePrivacyVersion: typeof zonePrivacyVersion === 'number' ? zonePrivacyVersion : 0,
    };
    if (verified.tenantId) legacy.tenantId = verified.tenantId;
    if (tenantSlug) legacy.tenantSlug = tenantSlug;
    return legacy;
  }

  const auth: WorldAuth = { identity: verified.userId, isNpc: false, zonePrivacyVersion };
  if (verified.tenantId) auth.tenantId = verified.tenantId;
  if (tenantSlug) auth.tenantSlug = tenantSlug;
  return auth;
}

/**
 * Colyseus `onAuth` entry point. Resolves the authoritative identity for a
 * `world` join. Never trusts `options.identity` for that purpose — it is
 * only accepted (via the NPC branch) as the fixed `npc-*` identity the
 * npc-service itself assigns, gated by a separate shared-secret check.
 *
 * The NPC branch is synchronous (and needs no database); the user branch awaits
 * the session lookup plus a tenant-slug lookup. The try/catch guarantees a
 * rejected, never a thrown, Promise so callers can rely on `Promise<WorldAuth>`
 * either way. `prisma` is REQUIRED: without it a token cannot be checked against
 * its session row, and admitting a join on the signature alone is the hole this
 * gate closes.
 */
export function authenticateWorldJoin(
  options: RoomOptions | undefined,
  context: AuthContext,
  prisma: WorldJoinPrisma,
): Promise<WorldAuth> {
  try {
    if (options?.identity?.startsWith('npc-')) {
      return Promise.resolve(authenticateNpc(options));
    }
    return authenticateUser(options, context, prisma);
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

/**
 * Reads the `WorldAuth` payload `onAuth()` attached to `client.auth`, for
 * call sites inside `onJoin` (see onJoin.ts). Colyseus guarantees `onAuth`
 * ran and populated `client.auth` before `onJoin` fires (Room.mjs
 * `_onJoin`), so a missing/malformed value here means a room build without
 * this gate wired up — fail closed rather than fall back to
 * `options.identity`. Safe to throw: `onJoin` errors are caught by
 * Colyseus and turned into a clean client disconnect (Room.mjs `_onJoin`'s
 * catch block), not an unhandled rejection.
 */
export function requireWorldAuth(client: { auth?: unknown }): WorldAuth {
  if (!isWorldAuth(client.auth)) {
    throw new ServerError(AUTH_REJECTED_CODE, 'missing_world_auth');
  }
  return client.auth;
}
