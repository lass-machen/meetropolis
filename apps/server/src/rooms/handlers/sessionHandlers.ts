import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom } from '../WorldRoom.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import { completePendingJoin } from '../lifecycle/onJoin.js';

export async function handleSessionTakeover(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  data: { identity?: string } | undefined,
): Promise<void> {
  const identity = data?.identity;
  if (!identity) return;

  const pending = room.pendingClients.get(identity);
  if (!pending || pending.client.sessionId !== client.sessionId) {
    logger.warn('[WorldRoom] Invalid session_takeover attempt from', client.sessionId);
    return;
  }

  // WICHTIG: pending zuerst loeschen, damit completePendingJoin den neuen Client
  // nicht selbst wieder als pending erkennt (Duplicate-Check in onJoin).
  room.pendingClients.delete(identity);

  // Race-Fix: ZUERST den neuen Player in den State setzen, DANACH den alten entfernen.
  // Effekt: Andere Clients sehen nie eine Luecke (atomarer Swap aus Client-Sicht).
  logger.info('[WorldRoom] Session takeover: completing join for identity:', identity);
  await completePendingJoin(room, pending.client, pending.options, pending.identity);

  // Jetzt alten Eintrag aus allen Rooms raeumen
  const newSid = pending.client.sessionId;
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
      try { colyseusPlayers.dec(); } catch { /* metric best-effort */ }
      if (oldMapId) {
        broadcastToMap(worldRoom, oldMapId, 'player_left', { id: oldSid });
      } else {
        worldRoom.broadcast('player_left', { id: oldSid });
      }
      const oldClient = worldRoom.clients.find((c: Client) => c.sessionId === oldSid);
      if (oldClient) {
        try { oldClient.error(4007, 'session_taken_over'); } catch { /* best-effort */ }
        try { oldClient.leave(1000); } catch { /* best-effort */ }
      }
    }
  }
  logger.info('[WorldRoom] Session takeover completed for identity:', identity);
}

export function handleSessionTakeoverCancel(room: WorldRoom, client: Client): void {
  for (const [identity, pending] of room.pendingClients.entries()) {
    if (pending.client.sessionId === client.sessionId) {
      room.pendingClients.delete(identity);
      logger.info('[WorldRoom] Session takeover cancelled for identity:', identity);
      break;
    }
  }
  try { client.leave(1000); } catch { /* best-effort */ }
}
