import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { createPrismaClient } from '../../db.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { invalidateZoneCache } from './zoneLockHandler.js';
import { refreshZonesAndRecompute } from '../audioZones/runtime.js';

export function handleEditorUpdate(
  room: WorldRoom,
  client: Client,
  data: { type: string; [key: string]: unknown },
): void {
  logger.debug('[WorldRoom] Editor update from:', client.sessionId, 'type:', data.type);
  const player = room.state.players.get(client.sessionId);
  const mapId = typeof data.mapId === 'string' ? data.mapId : player?.mapId;
  if (mapId) {
    broadcastToMap(room, mapId, 'editor_update', data, client);
  } else {
    // No resolvable mapId: cannot tenant-scope (broadcastToMap filters
    // recipients by their player.mapId). Drop rather than room-broadcast so one
    // tenant's editor geometry never bleeds to another in a shared room. Every
    // real edit carries the editor's map (data.mapId or the player's current
    // mapId), so this only drops anomalous player-less/mapless events.
    logger.debug('[WorldRoom] Dropped editor_update without a resolvable mapId (cannot tenant-scope)');
  }
  // Invalidate zone cache on editor updates so locks use fresh zone data
  invalidateZoneCache(room.zoneLockState);
  // H4: zone polygons may have moved -- recompute audio-zone islands for
  // everyone on this map against the fresh geometry. Fire-and-forget: this
  // handler is synchronous (Colyseus onMessage), and a brief delay before
  // recomputation is acceptable (the reconciler heals any window).
  if (mapId) {
    const prisma = room.prismaForPresence ?? createPrismaClient();
    void refreshZonesAndRecompute(room, mapId, prisma).catch((e) =>
      logger.debug('[WorldRoom] Failed to recompute audio zones after editor_update', e),
    );
  }
}

// Subscribe to map updates via Presence (works across processes if Redis
// is used, or locally). Forwards chunks/tileset/objects/editor updates
// to the relevant map (or globally as fallback).
export function subscribeMapUpdates(room: WorldRoom, tenantSlug: string): void {
  try {
    void room.presence.subscribe(`map_update:${tenantSlug}`, (message: { type: string; payload: unknown }) => {
      try {
        const payload = message.payload as Record<string, unknown> | undefined;
        const mapId = typeof payload?.mapId === 'string' ? payload.mapId : null;
        if (!mapId) {
          // No mapId: cannot tenant-scope (broadcastToMap filters recipients by
          // their player.mapId). Drop rather than room-broadcast so one tenant's
          // map geometry never bleeds to another in a shared room. Publishers
          // always include mapId, so this is a defensive guard, not a normal path.
          logger.debug('[WorldRoom] Dropped map_update without mapId (cannot tenant-scope)', message.type);
          return;
        }

        if (message.type === 'chunks_updated') {
          broadcastToMap(room, mapId, 'chunks_updated', payload);
        } else if (message.type === 'tileset_registry_updated') {
          broadcastToMap(room, mapId, 'tileset_registry_updated', payload);
        } else if (message.type === 'objects_updated') {
          broadcastToMap(room, mapId, 'objects_updated', payload);
        } else if (message.type === 'editor_update') {
          broadcastToMap(room, mapId, 'editor_update', payload);
        }
      } catch (e) {
        logger.error('[WorldRoom] Failed to handle presence map_update', e);
      }
    });
  } catch (e) {
    logger.error('[WorldRoom] Failed to subscribe to presence', e);
  }
}
