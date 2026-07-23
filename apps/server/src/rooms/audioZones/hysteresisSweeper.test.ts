import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createMembershipTracker, onMove } from './membershipTracker.js';
import { createPermissionOrchestrator } from './permissionOrchestrator.js';
import { sweepOnce } from './hysteresisSweeper.js';

// Minimal fake shaped like the slice of WorldRoom that sweepOnce touches:
// audioZones.{tracker,orchestrator}, state.players, clients. See
// reconciler.test.ts's fakeRoom for the same pattern.
function fakeRoom() {
  return {
    state: { players: new Map() },
    clients: [],
    audioZones: {
      tracker: createMembershipTracker(),
      orchestrator: createPermissionOrchestrator(),
    },
  };
}

describe('sweepOnce', () => {
  it('commits a stalled exit and schedules an allow-list push for the mover', () => {
    const room = fakeRoom();
    onMove(room.audioZones.tracker, 'alice', 'map-1:zone:kitchen', 0);
    // Isolate alice via a real onMove exit sample well in the past so the
    // hysteresis window (default 350ms) has already elapsed by "now".
    onMove(room.audioZones.tracker, 'alice', 'map-1:open', Date.now() - 10_000);

    sweepOnce(room as never);

    expect(room.audioZones.orchestrator.pending.has('alice')).toBe(true);
  });

  it('does nothing when no member is stalled mid-exit', () => {
    const room = fakeRoom();
    onMove(room.audioZones.tracker, 'alice', 'map-1:open', 0);

    expect(() => sweepOnce(room as never)).not.toThrow();
    expect(room.audioZones.orchestrator.pending.size).toBe(0);
  });

  it('is a no-op on an empty tracker', () => {
    const room = fakeRoom();
    expect(() => sweepOnce(room as never)).not.toThrow();
  });
});
