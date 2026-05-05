import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';

// Look up an existing session for the given identity across all active
// rooms. If a stale (ghost) session is found (lastSeen too old or never
// set), it is cleaned up directly and the function returns null — no
// takeover flow needed for ghosts. Otherwise returns the matching room,
// session id and client.
//
// IMPORTANT: behavior must remain identical to the previous private
// method `WorldRoom.findExistingSession`, including:
// - direct delete (no graceful timer) for ghost sessions
// - cancel pending Graceful-Leave timer if present
// - decrement `colyseusPlayers` metric
// - broadcast `player_left` on the ghost's map (or globally as fallback)
export function findExistingSession(
  activeRooms: Set<WorldRoom>,
  ghostThresholdMs: number,
  identity: string,
): { room: WorldRoom; sessionId: string; client: Client } | null {
  for (const room of activeRooms) {
    const worldRoom = room;
    let foundSessionId: string | null = null;
    worldRoom.state.players.forEach((p, sid) => {
      if (p.identity === identity) foundSessionId = sid;
    });
    if (foundSessionId !== null) {
      const sid = foundSessionId as string;
      const lastSeen = worldRoom.lastSeen.get(sid) ?? 0;
      const age = Date.now() - lastSeen;
      if (lastSeen === 0 || age > ghostThresholdMs) {
        const ghostPlayer = worldRoom.state.players.get(sid);
        const mapIdForGhost = ghostPlayer?.mapId;
        worldRoom.state.players.delete(sid);
        worldRoom.lastSeen.delete(sid);
        const pendingTimer = worldRoom.pendingLeaves.get(sid);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          worldRoom.pendingLeaves.delete(sid);
        }
        try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
        if (mapIdForGhost) {
          broadcastToMap(worldRoom, mapIdForGhost, 'player_left', { id: sid });
        } else {
          worldRoom.broadcast('player_left', { id: sid });
        }
        logger.info('[WorldRoom] Ghost session cleaned for identity:', identity, 'sid:', sid, 'age(ms):', age);
        return null;
      }
      const matchedClient = worldRoom.clients.find((c: Client) => c.sessionId === sid);
      if (matchedClient) {
        return { room: worldRoom, sessionId: sid, client: matchedClient };
      }
    }
  }
  return null;
}
