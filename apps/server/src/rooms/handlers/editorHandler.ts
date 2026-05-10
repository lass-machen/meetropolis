import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { invalidateZoneCache } from './zoneLockHandler.js';

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
    room.broadcast('editor_update', data, { except: client });
  }
  // Invalidate zone cache on editor updates so locks use fresh zone data
  invalidateZoneCache(room.zoneLockState);
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

        if (message.type === 'chunks_updated') {
          if (mapId) broadcastToMap(room, mapId, 'chunks_updated', payload);
          else room.broadcast('chunks_updated', payload);
        } else if (message.type === 'tileset_registry_updated') {
          if (mapId) broadcastToMap(room, mapId, 'tileset_registry_updated', payload);
          else room.broadcast('tileset_registry_updated', payload);
        } else if (message.type === 'objects_updated') {
          if (mapId) broadcastToMap(room, mapId, 'objects_updated', payload);
          else room.broadcast('objects_updated', payload);
        } else if (message.type === 'editor_update') {
          if (mapId) broadcastToMap(room, mapId, 'editor_update', payload);
          else room.broadcast('editor_update', payload);
        }
      } catch (e) {
        logger.error('[WorldRoom] Failed to handle presence map_update', e);
      }
    });
  } catch (e) {
    logger.error('[WorldRoom] Failed to subscribe to presence', e);
  }
}
