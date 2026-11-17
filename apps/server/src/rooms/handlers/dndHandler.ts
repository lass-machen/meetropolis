import type { Client } from '@colyseus/core';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { countRejectedPayload } from '../validation/rejectionMetrics.js';
import { dndSchema } from '../validation/worldPayloadSchemas.js';

export function handleDndStatus(room: WorldRoom, client: Client, data: unknown): void {
  const parsed = dndSchema.safeParse(data);
  if (!parsed.success) {
    countRejectedPayload('dnd_status', 'schema');
    return;
  }
  const player = room.state.players.get(client.sessionId);
  if (!player) {
    logger.warn('[WorldRoom] DND status from unknown player:', client.sessionId);
    return;
  }
  player.dnd = parsed.data.dnd;
  logger.info('[WorldRoom] Player', client.sessionId, 'DND status:', parsed.data.dnd);

  broadcastToMap(
    room,
    player.mapId,
    'player_dnd',
    {
      id: client.sessionId,
      dnd: parsed.data.dnd,
    },
    client,
  );
}
