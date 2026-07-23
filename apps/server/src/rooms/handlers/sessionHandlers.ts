import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';

/**
 * Newest-wins takeover (E3.4). Remove every OTHER live session for `identity`
 * across all rooms and terminate the old client(s).
 *
 * N4 (verbindlich): the old client MUST be kicked with
 * `client.error(4007, 'session_taken_over')`. That code is terminal on the
 * client — it shows the "taken over" overlay and does NOT auto-reconnect (see
 * useColyseusConnection.ts). Dropping the 4007 kick would leave the old client
 * reconnecting in a loop and racing the new session back.
 *
 * Extracted from the former dialog-driven `handleSessionTakeover` so onJoin can
 * call it directly, right after completing the NEW client's join. Because the
 * new player is already in room state when this runs, the swap is atomic from
 * every other client's point of view (add-then-remove, never a visible gap).
 */
export function takeOverExistingSessions(activeRooms: Set<WorldRoom>, identity: string, newSid: string): void {
  for (const r of activeRooms) {
    const worldRoom = r;
    const toRemove: string[] = [];
    worldRoom.state.players.forEach((p, sid) => {
      if (p.identity === identity && sid !== newSid) toRemove.push(sid);
    });
    for (const oldSid of toRemove) {
      const oldPlayer = worldRoom.state.players.get(oldSid);
      const oldMapId = oldPlayer?.mapId;
      const pendingTimer = worldRoom.pendingLeaves.get(oldSid);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        worldRoom.pendingLeaves.delete(oldSid);
      }
      worldRoom.state.players.delete(oldSid);
      worldRoom.lastSeen.delete(oldSid);
      worldRoom.playerTenantKey.delete(oldSid);
      try {
        colyseusPlayers.dec();
      } catch {
        /* metric best-effort */
      }
      if (oldMapId) {
        broadcastToMap(worldRoom, oldMapId, 'player_left', { id: oldSid });
      } else {
        worldRoom.broadcast('player_left', { id: oldSid });
      }
      const oldClient = worldRoom.clients.find((c: Client) => c.sessionId === oldSid);
      if (oldClient) {
        try {
          oldClient.error(4007, 'session_taken_over');
        } catch {
          /* best-effort */
        }
        try {
          oldClient.leave(1000);
        } catch {
          /* best-effort */
        }
      }
      logger.info('[WorldRoom] Session taken over for identity:', identity, 'oldSid:', oldSid, 'newSid:', newSid);
    }
  }
}
