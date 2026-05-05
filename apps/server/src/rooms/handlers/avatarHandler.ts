import type { Client } from 'colyseus';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';

export function handleAvatarChange(room: WorldRoom, client: Client, data: { avatarId: string }): void {
  const player = room.state.players.get(client.sessionId);
  if (!player) return;
  player.avatarId = data.avatarId;
  broadcastToMap(room, player.mapId, 'player_avatar', { id: client.sessionId, avatarId: data.avatarId }, client);
}
