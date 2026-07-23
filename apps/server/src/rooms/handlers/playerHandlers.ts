import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { isMovementBlocked } from './zoneLockHandler.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { trackMove } from '../audioZones/runtime.js';

export interface MoveData {
  x: number;
  y: number;
  direction: string;
}

// Move handler with throttling (~12.5 Hz). Updates `lastSeen` on every
// invocation, so moves act as implicit heartbeats.
export function createMoveHandler(room: WorldRoom) {
  const lastMove: Map<string, number> = new Map();
  return (client: Client, data: MoveData): void => {
    const now = Date.now();
    room.lastSeen.set(client.sessionId, now);
    const prev = lastMove.get(client.sessionId) || 0;
    if (now - prev < 80) {
      return;
    }
    lastMove.set(client.sessionId, now);
    const player = room.state.players.get(client.sessionId);
    if (!player) {
      logger.warn('[WorldRoom] Move from unknown player:', client.sessionId);
      return;
    }
    const moveCheck = isMovementBlocked(room.zoneLockState, client.sessionId, player.mapId, { x: data.x, y: data.y });
    if (moveCheck.blocked) {
      client.send('zone_move_blocked', { zoneName: moveCheck.zoneName });
      return;
    }

    player.x = data.x;
    player.y = data.y;
    player.direction = data.direction;

    // H4: recompute audio-zone island membership on every accepted move.
    trackMove(room, client.sessionId);

    broadcastToMap(
      room,
      player.mapId,
      'player_moved',
      {
        id: client.sessionId,
        x: data.x,
        y: data.y,
        direction: data.direction,
        mapId: player.mapId,
        mapName: player.mapName,
      },
      client,
    );
  };
}

// Heartbeat handler: client pings periodically, server updates lastSeen
// for ghost detection. No broadcast.
export function handleHeartbeat(room: WorldRoom, client: Client): void {
  room.lastSeen.set(client.sessionId, Date.now());
}
