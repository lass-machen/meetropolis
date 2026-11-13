/**
 * Identity binding and client-version gate for the `world` room.
 *
 * Matchmaking calls `authenticateWorldMatchmake`, which resolves the raw
 * token and delegates to `authenticateWorldJoin`. Colyseus stores the
 * returned value as seat auth data and copies it onto `client.auth` when
 * the seat is consumed. Registration runs at the start of `onJoin`.
 * Reconnect does not enter `onJoin`.
 *
 * Consumers read `client.auth`, never `options.identity`. Every rejection
 * throws `ServerError`. Humans need a fresh allowed session and the current
 * zone-privacy version. NPC joins are a service principal and do not use
 * that version check.
 */
import { ServerError, type AuthContext } from 'colyseus';
import { logger } from '../../logger.js';
import { verifyAuthJwt } from '../../api/utils/authHelpers.js';
import { validateTenantSessionFresh } from '../../api/utils/sessionAuth.js';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION, ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import type { RoomOptions } from '../WorldRoom.js';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { clientNumberForLog, clientStringForLog } from './logSafe.js';
import { resolveNpcPrincipal, verifyNpcServiceToken } from './npcServiceAuth.js';

/** Dedicated close codes so the client can tell re-login from update. */
export const AUTH_REJECTED_CODE = 4401;
export const CLIENT_TOO_OLD_CODE = 4426;

export interface WorldAuth {
  identity: string;
  tenantId?: string;
  // Authenticated tenant slug. Join consumers must scope by this, never by
  // the client-supplied options.tenant.
  tenantSlug?: string;
  // Database session id for a human. Null for an NPC. Safe to serialize;
  // never a raw token or a token hash.
  sessionId: string | null;
  // Same session id, read by the access registry until it uses `sessionId`.
  // Absent for an NPC, which is not registered.
  authSessionId?: string;
  isNpc: boolean;
  zonePrivacyVersion: number;
}

/** Runtime shape check for `client.auth` (Colyseus types it as arbitrary data). */
export function isWorldAuth(value: unknown): value is WorldAuth {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.identity === 'string' &&
    typeof record.isNpc === 'boolean' &&
    typeof record.zonePrivacyVersion === 'number'
  );
}

/** Decode one cookie pair. `context.headers` is a Fetch `Headers` object. */
export function parseCookieValue(cookieHeader: string, name: string): string | null {
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

/**
 * Bearer or query token first, then the `auth_token` cookie. `presentedToken`
 * is the argument Colyseus passes to static `onAuth` and wins when set.
 */
export function resolveRawAuthToken(context: AuthContext, presentedToken?: string): string | null {
  if (typeof presentedToken === 'string' && presentedToken.length > 0) return presentedToken;
  if (context.token) return context.token;
  const cookieHeader = context.headers.get('cookie');
  if (!cookieHeader) return null;
  return parseCookieValue(cookieHeader, 'auth_token');
}

/**
 * Switch for the tenant-room match. On by default: a join whose room belongs
 * to another tenant than the verified session is rejected. Only an explicit
 * `ZONE_PRIVACY_TENANT_ENFORCE=false` turns it off; then the mismatch is
 * logged and admitted. Off is not isolated: a room-wide message such as the
 * presence relay reaches every client in the room, including a foreign one.
 */
export function isTenantEnforced(): boolean {
  return process.env.ZONE_PRIVACY_TENANT_ENFORCE !== 'false';
}

/**
 * `options.tenant` is the room partition key and must match the authenticated
 * slug. A missing slug skips this check. A mismatch is rejected only while
 * the tenant switch is on.
 */
function enforceTenantMatch(options: RoomOptions | undefined, authSlug: string | undefined, identity: string): void {
  const requested = options?.tenant;
  if (!authSlug || !requested || requested === authSlug) return;
  if (isTenantEnforced()) {
    logger.warn('[WorldRoom] Rejected join: options.tenant does not match authenticated tenant', {
      identity,
      requested: clientStringForLog(requested),
      authenticated: authSlug,
    });
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_mismatch');
  }
  logger.warn('[WorldRoom] Admitted join with options.tenant != authenticated tenant (enforcement off)', {
    identity,
    requested: clientStringForLog(requested),
    authenticated: authSlug,
  });
}

/** Slug the room would file this join under when the client omits one. */
function joinTenantSlug(options: RoomOptions | undefined): string {
  const requested = options?.tenant;
  if (typeof requested === 'string' && requested.length > 0) return requested;
  return process.env.DEFAULT_TENANT_SLUG || 'default';
}

/** Tenant row for the join slug. Undefined when the row is missing or the read fails. */
async function resolveJoinTenant(
  prisma: PrismaClient,
  options: RoomOptions | undefined,
): Promise<{ id: string; slug: string } | undefined> {
  try {
    const row = await prisma.tenant.findUnique({
      where: { slug: joinTenantSlug(options) },
      select: { id: true, slug: true },
    });
    if (!row?.id || !row.slug) return undefined;
    return { id: row.id, slug: row.slug };
  } catch (error) {
    logger.debug('[WorldRoom] Failed to resolve tenant from join options', error);
    return undefined;
  }
}

async function requireJoinTenant(
  prisma: PrismaClient,
  options: RoomOptions | undefined,
): Promise<{ id: string; slug: string }> {
  const tenant = await resolveJoinTenant(prisma, options);
  if (!tenant) {
    logger.warn('[WorldRoom] Rejected join: verified tenant has no resolvable slug');
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_unresolved');
  }
  return tenant;
}

/** Slug for a proven tenant id. Undefined on a missing row or a read error. */
async function resolveTenantSlug(prisma: PrismaClient, tenantId: string | undefined): Promise<string | undefined> {
  if (!tenantId) return undefined;
  try {
    const row = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } });
    return row?.slug ?? undefined;
  } catch (error) {
    logger.debug('[WorldRoom] Failed to resolve authenticated tenant slug', error);
    return undefined;
  }
}

function refuseFreshSession(
  result:
    | { status: 'unauthenticated' }
    | { status: 'forbidden'; reason: 'membership_unavailable' | 'verification_required' | 'tenant_unavailable' },
): never {
  if (result.status === 'unauthenticated') {
    logger.warn('[WorldRoom] Rejected world join without a valid session');
    throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
  }
  if (result.reason === 'tenant_unavailable') {
    logger.warn('[WorldRoom] Rejected join: verified tenant has no resolvable slug');
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_unresolved');
  }
  logger.warn('[WorldRoom] Rejected join: no access to the session tenant');
  const message = result.reason === 'verification_required' ? 'verification_required' : 'not_member_of_tenant';
  throw new ServerError(AUTH_REJECTED_CODE, message);
}

/** Humans must send the current zone-privacy version. NPC joins do not. */
function requireZonePrivacyVersion(options: RoomOptions | undefined, identity: string): number {
  const zonePrivacyVersion = options?.zonePrivacyVersion;
  if (typeof zonePrivacyVersion === 'number' && zonePrivacyVersion >= MIN_ZONE_PRIVACY_CLIENT_VERSION) {
    return zonePrivacyVersion;
  }
  logger.warn('[WorldRoom] Rejected join: client zone-privacy protocol version too old', {
    identity,
    zonePrivacyVersion: clientNumberForLog(zonePrivacyVersion),
    minRequired: MIN_ZONE_PRIVACY_CLIENT_VERSION,
  });
  throw new ServerError(CLIENT_TOO_OLD_CODE, 'client_too_old');
}

/**
 * Join-lifecycle callback. Fires once the session is allowed, before the
 * remaining slug and version checks. The room registers the seat later,
 * when `onJoin` has a session id.
 */
export interface WorldJoinHooks {
  onSessionVerified?: (userId: string, tenantId: string | undefined) => void;
}

async function authenticateUser(
  options: RoomOptions | undefined,
  context: AuthContext,
  prisma: PrismaClient,
  hooks: WorldJoinHooks | undefined,
): Promise<WorldAuth> {
  const raw = resolveRawAuthToken(context);
  if (!raw) {
    logger.warn('[WorldRoom] Rejected world join without a valid session');
    throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
  }
  // The proven tenant is the JWT `tid` claim, never the client-supplied
  // `options.tenant` (which `enforceTenantMatch` only checks flag-gated below).
  const claims = verifyAuthJwt(raw);
  if (!claims) {
    logger.warn('[WorldRoom] Rejected world join without a valid session');
    throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
  }
  const tid = claims.tenantId;
  if (!tid) {
    logger.warn('[WorldRoom] Rejected join: verified tenant has no resolvable slug');
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_unresolved');
  }
  const verified = await validateTenantSessionFresh(prisma, raw, tid);
  if (verified.status !== 'allowed') refuseFreshSession(verified);
  if (verified.access !== 'member' && verified.access !== 'platform_operator') {
    throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
  }
  hooks?.onSessionVerified?.(verified.userId, verified.tenantId);
  const tenantSlug = await resolveTenantSlug(prisma, verified.tenantId);
  if (!verified.tenantId || !tenantSlug) {
    logger.warn('[WorldRoom] Rejected join: verified tenant has no resolvable slug', {
      identity: verified.userId,
    });
    throw new ServerError(AUTH_REJECTED_CODE, 'tenant_unresolved');
  }
  enforceTenantMatch(options, tenantSlug, verified.userId);
  const zonePrivacyVersion = requireZonePrivacyVersion(options, verified.userId);
  return {
    identity: verified.userId,
    tenantId: verified.tenantId,
    tenantSlug,
    sessionId: verified.sessionId,
    authSessionId: verified.sessionId,
    isNpc: false,
    zonePrivacyVersion,
  };
}

/** Service token, then the NPC row for this tenant. No zone-privacy gate. */
async function authenticateNpc(options: RoomOptions, prisma: PrismaClient): Promise<WorldAuth> {
  const identity = options.identity;
  if (typeof identity !== 'string' || identity.length === 0) {
    throw new ServerError(AUTH_REJECTED_CODE, 'npc_identity_missing');
  }
  if (!verifyNpcServiceToken(options.serviceToken)) {
    logger.warn('[WorldRoom] Rejected NPC join: invalid service token', {
      identity: clientStringForLog(identity),
    });
    throw new ServerError(AUTH_REJECTED_CODE, 'npc_service_token_invalid');
  }
  const tenant = await requireJoinTenant(prisma, options);
  const principal = await resolveNpcPrincipal(prisma, tenant.id, identity);
  const joinIdentity = principal ? `npc-${principal.identity}` : '';
  if (!principal || joinIdentity !== identity) {
    logger.warn('[WorldRoom] Rejected NPC join: no matching npc', {
      identity: clientStringForLog(identity),
    });
    throw new ServerError(AUTH_REJECTED_CODE, 'unauthorized');
  }
  return {
    identity: joinIdentity,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    sessionId: null,
    isNpc: true,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  };
}

/**
 * Resolves the authoritative world identity. A presented `serviceToken`
 * selects the NPC principal and never a user. Otherwise the human path
 * ignores `options.identity`. `hooks` is optional; direct callers may omit it.
 */
export async function authenticateWorldJoin(
  options: RoomOptions | undefined,
  context: AuthContext,
  prisma: PrismaClient,
  hooks?: WorldJoinHooks,
): Promise<WorldAuth> {
  try {
    if (typeof options?.serviceToken === 'string') {
      return await authenticateNpc(options, prisma);
    }
    return await authenticateUser(options, context, prisma, hooks);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** `client.auth` after a successful auth. Missing or malformed data is rejected. */
export function requireWorldAuth(client: { auth?: unknown }): WorldAuth {
  if (!isWorldAuth(client.auth)) {
    throw new ServerError(AUTH_REJECTED_CODE, 'missing_world_auth');
  }
  return client.auth;
}
