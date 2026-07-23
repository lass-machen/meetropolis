import { Client, Room } from '@colyseus/sdk';
import { ZONE_PRIVACY_PROTOCOL_VERSION } from '@meetropolis/shared';
import { logger } from './logger';
import { readTimeoutMs } from './runtimeConfig';
import type { WorldRoomState } from '../types/colyseus';

function normalizeServerUrl(serverUrl: string): string {
  let baseUrl = serverUrl;
  if (typeof baseUrl !== 'string') {
    logger.error('[Colyseus] serverUrl is not a string:', baseUrl, typeof baseUrl);
    throw new Error(`Invalid serverUrl type: ${typeof baseUrl}`);
  }
  // normalize base: remove trailing slashes to avoid double '//'
  if (baseUrl.endsWith('/')) baseUrl = baseUrl.replace(/\/+$/g, '');
  // Properly handle both http and https URLs
  if (baseUrl.startsWith('https://')) {
    return baseUrl.replace('https://', 'wss://');
  }
  if (baseUrl.startsWith('http://')) {
    return baseUrl.replace('http://', 'ws://');
  }
  return baseUrl;
}

// The authenticated tenant slug (from /auth/me). Set once the session is known;
// it is the AUTHORITATIVE Colyseus room partition key. Needed because an apex
// domain (meetropolis.me, or dev meetropolis.localhost) yields no subdomain, so
// without this every tenant would derive 'default' and share one WorldRoom.
let authTenantSlug: string | null = null;

/** Set/clear the authenticated tenant slug used for the world-room partition. */
export function setAuthTenantSlug(slug: string | null | undefined): void {
  authTenantSlug = slug || null;
}

// Exported for tests. The world join uses this as options.tenant.
export function deriveTenant(): string {
  // Authenticated tenant wins: it is verified server-side (onAuth) and keeps the
  // room partition consistent with REST regardless of hostname shape.
  if (authTenantSlug) return authTenantSlug;
  // Fallback (no session yet / token-less): derive from a subdomain, else 'default'.
  let tenant = 'default';
  try {
    const webBase = (typeof window !== 'undefined' ? window.__MEETROPOLIS_WEB_BASE__ : '') || '';

    // Extract tenant from subdomain (≥3 hostname parts)
    // e.g., "https://demo.meetropolis.me" → "demo"
    // Apex domains (e.g., "https://meetropolis.me") → keep default
    if (webBase) {
      try {
        const hostname = new URL(webBase).hostname;
        const parts = hostname.split('.');
        if (parts.length >= 3) tenant = parts[0];
      } catch {}
    } else {
      // Fallback: extract from browser hostname (Web)
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const parts = host.split('.');
      if (parts.length >= 3) tenant = parts[0];
    }
  } catch {}
  return tenant;
}

/**
 * Concrete join-options shape this app sends to the Colyseus server. The
 * upstream SDK declares `JoinOptions = any`; we narrow to the fields the
 * `world` room actually consumes so the call site stays type-safe.
 */
interface WorldJoinOptions {
  identity?: string | undefined;
  name?: string | undefined;
  x?: number | undefined;
  y?: number | undefined;
  direction?: string | undefined;
  tenant?: string | undefined;
  avatarId?: string | undefined;
  mapName?: string | undefined;
  // Local Do-Not-Disturb state, re-asserted on every (re-)join so the
  // server's in-memory Player.dnd survives reconnects/restarts/takeovers
  // (see apps/server/src/rooms/lifecycle/onJoin.completion.ts).
  dnd?: boolean | undefined;
  // H4 hardening: honesty-based protocol version, checked server-side
  // against MIN_ZONE_PRIVACY_CLIENT_VERSION (see
  // apps/server/src/rooms/lifecycle/onAuth.ts). Always the current build's
  // constant; there is no reason for a caller to override it.
  zonePrivacyVersion?: number | undefined;
}

async function joinRoomWithTimeout(client: Client, joinOptions: WorldJoinOptions): Promise<Room<WorldRoomState>> {
  const joinTimeoutMs = readTimeoutMs('VITE_COLYSEUS_JOIN_TIMEOUT_MS', 15_000);
  const JOIN_TIMEOUT_SENTINEL = Symbol('colyseus_join_timeout');
  const joinPromise = client.joinOrCreate('world', joinOptions);
  let joinTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const joinTimeoutPromise = new Promise<typeof JOIN_TIMEOUT_SENTINEL>((resolve) => {
    joinTimeoutId = setTimeout(() => resolve(JOIN_TIMEOUT_SENTINEL), joinTimeoutMs);
  });

  try {
    const result = await Promise.race([joinPromise, joinTimeoutPromise]);
    if (result === JOIN_TIMEOUT_SENTINEL) {
      // Best-effort: if the join eventually succeeds, make sure we leave.
      void joinPromise
        .then((r) => {
          try {
            void r.leave?.();
          } catch {}
        })
        .catch(() => {});
      throw new Error('colyseus_join_timeout');
    }
    return result as Room<WorldRoomState>;
  } finally {
    if (joinTimeoutId !== undefined) clearTimeout(joinTimeoutId);
  }
}

async function awaitInitialStateSync(room: Room<WorldRoomState>): Promise<void> {
  // Wait for the initial state sync, bounded so the wait cannot hang forever.
  const stateTimeoutMs = readTimeoutMs('VITE_COLYSEUS_STATE_TIMEOUT_MS', 5_000);
  const stopAt = Date.now() + stateTimeoutMs;
  await new Promise<void>((resolve, reject) => {
    const checkState = () => {
      if (room.state && room.state.players) {
        resolve();
        return;
      }
      if (Date.now() >= stopAt) {
        reject(new Error('colyseus_state_timeout'));
        return;
      }
      setTimeout(checkState, 100);
    };
    // Give it one tick to potentially sync
    setTimeout(checkState, 0);
  });
}

export async function joinWorld(
  serverUrl: string,
  identity?: string,
  name?: string,
  position?: { x: number; y: number; direction?: string },
  mapName?: string,
  authToken?: string,
  dnd?: boolean,
) {
  logger.debug('[Colyseus] joinWorld called with serverUrl:', serverUrl);
  const wsUrl = normalizeServerUrl(serverUrl);
  logger.debug('[Colyseus] wsUrl after conversion:', wsUrl, 'type:', typeof wsUrl);

  const tenant = deriveTenant();
  logger.debug('[Colyseus] Creating client with wsUrl:', wsUrl, 'tenant:', tenant);

  const client = new Client(wsUrl);
  // H4 hardening: Native/Tauri clients cannot rely on the cross-site auth
  // cookie during the Colyseus join handshake (see
  // apps/server/src/rooms/lifecycle/onAuth.ts), so they must present the
  // JWT explicitly. The OSS browser build never passes authToken, so this
  // stays a no-op there and the cookie continues to authenticate the join.
  if (authToken) {
    client.auth.token = authToken;
  }
  logger.debug('[Colyseus] Client created, joining room...');
  const avatarId = typeof window !== 'undefined' ? localStorage.getItem('avatarId') || undefined : undefined;

  const room = await joinRoomWithTimeout(client, {
    identity,
    name,
    x: position?.x,
    y: position?.y,
    direction: position?.direction,
    tenant,
    avatarId,
    mapName,
    dnd,
    zonePrivacyVersion: ZONE_PRIVACY_PROTOCOL_VERSION,
  });

  await awaitInitialStateSync(room);
  return room;
}
