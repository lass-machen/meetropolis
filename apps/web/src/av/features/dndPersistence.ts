/**
 * Persistence for the local Do-Not-Disturb state.
 *
 * DND lives in memory on both ends: the client keeps it in a ref and the
 * server only holds `Player.dnd` for the lifetime of the room, re-asserted by
 * the client on every (re-)join (see
 * apps/server/src/rooms/lifecycle/onJoin.completion.ts). That re-assertion
 * works for a socket reconnect, where the ref survives — but not for a page
 * reload (deployment, refresh, crash recovery), which resets the ref and makes
 * the join actively assert `dnd: false`, silently marking the user available
 * again while they still believe they are in DND.
 *
 * Persisting it here closes that gap: the value is restored before the join so
 * the re-assertion carries the real state. Deliberately fails soft — a blocked
 * or full localStorage must never keep the app from starting.
 */

const STORAGE_KEY = 'meetropolis.av.dnd.v1';

export function readPersistedDnd(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function persistDnd(enabled: boolean): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* storage unavailable (private mode, quota): DND just stays session-local */
  }
}
