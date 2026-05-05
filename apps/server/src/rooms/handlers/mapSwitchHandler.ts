import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { WorldRoom } from '../WorldRoom.js';
import { ensureMapMeta, sanitizePositionForMap, type MapCacheEntry } from '../utils/mapBoundsHelpers.js';
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

// Remove the changing player from any bubble groups they were part of,
// then drop groups with <2 members. Re-broadcasts bubble state if any
// change occurred.
function removeFromBubbleGroups(room: WorldRoom, sessionId: string): void {
  let bubbleChanged = false;
  for (const [gid, members] of Object.entries(room.bubbleGroups)) {
    if (members.includes(sessionId)) {
      room.bubbleGroups[gid] = members.filter((m) => m !== sessionId);
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
}

// Compute the spawn position on the new map: prefer client-supplied
// portal coordinates, fall back to the map's default spawn, then to its
// pixel center.
function pickSpawnForNewMap(
  room: WorldRoom,
  data: ChangeMapData,
  mapId: string,
  mapMeta: MapCacheEntry | null,
): { x: number; y: number } {
  if (typeof data.spawnX === 'number' && typeof data.spawnY === 'number') {
    return sanitizePositionForMap(room, data.spawnX, data.spawnY, mapId);
  }
  return mapMeta?.defaultSpawn || {
    x: ((mapMeta?.widthTiles ?? 32) * (mapMeta?.tileWidthPx ?? 16)) / 2,
    y: ((mapMeta?.heightTiles ?? 32) * (mapMeta?.tileHeightPx ?? 16)) / 2,
  };
}

// Best-effort: persist the new mapName + position to the presence
// table. Errors are logged at debug level only.
async function persistMapChangeToPresence(
  room: WorldRoom,
  identity: string,
  mapName: string,
  x: number,
  y: number,
): Promise<void> {
  try {
    if (room.prismaForPresence) {
      await room.prismaForPresence.presence.updateMany({
        where: { userId: identity },
        data: {
          mapName,
          x: Math.round(x),
          y: Math.round(y),
        },
      });
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to update presence mapName', e);
  }
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
  const prisma = room.prismaForPresence ?? new PrismaClient();
  const map = await prisma.map.findFirst({
    where: { id: targetMapId, tenant: { slug: tenantSlug } },
  });
  if (!map) {
    client.send('change_map_error', { error: 'map_not_found', mapId: targetMapId });
    return;
  }

  const mapMeta = await ensureMapMeta(room, map.id, tenantSlug);
  const oldMapId = player.mapId;
  const oldMapName = player.mapName;

  removeFromBubbleGroups(room, client.sessionId);

  // Set new map and spawn position
  player.mapId = map.id;
  player.mapName = map.name;
  const spawn = pickSpawnForNewMap(room, data, map.id, mapMeta);
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

  await persistMapChangeToPresence(room, player.identity, map.name, player.x, player.y);

  logger.info('[WorldRoom] Player', client.sessionId, 'changed map:', oldMapId, '->', map.id, `(${map.name})`);
}
