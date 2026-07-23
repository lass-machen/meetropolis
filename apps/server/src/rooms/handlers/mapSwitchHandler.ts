import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom, Player } from '../WorldRoom.js';
import { ensureMapMeta, sanitizePositionForMap, type MapCacheEntry } from '../utils/mapBoundsHelpers.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { broadcastBubbleState } from '../utils/bubbleHelpers.js';
import { warmZoneCatalog, trackMove } from '../audioZones/runtime.js';
import { isWorldAuth } from '../lifecycle/onAuth.js';

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
  return (
    mapMeta?.defaultSpawn || {
      x: ((mapMeta?.widthTiles ?? 32) * (mapMeta?.tileWidthPx ?? 16)) / 2,
      y: ((mapMeta?.heightTiles ?? 32) * (mapMeta?.tileHeightPx ?? 16)) / 2,
    }
  );
}

// Best-effort: persist the new mapName + position to the presence table, scoped
// to the verified tenant. Without the tenantId scope a user who is a member of
// several tenants would have the position/mapName written onto ALL of their
// presence rows (same cross-tenant write bug as onLeave, Finding 5). Falls back
// to the unscoped write only for NPC / token-less joins that carry no verified
// tenant. Errors are logged at debug level only.
async function persistMapChangeToPresence(
  room: WorldRoom,
  identity: string,
  mapName: string,
  x: number,
  y: number,
  tenantId?: string,
): Promise<void> {
  try {
    if (room.prismaForPresence) {
      await room.prismaForPresence.presence.updateMany({
        where: tenantId ? { userId: identity, tenantId } : { userId: identity },
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

// Notify the peers who need the rendering transition: those still on the OLD map
// (they drop the player) and those on the NEW map (they add them). Both maps
// belong to this player's tenant (mapIds are tenant-unique), so scoping to them
// via broadcastToMap — instead of a room-wide broadcast — keeps another tenant
// sharing this room from ever receiving the player's name (= email when no
// display name) + userId. Behaviour-preserving for legitimate recipients: the
// web handler acts only when it is on the old or new map; a third-map client
// ignored the message anyway (global roster stays in sync via the tenant-
// filtered schema, not this one-shot message).
function broadcastPlayerMapChanged(
  room: WorldRoom,
  client: Client,
  player: Player,
  oldMapId: string,
  oldMapName: string,
  newMap: { id: string; name: string },
): void {
  const payload = {
    id: client.sessionId,
    oldMapId,
    newMapId: newMap.id,
    oldMapName,
    newMapName: newMap.name,
    mapId: newMap.id,
    mapName: newMap.name,
    x: player.x,
    y: player.y,
    name: player.name,
    identity: player.identity,
    avatarId: player.avatarId,
    dnd: player.dnd,
    isNpc: player.isNpc,
  };
  // Set() dedupes the degenerate same-map switch so no client is notified twice.
  for (const mapId of new Set([oldMapId, newMap.id])) {
    if (mapId) broadcastToMap(room, mapId, 'player_map_changed', payload, client);
  }
}

export async function handleChangeMap(room: WorldRoom, client: Client, data: ChangeMapData): Promise<void> {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;

  const targetMapId = data?.mapId;
  if (!targetMapId || typeof targetMapId !== 'string') {
    client.send('change_map_error', { error: 'invalid_map_id' });
    return;
  }

  // Scope the target-map lookup to the JWT-verified tenant (auth.tenantId), not
  // to room.metadata.tenant. In a shared apex/'default' room the room slug is
  // 'default', so scoping by it would let a lobster-hq user only switch to
  // default-tenant maps. Falls back to the room slug for NPC / token-less joins
  // with no verified tenant. The map's own tenant slug (from the row) is then
  // used for ensureMapMeta so the metadata lookup stays consistent with the
  // resolved map even when the auth slug was not resolved.
  const auth = isWorldAuth(client.auth) ? client.auth : undefined;
  const authTenantId = auth?.tenantId;
  const roomSlug = (room.metadata as RoomMetadata)?.tenant || process.env.DEFAULT_TENANT_SLUG || 'default';
  const prisma = room.prismaForPresence ?? createPrismaClient();
  const map = await prisma.map.findFirst({
    where: authTenantId ? { id: targetMapId, tenantId: authTenantId } : { id: targetMapId, tenant: { slug: roomSlug } },
    include: { tenant: { select: { slug: true } } },
  });
  if (!map) {
    client.send('change_map_error', { error: 'map_not_found', mapId: targetMapId });
    return;
  }

  const tenantSlug = map.tenant?.slug ?? roomSlug;
  const mapMeta = await ensureMapMeta(room, map.id, tenantSlug);
  const oldMapId = player.mapId;
  const oldMapName = player.mapName;

  removeFromBubbleGroups(room, client.sessionId);

  // H4: warm the target map's zone polygons before assigning the new
  // position, so the post-move island resolution below never falls back
  // to `open` just because the fetch hadn't landed yet.
  await warmZoneCatalog(room, map.id, prisma);

  // Set new map and spawn position
  player.mapId = map.id;
  player.mapName = map.name;
  const spawn = pickSpawnForNewMap(room, data, map.id, mapMeta);
  player.x = spawn.x;
  player.y = spawn.y;

  // H4: recompute audio-zone island membership for the new map/position.
  trackMove(room, client.sessionId);

  // Notify the changing client
  client.send('map_changed', {
    mapId: map.id,
    mapName: map.name,
    x: player.x,
    y: player.y,
  });

  broadcastPlayerMapChanged(room, client, player, oldMapId, oldMapName, map);

  await persistMapChangeToPresence(room, player.identity, map.name, player.x, player.y, authTenantId);

  logger.info('[WorldRoom] Player', client.sessionId, 'changed map:', oldMapId, '->', map.id, `(${map.name})`);
}
