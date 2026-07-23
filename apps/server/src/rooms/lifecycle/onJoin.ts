import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import type { Client } from 'colyseus';
import { findExistingSession } from './ghostDetection.js';
import { enforceOssLimit, enforceTenantLimits } from './onJoin.limiter.js';
import { completePendingJoin } from './onJoin.completion.js';
import { takeOverExistingSessions } from '../handlers/sessionHandlers.js';
import { requireWorldAuth } from './onAuth.js';

// Cancel any pending Graceful-Leave timers for the joining identity
// (short disconnect + reconnect). Quietly drops the old player entries
// so completePendingJoin can build a fresh one without flicker.
function cancelPendingLeavesForIdentity(activeRooms: Set<WorldRoom>, joiningIdentity: string): void {
  try {
    for (const r of activeRooms) {
      const worldRoom = r;
      const sidsToCancel: string[] = [];
      for (const sid of worldRoom.pendingLeaves.keys()) {
        const p = worldRoom.state.players.get(sid);
        if (p && p.identity === joiningIdentity) {
          sidsToCancel.push(sid);
        }
      }
      for (const sid of sidsToCancel) {
        const timer = worldRoom.pendingLeaves.get(sid);
        if (timer) clearTimeout(timer);
        worldRoom.pendingLeaves.delete(sid);
        worldRoom.state.players.delete(sid);
        worldRoom.lastSeen.delete(sid);
        worldRoom.playerTenantKey.delete(sid);
        try {
          colyseusPlayers.dec();
        } catch {
          /* metric best-effort */
        }
        logger.info(
          '[WorldRoom] Graceful reconnect: cancelled pending leave for identity',
          joiningIdentity,
          'oldSid:',
          sid,
        );
      }
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to cancel pending leaves on reconnect', e);
  }
}

// onJoin: bind the identity, enforce limits, then complete the join —
// automatically taking over any live session for the same identity
// (newest-wins, E3.4). Returns void; the caller (WorldRoom.onJoin) awaits it.
//
// Gate order (E3.3): identity first, then OSS + billing + seat gates, then
// newest-wins. NPCs skip every limiter and the takeover path entirely.
export async function performOnJoin(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  options: RoomOptions | undefined,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  // H4 hardening: the joining identity is authoritative from onAuth()
  // (client.auth), never from client-supplied options.identity — see
  // lifecycle/onAuth.ts. By the time onJoin runs, onAuth has already
  // succeeded (Colyseus runs it first and would have rejected the join
  // otherwise), so requireWorldAuth here is a defense-in-depth guard, not
  // the primary check. Resolving it first (E3.3) also means the seat cap can
  // self-exempt the joining identity.
  const auth = requireWorldAuth(client);
  const joiningIdentity = auth.identity;

  // NPCs are server-controlled infrastructure (npc-service, see onAuth.ts):
  // excluded from every counter, so they must also skip every limiter and the
  // human newest-wins takeover path. Straight to player creation.
  if (auth.isNpc) {
    await completePendingJoin(room, client, options || {}, joiningIdentity, PlayerClass);
    return;
  }

  if (await enforceOssLimit(activeRooms, client)) return;
  if (await enforceTenantLimits(room, activeRooms, options, client, joiningIdentity)) return;

  // Heal a short disconnect+reconnect (graceful-leave pending) without a
  // takeover kick: drop the stale pending player entries so completePendingJoin
  // can rebuild flicker-free.
  cancelPendingLeavesForIdentity(activeRooms, joiningIdentity);

  // Newest-wins (E3.4): detect a still-live session for this identity. Ghost
  // sessions are cleaned up inside findExistingSession (returns null) → normal
  // join. For a live session we complete the NEW client's join FIRST (atomic
  // swap: the new player is in state before the old one is removed, so peers
  // never observe a gap), then kick the old client(s) with 4007 via
  // takeOverExistingSessions. The server no longer emits a session_conflict
  // message or waits on a 2-phase dialog.
  const existing = findExistingSession(activeRooms, room.ghostThresholdMs, joiningIdentity);
  await completePendingJoin(room, client, options || {}, joiningIdentity, PlayerClass);
  // Only take over if the new join actually materialized (completePendingJoin
  // can abort early, e.g. expired guest) — otherwise a failed join would
  // wrongly evict the still-valid existing session.
  if (existing && room.state.players.has(client.sessionId)) {
    takeOverExistingSessions(activeRooms, joiningIdentity, client.sessionId);
  }
}
