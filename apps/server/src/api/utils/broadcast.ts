import { logger } from '../../logger.js';

interface WorldRoom {
  broadcast?: (event: string, data: unknown) => void;
  setDefaultSpawn?: (mapId: string, pos: { x: number; y: number }) => void;
}

interface GameServer {
  presence?: {
    publish: (channel: string, data: unknown) => Promise<void>;
  };
  matchMaker?: {
    query: (filter: Record<string, unknown>) => Promise<WorldRoom[]>;
  };
  rooms?: WorldRoom[] | Map<string, WorldRoom>;
}

declare global {
  var gameServer: GameServer | undefined;
  var activeWorldRooms: Set<WorldRoom> | undefined;
}

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
