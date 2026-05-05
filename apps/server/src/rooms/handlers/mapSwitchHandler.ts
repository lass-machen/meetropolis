import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';
import { ensureMapMeta, sanitizePositionForMap } from '../utils/mapBoundsHelpers.js';
import { broadcastBubbleState } from '../utils/bubbleHelpers.js';

interface RoomMetadata {
  tenant?: string;
  [key: string]: unknown;
}

export interface ChangeMapData {
  mapId: string;
  spawnX?: number;
  spawnY?: number;
}

export async function handleChangeMap(
  room: WorldRoom,
  client: Client,
  data: ChangeMapData,
): Promise<void> {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  const targetMapId = data?.mapId;
  if (!targetMapId || typeof targetMapId !== 'string') {
    client.send('change_map_error', { error: 'invalid_map_id' });
    return;
  }

  const tenantSlug = (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';

  // Look up map by ID from DB
  const prisma = room.prismaForPresence ?? new PrismaClient();
  const map = await prisma.map.findFirst({
    where: { id: targetMapId, tenant: { slug: tenantSlug } },
  });
  if (!map) {
    client.send('change_map_error', { error: 'map_not_found', mapId: targetMapId });
    return;
  }

  // Ensure map meta is cached (keyed by mapId)
  const mapMeta = await ensureMapMeta(room, map.id, tenantSlug);

  const oldMapId = player.mapId;
  const oldMapName = player.mapName;

  // Remove from bubble groups
  let bubbleChanged = false;
  for (const [gid, members] of Object.entries(room.bubbleGroups)) {
    if (members.includes(client.sessionId)) {
      room.bubbleGroups[gid] = members.filter((m) => m !== client.sessionId);
      bubbleChanged = true;
    }
  }
  for (const [gid, members] of Object.entries(room.bubbleGroups)) {
    if (!Array.isArray(members) || members.length < 2) {
      delete room.bubbleGroups[gid];
      bubbleChanged = true;
    }
  }
  if (bubbleChanged) broadcastBubbleState(room);

  // Set new map and spawn position
  player.mapId = map.id;
  player.mapName = map.name;
  let spawn: { x: number; y: number };
  if (typeof data.spawnX === 'number' && typeof data.spawnY === 'number') {
    spawn = sanitizePositionForMap(room, data.spawnX, data.spawnY, map.id);
  } else {
    spawn = mapMeta?.defaultSpawn || {
      x: ((mapMeta?.widthTiles ?? 32) * (mapMeta?.tileWidthPx ?? 16)) / 2,
      y: ((mapMeta?.heightTiles ?? 32) * (mapMeta?.tileHeightPx ?? 16)) / 2,
    };
  }
  player.x = spawn.x;
  player.y = spawn.y;

  // Notify the changing client
  client.send('map_changed', {
    mapId: map.id,
    mapName: map.name,
    x: player.x,
    y: player.y,
  });

  // Notify all other clients
  room.broadcast('player_map_changed', {
    id: client.sessionId,
    oldMapId,
    newMapId: map.id,
    oldMapName,
    newMapName: map.name,
    mapId: map.id,
    mapName: map.name,
    x: player.x,
    y: player.y,
    name: player.name,
    identity: player.identity,
    avatarId: player.avatarId,
    dnd: player.dnd,
    isNpc: player.isNpc,
  }, { except: client });

  // Update presence in DB (best-effort)
  try {
    if (room.prismaForPresence) {
      await room.prismaForPresence.presence.updateMany({
        where: { userId: player.identity },
        data: {
          mapName: map.name,
          x: Math.round(player.x),
          y: Math.round(player.y),
        },
      });
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to update presence mapName', e);
  }

  logger.info('[WorldRoom] Player', client.sessionId, 'changed map:', oldMapId, '->', map.id, `(${map.name})`);
}
