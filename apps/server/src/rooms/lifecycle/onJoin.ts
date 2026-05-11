import type { Client } from 'colyseus';
import { logger } from '../../logger.js';
import { colyseusPlayers } from '../../metrics.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import { findExistingSession } from './ghostDetection.js';
import { enforceOssLimit, enforceTenantLimits } from './onJoin.limiter.js';
import { completePendingJoin } from './onJoin.completion.js';

// Re-export completePendingJoin so existing callers (WorldRoom.ts) keep
// their import surface stable.
export { completePendingJoin } from './onJoin.completion.js';

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

// If a duplicate session exists (and is not a ghost), enqueue this client
// as pending and notify it. Returns true if pending: the caller must skip
// player creation. Returns false if no conflict (caller proceeds).
function tryRegisterAsPending(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  options: RoomOptions | undefined,
  joiningIdentity: string,
): boolean {
  try {
    const existing = findExistingSession(activeRooms, room.ghostThresholdMs, joiningIdentity);
    if (existing) {
      // If there's already a pending client for this identity (3rd tab case), kick it
      const prevPending = room.pendingClients.get(joiningIdentity);
      if (prevPending) {
        try {
          prevPending.client.leave(1000);
        } catch {
          /* best-effort */
        }
        room.pendingClients.delete(joiningIdentity);
      }

      // Store the new client as pending: no player creation yet.
      room.pendingClients.set(joiningIdentity, {
        client,
        options: options || {},
        identity: joiningIdentity,
        timestamp: Date.now(),
      });

      client.send('session_conflict', { code: 4007, message: 'session_conflict' });
      logger.info('[WorldRoom] Session conflict detected for identity:', joiningIdentity, '- client pending');
      return true;
    }
  } catch (e) {
    logger.debug('[WorldRoom] Failed to check duplicate session', e);
  }
  return false;
}

// onJoin: enforce OSS/tenant limits, then either pend or complete the
// join. Returns void; the caller (WorldRoom.onJoin) just awaits this.
//
// IMPORTANT: behavior must match the original implementation exactly,
// including ordering: OSS check -> tenant/billing check -> graceful
// reconnect cancel -> duplicate detection -> completePendingJoin.
export async function performOnJoin(
  room: WorldRoom,
  activeRooms: Set<WorldRoom>,
  client: Client,
  options: RoomOptions | undefined,
  PlayerClass: typeof PlayerCtor,
): Promise<void> {
  if (await enforceOssLimit(activeRooms, client)) return;
  if (await enforceTenantLimits(room, activeRooms, options, client)) return;

  const joiningIdentity = options?.identity || client.sessionId;
  if (!joiningIdentity.startsWith('npc-')) {
    cancelPendingLeavesForIdentity(activeRooms, joiningIdentity);
    if (tryRegisterAsPending(room, activeRooms, client, options, joiningIdentity)) {
      return; // No player creation, no full_state, no broadcasts
    }
  }

  await completePendingJoin(room, client, options || {}, joiningIdentity, PlayerClass);
}
