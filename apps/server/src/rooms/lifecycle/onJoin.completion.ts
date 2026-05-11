import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { sanitizePosition, sanitizePositionForMap, getMapCenter, type MapMeta } from '../utils/mapBoundsHelpers.js';
import { getAllBubbleMembers } from '../utils/bubbleHelpers.js';
import type { RoomMetadata } from './onJoin.limiter.js';

// Wait until the client's onMessage handlers are likely registered before
// sending one-shot messages. Colyseus 0.17 resolves joinOrCreate faster than
// 0.15, which exposed a pre-existing race: the server raced the client's
// setupPlayerHandlers() and triggered "@colyseus/sdk: onMessage() not
// registered for type 'full_state'/'bubble_state'/'presence_recent'" warnings,
// so the client never received the initial state and the roster stayed empty.
const HANDLER_REGISTRATION_DELAY_MS = 200;

// Resolve the initial map (mapId + mapName) for a joining player.
// Looks up by name first, then falls back to tenant default, then to
// the first available map for this tenant. Final guard for empty
// mapName lives in the caller.
async function resolveInitialMap(room: WorldRoom, options: RoomOptions): Promise<{ mapId: string; mapName: string }> {
  let initialMapId = options?.mapId || '';
  let initialMapName = options?.mapName || '';
  if (initialMapId) return { mapId: initialMapId, mapName: initialMapName };

  try {
    const tenantSlug =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prismaForMap = room.prismaForPresence ?? createPrismaClient();
    if (initialMapName) {
      const mapByName = await prismaForMap.map.findFirst({
        where: { name: initialMapName, tenant: { slug: tenantSlug } },
        select: { id: true, name: true },
      });
      if (mapByName) {
        initialMapId = mapByName.id;
        initialMapName = mapByName.name;
      }
    }
    if (!initialMapId) {
      const tenantForMap = await prismaForMap.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { defaultMapName: true },
      });
      const defaultMapName = tenantForMap?.defaultMapName || 'office';
      const defaultMap = await prismaForMap.map.findFirst({
        where: { name: defaultMapName, tenant: { slug: tenantSlug } },
        select: { id: true, name: true },
      });
      if (defaultMap) {
        initialMapId = defaultMap.id;
        initialMapName = defaultMap.name;
      } else {
        const firstMap = await prismaForMap.map.findFirst({
          where: { tenant: { slug: tenantSlug } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        });
        if (firstMap) {
          initialMapId = firstMap.id;
          initialMapName = firstMap.name;
        } else {
          initialMapName = defaultMapName;
        }
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to determine initial map', e);
    if (!initialMapName) initialMapName = 'office';
  }
  return { mapId: initialMapId, mapName: initialMapName };
}

// Ensure room map metadata is loaded (race against onCreate-loader).
async function ensureRoomMapMetadata(room: WorldRoom, options: RoomOptions): Promise<void> {
  try {
    if (!room.mapWidthTiles || !room.mapHeightTiles || !room.tileWidthPx || !room.tileHeightPx || !room.defaultSpawn) {
      const prisma = createPrismaClient();
      const tenantSlug =
        options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
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

// Send seed presence_recent to the new client. Best-effort, tenant-scoped.
async function seedPresenceRecent(room: WorldRoom, client: Client, options: RoomOptions): Promise<void> {
  try {
    const prisma = room.prismaForPresence ?? createPrismaClient();
    const tenantSlug: string =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return;

    const memberships = await prisma.membership.findMany({
      where: { tenantId: tenant.id },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    const recent = await prisma.presence.findMany({
      where: { tenantId: tenant.id },
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
async function checkGuestExpired(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
): Promise<boolean> {
  try {
    const tenantSlug =
      options?.tenant || (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
    const prismaCheck = room.prismaForPresence ?? createPrismaClient();
    const tenantForGuest = await prismaCheck.tenant.findUnique({ where: { slug: tenantSlug } });
    if (tenantForGuest) {
      const guestMembership = await prismaCheck.membership.findFirst({
        where: {
          userId: joiningIdentity,
          tenantId: tenantForGuest.id,
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
// after a small delay so the client can register its handlers first.
function scheduleFullStateSend(room: WorldRoom, client: Client): void {
  setTimeout(() => {
    try {
      client.send('full_state', {
        players: Array.from(room.state.players.entries()).map(([id, p]) => ({
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
      const zoneLocks = Array.from(room.zoneLockState.locks.values());
      if (zoneLocks.length > 0) {
        client.send('zone_lock_state', { locks: zoneLocks });
      }
    } catch (e) {
      logger.debug('[WorldRoom] Failed to send full_state/bubble_state to client', e);
    }
  }, HANDLER_REGISTRATION_DELAY_MS);
}

// completePendingJoin: actually create the player, broadcast, and seed
// presence. Called both from the normal onJoin flow and from the
// session_takeover handler. Behavior MUST remain identical to the
// previous private method, including the order of operations.
export async function completePendingJoin(
  room: WorldRoom,
  client: Client,
  options: RoomOptions,
  joiningIdentity: string,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  if (await checkGuestExpired(room, client, options, joiningIdentity)) return;

  await ensureRoomMapMetadata(room, options);

  const { mapId: initialMapId, mapName: rawMapName } = await resolveInitialMap(room, options);

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
  // Priority: explicit options.avatarId (active session update) > DB value (source of truth) > default
  player.avatarId = options?.avatarId || avatarId || 'default-characters:businessman1';
  player.isNpc = (joiningIdentity || '').startsWith('npc-');

  room.state.players.set(client.sessionId, player);
  // Set initial lastSeen so the ghost check only triggers after the threshold elapses
  room.lastSeen.set(client.sessionId, Date.now());
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

  await seedPresenceRecent(room, client, options);
}
