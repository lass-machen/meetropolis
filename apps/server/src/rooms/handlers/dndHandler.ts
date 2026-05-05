import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';

export function handleDndStatus(room: WorldRoom, client: Client, data: { dnd: boolean }): void {
  const player = room.state.players.get(client.sessionId);
  if (!player) {
    logger.warn('[WorldRoom] DND status from unknown player:', client.sessionId);
    return;
  }
  player.dnd = data.dnd;
  logger.info('[WorldRoom] Player', client.sessionId, 'DND status:', data.dnd);

  broadcastToMap(room, player.mapId, 'player_dnd', {
    id: client.sessionId,
    dnd: data.dnd,
  }, client);
}
