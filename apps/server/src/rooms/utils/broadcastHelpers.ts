import type { Client } from 'colyseus';
import type { WorldRoom } from '../WorldRoom.js';

// Broadcast helper: send `event` only to clients whose player is on the
// given mapId. Used as a building block for map-scoped broadcasts.
//
// Behavior must remain identical to the previous private method
// `WorldRoom.broadcastToMap`: same iteration order over `room.clients`,
// same `except`-handling, same predicate.
export function broadcastToMap(room: WorldRoom, mapId: string, event: string, data: unknown, except?: Client): void {
  for (const client of room.clients) {
    if (except && client === except) continue;
    const player = room.state.players.get(client.sessionId);
    if (player && player.mapId === mapId) {
      client.send(event, data);
    }
  }
}
