import type { Client } from '@colyseus/core';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { isMovementBlocked } from './zoneLockHandler.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { trackMove } from '../audioZones/runtime.js';
import { getBoundsPxForMap } from '../utils/mapBoundsHelpers.js';
import { countRejectedPayload } from '../validation/rejectionMetrics.js';
import { moveSchema } from '../validation/worldPayloadSchemas.js';

export interface MoveData {
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

const MOVE_INTERVAL_MS = 80;

// Full pixel size of the cached map. getBoundsPxForMap insets by half a tile,
// so the closed window is [0, width] x [0, height], not that inset rectangle.
// A map missing from mapCache is rejected here; the room-level fallback is not used.
function isMoveInsideMap(room: WorldRoom, mapId: string, x: number, y: number): boolean {
  if (!room.mapCache.has(mapId)) return false;
  const bounds = getBoundsPxForMap(room, mapId);
  const entry = room.mapCache.get(mapId);
  if (!bounds || !entry) return false;
  const width = entry.widthTiles * entry.tileWidthPx;
  const height = entry.heightTiles * entry.tileHeightPx;
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function publishMove(
  room: WorldRoom,
  client: Client,
  player: {
    x: number;
    y: number;
    direction: string;
    mapId: string;
    mapName: string;
  },
  move: MoveData,
): void {
  player.x = move.x;
  player.y = move.y;
  player.direction = move.direction;

  // H4: recompute audio-zone island membership on every accepted move.
  trackMove(room, client.sessionId);

  broadcastToMap(
    room,
    player.mapId,
    'player_moved',
    {
      id: client.sessionId,
      x: move.x,
      y: move.y,
      direction: move.direction,
      mapId: player.mapId,
      mapName: player.mapName,
    },
    client,
  );
}

// Move handler with throttling (~12.5 Hz). Schema and map bounds run before
// any timestamp, throttle, or player-state write. An accepted move still
// updates `lastSeen` before the throttle, so it acts as an implicit heartbeat.
export function createMoveHandler(room: WorldRoom) {
  const lastMove: Map<string, number> = new Map();
  return (client: Client, data: unknown): void => {
    const parsed = moveSchema.safeParse(data);
    if (!parsed.success) {
      countRejectedPayload('move', 'schema');
      return;
    }
    const player = room.state.players.get(client.sessionId);
    if (!player) {
      logger.warn('[WorldRoom] Move from unknown player:', client.sessionId);
      return;
    }
    const { x, y } = parsed.data;
    if (!isMoveInsideMap(room, player.mapId, x, y)) {
      countRejectedPayload('move', 'bounds');
      return;
    }
    const now = Date.now();
    room.lastSeen.set(client.sessionId, now);
    const prev = lastMove.get(client.sessionId) || 0;
    if (now - prev < MOVE_INTERVAL_MS) return;
    lastMove.set(client.sessionId, now);
    const moveCheck = isMovementBlocked(room.zoneLockState, client.sessionId, player.mapId, { x, y });
    if (moveCheck.blocked) {
      client.send('zone_move_blocked', { zoneName: moveCheck.zoneName });
      return;
    }
    publishMove(room, client, player, parsed.data);
  };
}

// Heartbeat handler: client pings periodically, server updates lastSeen
// for ghost detection. No broadcast.
export function handleHeartbeat(room: WorldRoom, client: Client): void {
  room.lastSeen.set(client.sessionId, Date.now());
}
