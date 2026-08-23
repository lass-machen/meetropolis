import { logger } from '../../logger.js';

// `gameServer` and `activeWorldRooms` are declared once, in types/global.d.ts.
// This file used to re-declare both with shapes of its own; the duplicate is a
// TS2403 that `skipLibCheck` swallows, and the two descriptions had already
// drifted apart (see the note there).

export function broadcastMapUpdate(tenantSlug: string, type: string, payload: unknown): void {
  const gameServer = global.gameServer;
  if (gameServer?.presence) {
    try {
      void gameServer.presence.publish(`map_update:${tenantSlug}`, { type, payload });
    } catch (e: unknown) {
      logger.error('[Broadcast] presence publish failed', { error: e instanceof Error ? e.message : String(e) });
    }
  } else {
    const rooms = Array.from((global.activeWorldRooms || new Set()).values());
    for (const room of rooms) {
      try {
        room.broadcast?.(type, payload);
      } catch (e: unknown) {
        logger.debug?.('[Broadcast] room broadcast failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
}

export function broadcastSpawnUpdate(mapId: string, spawn: { x: number; y: number }): void {
  const rooms = Array.from((global.activeWorldRooms || new Set()).values());
  for (const room of rooms) {
    try {
      room.setDefaultSpawn?.(mapId, spawn);
    } catch {}
  }
}
