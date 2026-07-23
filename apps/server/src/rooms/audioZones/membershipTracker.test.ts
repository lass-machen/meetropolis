import { describe, it, expect } from 'vitest';
import {
  createMembershipTracker,
  onMove,
  getIsland,
  removeMember,
  snapshot,
  sweepStalledExits,
} from './membershipTracker.js';
import { isolatedIslandFor } from './islandModel.js';

const CFG = { minSamples: 3, minMs: 300 };

describe('onMove: first join', () => {
  it('commits the initial island immediately', () => {
    const tracker = createMembershipTracker();
    const result = onMove(tracker, 'alice', 'map-1:open', 0, CFG);
    expect(result).toEqual({ changed: true, oldIsland: null, newIsland: 'map-1:open' });
    expect(getIsland(tracker, 'alice')).toBe('map-1:open');
  });
});

describe('onMove: staying put', () => {
  it('reports no change when the raw island matches the committed one', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:open', 0, CFG);
    const result = onMove(tracker, 'alice', 'map-1:open', 10, CFG);
    expect(result.changed).toBe(false);
  });
});

describe('onMove: entry (open -> zone) applies immediately', () => {
  it('commits the zone on the very first sample, no hysteresis', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:open', 0, CFG);
    const result = onMove(tracker, 'alice', 'map-1:zone:kitchen', 1, CFG);
    expect(result).toEqual({ changed: true, oldIsland: 'map-1:open', newIsland: 'map-1:zone:kitchen' });
    expect(getIsland(tracker, 'alice')).toBe('map-1:zone:kitchen');
  });
});

describe('onMove: exit (zone -> open) requires hysteresis', () => {
  it('isolates immediately, then confirms after minSamples consecutive readings', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);

    const isolated = isolatedIslandFor('alice');
    const first = onMove(tracker, 'alice', 'map-1:open', 10, CFG);
    expect(first).toEqual({ changed: true, oldIsland: 'map-1:zone:kitchen', newIsland: isolated });
    expect(getIsland(tracker, 'alice')).toBe(isolated);

    const second = onMove(tracker, 'alice', 'map-1:open', 20, CFG);
    expect(second.changed).toBe(false);
    expect(getIsland(tracker, 'alice')).toBe(isolated);

    const third = onMove(tracker, 'alice', 'map-1:open', 30, CFG);
    expect(third).toEqual({ changed: true, oldIsland: isolated, newIsland: 'map-1:open' });
    expect(getIsland(tracker, 'alice')).toBe('map-1:open');
  });

  it('confirms early once the minimum elapsed time is reached, even with fewer samples', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG); // sample 1, isolates
    const result = onMove(tracker, 'alice', 'map-1:open', 400, CFG); // sample 2, but >= minMs elapsed
    expect(result.changed).toBe(true);
    expect(result.newIsland).toBe('map-1:open');
  });

  it('restarts (does not confirm) the hysteresis count when the player jitters back toward the original zone', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG); // isolate, pending=open x1
    // Jitters back toward kitchen before the exit-to-open confirms.
    // Still isolated/mid-exit: this does NOT immediately re-admit alice
    // to kitchen -- it restarts the hysteresis count toward kitchen, so a
    // player standing on the polygon edge can never flap other members'
    // allow-lists every tick.
    const first = onMove(tracker, 'alice', 'map-1:zone:kitchen', 20, CFG);
    expect(first.changed).toBe(false);
    expect(getIsland(tracker, 'alice')).toBe(isolatedIslandFor('alice'));

    onMove(tracker, 'alice', 'map-1:zone:kitchen', 30, CFG); // sample 2
    const confirmed = onMove(tracker, 'alice', 'map-1:zone:kitchen', 40, CFG); // sample 3
    expect(confirmed).toEqual({
      changed: true,
      oldIsland: isolatedIslandFor('alice'),
      newIsland: 'map-1:zone:kitchen',
    });
  });

  it('does not flap on alternating jitter between two different destinations', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG); // pending=open x1
    onMove(tracker, 'alice', 'map-1:zone:lounge', 20, CFG); // pending resets to lounge x1
    const result = onMove(tracker, 'alice', 'map-1:zone:lounge', 30, CFG); // lounge x2
    expect(result.changed).toBe(false);
    expect(getIsland(tracker, 'alice')).toBe(isolatedIslandFor('alice'));
  });
});

describe('onMove: zone A -> zone B', () => {
  it('closes A immediately (isolated), then opens B only after hysteresis confirms', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    const exitA = onMove(tracker, 'alice', 'map-1:zone:lounge', 10, CFG);
    expect(exitA.oldIsland).toBe('map-1:zone:kitchen');
    expect(exitA.newIsland).toBe(isolatedIslandFor('alice'));

    onMove(tracker, 'alice', 'map-1:zone:lounge', 20, CFG);
    const entryB = onMove(tracker, 'alice', 'map-1:zone:lounge', 30, CFG);
    expect(entryB).toEqual({ changed: true, oldIsland: isolatedIslandFor('alice'), newIsland: 'map-1:zone:lounge' });
  });
});

describe('removeMember', () => {
  it('returns the last committed island and clears tracking', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    const last = removeMember(tracker, 'alice');
    expect(last).toBe('map-1:zone:kitchen');
    expect(getIsland(tracker, 'alice')).toBeNull();
    expect(snapshot(tracker).has('alice')).toBe(false);
  });

  it('returns null for an identity that was never tracked', () => {
    const tracker = createMembershipTracker();
    expect(removeMember(tracker, 'ghost')).toBeNull();
  });
});

describe('sweepStalledExits', () => {
  it('commits a pending exit once minMs has elapsed, with no new onMove sample', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG); // isolates, pending=open x1, pendingSince=10
    expect(getIsland(tracker, 'alice')).toBe(isolatedIslandFor('alice'));

    // Alice stops moving: no further onMove calls arrive. Sweep at a time
    // >= pendingSince + minMs must still confirm the pending destination.
    const stalled = sweepStalledExits(tracker, 10 + CFG.minMs, CFG);

    expect(stalled).toEqual([
      {
        identity: 'alice',
        transition: { changed: true, oldIsland: isolatedIslandFor('alice'), newIsland: 'map-1:open' },
      },
    ]);
    expect(getIsland(tracker, 'alice')).toBe('map-1:open');
  });

  it('does not touch a member whose hysteresis window has not elapsed yet', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG);

    const stalled = sweepStalledExits(tracker, 10 + CFG.minMs - 1, CFG);

    expect(stalled).toEqual([]);
    expect(getIsland(tracker, 'alice')).toBe(isolatedIslandFor('alice'));
  });

  it('ignores members with no pending transition (settled entry, or never moved)', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:open', 0, CFG);
    onMove(tracker, 'bob', 'map-1:zone:kitchen', 0, CFG); // immediate entry, no pending state

    const stalled = sweepStalledExits(tracker, 100_000, CFG);

    expect(stalled).toEqual([]);
  });

  it('is idempotent: a second sweep after commit finds nothing left to advance', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:zone:kitchen', 0, CFG);
    onMove(tracker, 'alice', 'map-1:open', 10, CFG);
    sweepStalledExits(tracker, 10 + CFG.minMs, CFG);

    const secondSweep = sweepStalledExits(tracker, 10 + CFG.minMs + 1000, CFG);

    expect(secondSweep).toEqual([]);
  });
});

describe('snapshot', () => {
  it('reflects every tracked identity current committed island', () => {
    const tracker = createMembershipTracker();
    onMove(tracker, 'alice', 'map-1:open', 0, CFG);
    onMove(tracker, 'bob', 'map-1:zone:kitchen', 0, CFG);
    expect(Object.fromEntries(snapshot(tracker))).toEqual({
      alice: 'map-1:open',
      bob: 'map-1:zone:kitchen',
    });
  });
});
