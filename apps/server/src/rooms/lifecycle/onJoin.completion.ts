import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { sanitizePosition, sanitizePositionForMap, getMapCenter, type MapMeta } from '../utils/mapBoundsHelpers.js';
import { getAllBubbleMembers } from '../utils/bubbleHelpers.js';
import type { RoomMetadata } from './onJoin.limiter.js';
import { isWorldAuth } from './onAuth.js';
import { tenantKeyForClient, isPlayerVisibleToTenant, syncTenantViewsOnJoin } from './tenantView.js';
import { zoneLocksForClient } from '../handlers/zoneLockHandler.js';
import { warmZoneCatalog, trackMove } from '../audioZones/runtime.js';
import { isCustomAvatarId } from '../../services/avatarAccess.js';

// Fallback appearance when a join names no avatar at all, and the replacement
// for an id this path refuses to publish. Mirrors the `User.avatarId` column
// default (prisma/schema.prisma).
const DEFAULT_AVATAR_ID = 'default-characters:business_man';

// Wait until the client's onMessage handlers are likely registered before
// sending one-shot messages. Colyseus 0.17 resolves joinOrCreate faster than
// 0.15, which exposed a pre-existing race: the server raced the client's
// setupPlayerHandlers() and triggered "@colyseus/sdk: onMessage() not
// registered for type 'full_state'/'bubble_state'/'presence_recent'" warnings,
// so the client never received the initial state and the roster stayed empty.
const HANDLER_REGISTRATION_DELAY_MS = 200;

// Namespaced placeholder mapId for the (rare) case where no real map can be
// resolved for the tenant (transient DB error, or a tenant with zero maps).
// Namespacing by the verified tenant keeps two different tenants' unresolved
// players from colliding on a shared '' mapId, which would otherwise cross-
// deliver map-scoped broadcasts (player_joined etc.) between tenants sharing a
// room. The client cannot load this id and simply shows no map — the same
// outcome as an empty id, but tenant-isolated and never a bare empty string
// (Finding 7).
function unresolvedMapId(tenantNamespace: string | undefined): string {
  return tenantNamespace ? `__unresolved__:${tenantNamespace}` : '__unresolved__';
}

// Resolve the initial map (mapId + mapName) for a joining player.
// Looks up by name first, then falls back to tenant default, then to
// the first available map for this tenant. Final guard for empty
// mapName lives in the caller.
async function resolveInitialMap(
  room: WorldRoom,
  options: RoomOptions,
  authTenantId?: string,
): Promise<{ mapId: string; mapName: string }> {
  const requestedMapId = options?.mapId || '';
  // Only used by the fall-through/catch return; the resolved paths return early.
  const initialMapName = options?.mapName || '';

  try {
    const prismaForMap = room.prismaForPresence ?? createPrismaClient();

    // Scope every map lookup to the AUTHENTICATED tenant that onAuth verified
    // from the JWT (client.auth.tenantId, passed in as authTenantId), not to
    // the client-supplied options.tenant. The web client derives options.tenant
    // from the hostname subdomain, which is empty on a bare host (e.g. dev on
    // meetropolis.localhost) and makes the room fall back to 'default'. REST
    // resolves the tenant from the JWT, so the two diverge: the room pins the
    // player onto the default tenant's map while REST requests it under the
    // real tenant and 404s, leaving the world black. Anchoring on the verified
    // tenant keeps room and REST consistent and prevents a client from loading
    // another tenant's map. Fall back to the slug path only when no verified
    // tenant is available (e.g. NPC joins).
    const tenantSlug =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const mapWhere = authTenantId ? { tenantId: authTenantId } : { tenant: { slug: tenantSlug } };

    // Honour a client-supplied mapId only when it belongs to the authenticated
    // tenant (a stale/cross-tenant localStorage id is otherwise ignored).
    if (requestedMapId) {
      const owned = await prismaForMap.map.findFirst({
        where: { id: requestedMapId, ...mapWhere },
        select: { id: true, name: true },
      });
      if (owned) return { mapId: owned.id, mapName: owned.name };
    }

    if (initialMapName) {
      const mapByName = await prismaForMap.map.findFirst({
        where: { name: initialMapName, ...mapWhere },
        select: { id: true, name: true },
      });
      if (mapByName) return { mapId: mapByName.id, mapName: mapByName.name };
    }

    return await resolveTenantDefaultMap(prismaForMap, authTenantId, tenantSlug);
  } catch (e) {
    logger.debug('[WorldRoom] Failed to determine initial map', e);
  }
  return { mapId: unresolvedMapId(authTenantId ?? options?.tenant), mapName: initialMapName || 'office' };
}

// Fall back to the (authenticated) tenant's default map by its defaultMapName,
// then to its first map. Split out of resolveInitialMap to keep that function
// small; both queries stay scoped to the same authenticated tenant.
async function resolveTenantDefaultMap(
  prisma: ReturnType<typeof createPrismaClient>,
  authTenantId: string | undefined,
  tenantSlug: string,
): Promise<{ mapId: string; mapName: string }> {
  const mapWhere = authTenantId ? { tenantId: authTenantId } : { tenant: { slug: tenantSlug } };
  const tenant = await prisma.tenant.findUnique({
    where: authTenantId ? { id: authTenantId } : { slug: tenantSlug },
    select: { defaultMapName: true },
  });
  const defaultMapName = tenant?.defaultMapName || 'office';
  const defaultMap = await prisma.map.findFirst({
    where: { name: defaultMapName, ...mapWhere },
    select: { id: true, name: true },
  });
  if (defaultMap) return { mapId: defaultMap.id, mapName: defaultMap.name };
  const firstMap = await prisma.map.findFirst({
    where: { ...mapWhere },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });
  if (firstMap) return { mapId: firstMap.id, mapName: firstMap.name };
  return { mapId: unresolvedMapId(authTenantId ?? tenantSlug), mapName: defaultMapName };
}

// Ensure room map metadata is loaded (race against onCreate-loader).
async function ensureRoomMapMetadata(room: WorldRoom, options: RoomOptions, authTenantSlug?: string): Promise<void> {
  try {
    if (!room.mapWidthTiles || !room.mapHeightTiles || !room.tileWidthPx || !room.tileHeightPx || !room.defaultSpawn) {
      const prisma = createPrismaClient();
      const tenantSlug =
        authTenantSlug ??
        (options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default');
      const tenantRec = await prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { defaultMapName: true },
      });
      const mapName = tenantRec?.defaultMapName || process.env.DEFAULT_MAP_NAME || 'office';
      let map = await prisma.map.findFirst({ where: { name: mapName, tenant: { slug: tenantSlug } } });
      if (!map) {
        map = await prisma.map.findFirst({
          where: { tenant: { slug: tenantSlug } },
          orderBy: { createdAt: 'asc' },
        });
      }
      try {
        await prisma.$disconnect().catch(() => {});
      } catch (e) {
        logger.debug('[WorldRoom] Failed to disconnect prisma', e);
      }
      if (map) {
        try {
          room.mapWidthTiles = map.width ?? room.mapWidthTiles;
          room.mapHeightTiles = map.height ?? room.mapHeightTiles;
          room.tileWidthPx = map.tileWidth ?? room.tileWidthPx;
          room.tileHeightPx = map.tileHeight ?? room.tileHeightPx;
        } catch (e) {
          logger.debug('[WorldRoom] Failed to update map metadata', e);
        }
        const meta = (map.meta as MapMeta) || {};
        const sp = meta?.spawn;
        if (!room.defaultSpawn && sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
          room.defaultSpawn = sanitizePosition(room, sp.x, sp.y);
        }
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to ensure map metadata on join', e);
  }
}

// Resolve display name + avatarId from DB if needed.
async function resolveNameAndAvatar(
  room: WorldRoom,
  options: RoomOptions,
  joiningIdentity: string,
): Promise<{ name: string; avatarId: string | undefined }> {
  let resolvedName: string | undefined = options?.name;
  let resolvedAvatarId: string | undefined = undefined;
  const isNpcIdentity = (joiningIdentity || '').startsWith('npc-');
  const needsNameLookup = !resolvedName || resolvedName === joiningIdentity;
  if (!isNpcIdentity && (needsNameLookup || !options?.avatarId)) {
    try {
      const prisma = room.prismaForPresence ?? createPrismaClient();
      const user = await prisma.user.findUnique({
        where: { id: joiningIdentity },
        select: { name: true, email: true, avatarId: true },
      });
      if (needsNameLookup) {
        resolvedName = user?.name || user?.email || joiningIdentity;
      }
      resolvedAvatarId = user?.avatarId ?? undefined;
    } catch (e) {
      logger.debug('[WorldRoom] Failed to look up user name/avatar from DB', e);
      if (needsNameLookup) {
        resolvedName = joiningIdentity;
      }
    }
  }
  return { name: resolvedName || joiningIdentity, avatarId: resolvedAvatarId };
}

// Resolve a tenant id from the client/room slug — ONLY for joins with no
// verified auth tenant (NPC or token-less legacy join). A normal authenticated
// user's tenant comes straight from the JWT (auth.tenantId) and never reaches
// this, so a spoofed options.tenant cannot influence a real user's PII scope.
async function resolveFallbackTenantId(
  prisma: ReturnType<typeof createPrismaClient>,
  options: RoomOptions,
  room: WorldRoom,
): Promise<string | undefined> {
  const slug =
    options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
  const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return tenant?.id ?? undefined;
}

// Send seed presence_recent to the new client. Best-effort, scoped by the
// JWT-VERIFIED auth.tenantId. That id comes straight off the token and never
// depends on a DB slug lookup, so — unlike the previous slug-based scope — it
// cannot fail open: a transient tenant-slug resolution failure (or a deleted
// tenant with a still-valid JWT) can no longer drop the scope onto the
// client-supplied options.tenant and leak another tenant's member list +
// presence. The slug fallback is reached ONLY when there is no verified tenant
// at all (NPC / token-less legacy join), never for a normal authenticated user.
async function seedPresenceRecent(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  authTenantId?: string,
): Promise<void> {
  try {
    const prisma = room.prismaForPresence ?? createPrismaClient();
    const tenantId = authTenantId ?? (await resolveFallbackTenantId(prisma, options, room));
    if (!tenantId) return;

    const memberships = await prisma.membership.findMany({
      where: { tenantId },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const recent = await prisma.presence.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      distinct: ['userId'],
      include: { room: { select: { name: true } } },
    });

    type PresenceWithRoom = (typeof recent)[0];
    const presenceMap = new Map<string, PresenceWithRoom>();
    for (const p of recent) {
      presenceMap.set(p.userId, p);
    }

    const out = memberships.map((m) => {
      const presence = presenceMap.get(m.userId);
      return {
        userId: m.userId,
        user: { id: m.user?.id, email: m.user?.email, name: m.user?.name },
        room: presence?.room?.name || null,
        x: presence?.x ?? null,
        y: presence?.y ?? null,
        direction: presence?.direction || null,
        updatedAt: presence?.updatedAt || null,
      };
    });

    setTimeout(() => {
      try {
        client.send('presence_recent', out);
      } catch (e) {
        logger.debug('[WorldRoom] Failed to send presence_recent', e);
      }
    }, HANDLER_REGISTRATION_DELAY_MS);
  } catch (e) {
    try {
      logger.debug('[WorldRoom] presence_recent seed failed', e);
    } catch (e2) {
      logger.debug('[WorldRoom] Failed to log presence_recent error', e2);
    }
  }
}

// Check whether the joining user is an expired guest. Returns true if
// the join must be aborted (and the client has been kicked).
// Scoped by the JWT-verified auth.tenantId (see seedPresenceRecent for why the
// verified id, not the resolved slug): the expiry check only ever runs against
// the joining user's own authenticated tenant. Falls back to the slug only for
// NPC / token-less joins with no verified tenant.
async function checkGuestExpired(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
  authTenantId?: string,
): Promise<boolean> {
  try {
    const prismaCheck = room.prismaForPresence ?? createPrismaClient();
    const tenantId = authTenantId ?? (await resolveFallbackTenantId(prismaCheck, options, room));
    if (tenantId) {
      const guestMembership = await prismaCheck.membership.findFirst({
        where: {
          userId: joiningIdentity,
          tenantId,
          role: 'guest',
          expiresAt: { lt: new Date() },
        },
      });
      if (guestMembership) {
        try {
          client.error(4006, 'guest_expired');
        } catch {
          /* best-effort */
        }
        client.leave(1000);
        return true;
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to check guest expiry on join', e);
  }
  return false;
}

// Pick the initial pixel-space position for a joining player.
function pickInitialPosition(room: WorldRoom, options: RoomOptions, initialMapId: string): { x: number; y: number } {
  if (options && typeof options.x === 'number' && typeof options.y === 'number') {
    return sanitizePositionForMap(room, options.x, options.y, initialMapId);
  }
  if (room.defaultSpawn) {
    return sanitizePositionForMap(room, room.defaultSpawn.x, room.defaultSpawn.y, initialMapId);
  }
  return getMapCenter(room) ?? { x: 200, y: 200 };
}

// Send full_state + bubble_state + zone_lock_state to the joining client
// after a small delay so the client can register its handlers first. The
// player list is scoped to the client's own verified tenant (mirroring the
// StateView schema filter on WorldState.players), so this manual message cannot
// leak another tenant's players (identity/name/positions) in a shared room.
function scheduleFullStateSend(room: WorldRoom, client: Client): void {
  const viewerKey = tenantKeyForClient(client);
  setTimeout(() => {
    try {
      client.send('full_state', {
        players: Array.from(room.state.players.entries())
          .filter(([sid, p]) => isPlayerVisibleToTenant(p.isNpc, room.playerTenantKey.get(sid), viewerKey))
          .map(([id, p]) => ({
            id,
            x: p.x,
            y: p.y,
            direction: p.direction,
            identity: p.identity,
            name: p.name,
            dnd: p.dnd,
            avatarId: p.avatarId,
            isNpc: p.isNpc,
            mapId: p.mapId,
            mapName: p.mapName,
          })),
      });
      const groups = Object.entries(room.bubbleGroups)
        .map(([id, members]) => ({
          id,
          members: members.filter((m) => room.state.players.has(m)),
        }))
        .filter((g) => Array.isArray(g.members) && g.members.length >= 2);
      const members = getAllBubbleMembers(room);
      client.send('bubble_state', { groups, members });
      // Tenant-scope the zone-lock seed exactly like the change-broadcast: strip
      // pendingRequests (identity/name = PII) belonging to other tenants so a
      // shared-room foreign tenant never receives them.
      const zoneLocks = zoneLocksForClient(room, client);
      if (zoneLocks.length > 0) {
        client.send('zone_lock_state', { locks: zoneLocks });
      }
    } catch (e) {
      logger.debug('[WorldRoom] Failed to send full_state/bubble_state to client', e);
    }
  }, HANDLER_REGISTRATION_DELAY_MS);
}

// completePendingJoin: actually create the player, broadcast, and seed
// presence. The single shared join-completion path — used for a normal join
// and for the new client of a newest-wins takeover (see onJoin.ts). Behavior
// MUST remain identical to the previous private method, including the order of
// operations.
export async function completePendingJoin(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  // Authoritative tenant from the JWT that onAuth verified onto client.auth.
  // Every tenant-scoped read below is scoped by this, NEVER by the
  // client-supplied options.tenant, so a spoofed options.tenant cannot leak
  // another tenant's members/presence or pin the player onto another tenant's
  // map. Absent only for NPC / token-less legacy joins, which fall back to the
  // room/options slug (NPCs are secret-gated, legacy is a transitional state).
  const auth = isWorldAuth(client.auth) ? client.auth : undefined;
  const authTenantId = auth?.tenantId;
  const authTenantSlug = auth?.tenantSlug;
  // Verified tenant visibility key driving the per-client StateView filter on
  // WorldState.players (tenantView.ts).
  const tenantKey = tenantKeyForClient(client);

  if (await checkGuestExpired(room, client, options, joiningIdentity, authTenantId)) return;

  await ensureRoomMapMetadata(room, options, authTenantSlug);

  const { mapId: initialMapId, mapName: rawMapName } = await resolveInitialMap(room, options, authTenantId);

  // Final guard: player.mapName must NEVER be empty, otherwise the client
  // races the map filter (see playerHandlers.ts / mapFilter.ts).
  const initialMapName = rawMapName || process.env.DEFAULT_MAP_NAME || 'office';

  const player = new PlayerClass();
  player.id = client.sessionId;
  player.mapId = initialMapId;
  player.mapName = initialMapName;

  const initial = pickInitialPosition(room, options, initialMapId);
  player.x = initial.x;
  player.y = initial.y;
  player.direction = options?.direction || 'down';
  player.identity = joiningIdentity;

  const { name, avatarId } = await resolveNameAndAvatar(room, options, joiningIdentity);
  player.name = name;
  const isNpc = (joiningIdentity || '').startsWith('npc-');
  // Priority: explicit options.avatarId (active session update) > DB value (source of truth) > default
  const requestedAvatarId = options?.avatarId || avatarId || DEFAULT_AVATAR_ID;
  // An NPC never wears a custom avatar (see rooms/handlers/avatarHandler.ts and
  // api/routes/npcs.ts, which both refuse those ids). Enforced HERE as well,
  // because this is the path that actually publishes the id: NPC players bypass
  // the per-client tenant StateView (tenantView.ts `isPlayerVisibleToTenant`)
  // and reach every tenant sharing the room, so a `custom:<uuid>` on an NPC
  // would hand a foreign tenant the uuid behind the public, session-less sprite
  // URL (services/avatarComposer.ts `customSpriteUrl`). The NPC service reads
  // `Npc.avatarId` straight from the DB, so rows written before that route
  // check existed still arrive here — this guard is what neutralises them
  // without a data migration.
  player.avatarId = isNpc && isCustomAvatarId(requestedAvatarId) ? DEFAULT_AVATAR_ID : requestedAvatarId;
  player.isNpc = isNpc;
  // Re-assert the client's local DND state on (re-)join. The server only
  // holds DND in memory, so a reconnect/restart/takeover would otherwise
  // reset it to false while the client still shows DND on. `=== true` is
  // the validation: only a literal boolean true (not 'true', 1, etc.)
  // enables DND. Set before the player_joined broadcast below so peers
  // never see a stale "available" state.
  player.dnd = options?.dnd === true;

  room.state.players.set(client.sessionId, player);
  // Record the player's verified tenant and wire the per-client StateView
  // filters so this player is only ever synced to same-tenant clients (NPCs to
  // all). MUST run synchronously here — before onJoin resolves — so the initial
  // full state Colyseus sends to this client is already tenant-filtered.
  room.playerTenantKey.set(client.sessionId, tenantKey);
  syncTenantViewsOnJoin(room, client, player, tenantKey);
  // Set initial lastSeen so the ghost check only triggers after the threshold elapses
  room.lastSeen.set(client.sessionId, Date.now());

  // H4: assign the joining player's audio-zone island and push the
  // resulting allow-lists (to them and to any islandmates they just
  // joined). Zone polygons for the initial map must be loaded before
  // resolving the island, otherwise a slow DB fetch would silently
  // resolve everyone to `open` on first join.
  await warmZoneCatalog(room, player.mapId, room.prismaForPresence ?? createPrismaClient());
  trackMove(room, client.sessionId);
  try {
    colyseusPlayers.inc();
  } catch (e) {
    logger.debug('[WorldRoom] Failed to increment colyseusPlayers metric', e);
  }
  logger.info(
    '[WorldRoom] Player joined:',
    client.sessionId,
    'identity:',
    player.identity,
    'name:',
    player.name,
    'mapId:',
    player.mapId,
    'map:',
    player.mapName,
    'at',
    player.x,
    player.y,
  );
  logger.debug('[WorldRoom] Current players:', room.state.players.size);

  room.state.players.forEach((p, id) => {
    logger.debug('[WorldRoom] - Player', id, 'identity:', p.identity, 'at', p.x, p.y);
  });

  scheduleFullStateSend(room, client);

  // Broadcast new player to other clients on the same map
  broadcastToMap(
    room,
    player.mapId,
    'player_joined',
    {
      id: client.sessionId,
      x: player.x,
      y: player.y,
      direction: player.direction,
      identity: player.identity,
      name: player.name,
      dnd: player.dnd,
      avatarId: player.avatarId,
      isNpc: player.isNpc,
      mapId: player.mapId,
      mapName: player.mapName,
    },
    client,
  );

  await seedPresenceRecent(room, client, options, authTenantId);
}
