/**
 * An expired lease entry must be forgotten when it is
 * disconnected. Otherwise the entry stays joined until `onLeave`, the timer
 * re-plans with a 0 ms delay and the disconnect (plus the AV cleanup) repeats
 * in a loop for a client that never answers the close.
 *
 * Unit test, no database: a real `WorldAccessRegistry` over a room double
 * (as in worldAccess.integration.test.ts), whose client only counts `error`
 * and `leave` and never triggers `onLeave`. The entry is joined with a
 * `leaseUntil` in the past; after rescheduling and 100 ms of virtual time
 * the client must have errored exactly once. Before the fix it errors
 * repeatedly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldRoom } from '../WorldRoom.js';
import { createWorldAccess } from './worldAccess.js';
import { clearWorldAccessLeaseTimer, rescheduleWorldAccessLeaseTimer } from './worldAccessLease.js';

function expiredLeaseRoom(): {
  room: WorldRoom;
  error: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
} {
  const error = vi.fn();
  const leave = vi.fn();
  const room = {
    state: { players: new Map([['sess-1', { identity: 'user-1' }]]) },
    clients: [{ sessionId: 'sess-1', error, leave }],
  } as unknown as WorldRoom;
  room.worldAccess = createWorldAccess(room);
  room.worldAccess.register('sess-1', {
    identity: 'user-1',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    sessionId: 'db-sess-1',
    isNpc: false,
    zonePrivacyVersion: 1,
  });
  const entry = room.worldAccess.entryFor('sess-1');
  if (!entry) throw new Error('test setup: registry entry missing');
  entry.leaseUntil = Date.now() - 1_000;
  entry.accessExpiresAt = null;
  return { room, error, leave };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('expired world access leases are forgotten once disconnected', () => {
  it('errors the client exactly once for an expired lease', async () => {
    const { room, error } = expiredLeaseRoom();
    try {
      vi.useFakeTimers();
      rescheduleWorldAccessLeaseTimer(room);
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      clearWorldAccessLeaseTimer(room);
      vi.useRealTimers();
    }
    expect(error).toHaveBeenCalledTimes(1);
  });
});
