import type { Client } from '@colyseus/core';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { invalidateZoneCache } from './zoneLockHandler.js';
import { refreshZonesAndRecompute } from '../audioZones/runtime.js';
import { requireWorldAuth, type WorldAuth } from '../lifecycle/onAuth.js';
import { authorizeEditorUpdate, editorUpdateSchema } from './editorAuthorization.js';

export function handleEditorUpdate(
  room: WorldRoom,
  client: Client,
  data: { type: string; [key: string]: unknown },
): void {
  const parsed = editorUpdateSchema.safeParse(data);
  if (!parsed.success) {
    logger.debug('[WorldRoom] Dropped editor_update with an unknown type');
    return;
  }
  const player = room.state.players.get(client.sessionId);
  if (!player || player.isNpc) {
    logger.debug('[WorldRoom] Dropped editor_update without a human player seat');
    return;
  }
  let auth: WorldAuth;
  try {
    auth = requireWorldAuth(client);
  } catch {
    logger.debug('[WorldRoom] Dropped editor_update without proven world auth');
    return;
  }
  if (auth.isNpc) {
    logger.debug('[WorldRoom] Dropped editor_update from a service seat');
    return;
  }
  const tenantId = auth.tenantId;
  if (!tenantId) {
    logger.debug('[WorldRoom] Dropped editor_update without a proven tenant');
    return;
  }
  // The server-side player map is authoritative. A sender-declared mapId that
  // names a different map is dropped; it is never forwarded (see below).
  const mapId = player.mapId;
  if (!mapId) {
    logger.debug('[WorldRoom] Dropped editor_update without a server-side map');
    return;
  }
  if (parsed.data.mapId !== undefined && parsed.data.mapId !== mapId) {
    logger.debug('[WorldRoom] Dropped editor_update for a foreign map');
    return;
  }
  // The room's own database handle proves the role below. Without it there is
  // no fresh proof, so the update is dropped instead of opening a new handle.
  const prisma = room.prismaForPresence;
  if (!prisma) {
    logger.debug('[WorldRoom] Dropped editor_update without room database state');
    return;
  }
  const userId = auth.identity;
  void authorizeEditorUpdate(prisma, userId, tenantId, mapId)
    .then((allowed) => {
      if (!allowed) {
        logger.debug('[WorldRoom] Dropped editor_update without owner/admin proof');
        return;
      }
      // Re-check the seat after the database round trip: the sender may have
      // left or switched maps while the proof was loading. Only the same
      // player on the same map receives the broadcast below.
      const current = room.state.players.get(client.sessionId);
      if (current !== player || current.mapId !== mapId || current.isNpc) {
        logger.debug('[WorldRoom] Dropped editor_update after the sender seat changed');
        return;
      }
      // The canonical map always wins: a sender-declared mapId is never
      // forwarded, so geometry cannot leak onto another map. Only parsed
      // data is broadcast, never the raw sender payload.
      broadcastToMap(room, mapId, 'editor_update', { ...parsed.data, mapId }, client);
      // Zone locks cache per map, so only this map is invalidated; the
      // recompute below then refreshes exactly the islands on this map.
      invalidateZoneCache(room.zoneLockState, mapId);
      void refreshZonesAndRecompute(room, mapId, prisma).catch((e) =>
        logger.debug('[WorldRoom] Failed to recompute audio zones after editor_update', e),
      );
    })
    .catch((e: unknown) => {
      logger.debug('[WorldRoom] Failed to authorize editor_update', e);
    });
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
