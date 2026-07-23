import { describe, it, expect } from 'vitest';
import { effectiveSeatCap } from './seatCap';

describe('effectiveSeatCap', () => {
  it('reproduces the reported contradiction: freeSeats=3 + tier=5 admits 5, not 8', () => {
    // The organisation dialog showed 8 (3 + 5) while the world admitted 5.
    expect(effectiveSeatCap({ freeSeats: 3, concurrentLimit: 5 })).toBe(5);
  });

  it('keeps the free baseline when the tier is smaller', () => {
    expect(effectiveSeatCap({ freeSeats: 3, concurrentLimit: 1 })).toBe(3);
  });

  it('uses the tier when it exceeds the baseline', () => {
    expect(effectiveSeatCap({ freeSeats: 3, concurrentLimit: 50 })).toBe(50);
  });

  it('never sums the two inputs when both are positive', () => {
    // With a zero on either side max and sum coincide, so those cases prove
    // nothing here — they are covered by the terminal-state tests below.
    for (const [free, tier] of [
      [3, 5],
      [1, 1],
      [10, 2],
      [3, 50],
    ] as const) {
      expect(effectiveSeatCap({ freeSeats: free, concurrentLimit: tier })).not.toBe(free + tier);
    }
  });

  it('handles a zero tier (canceled tenant) by falling back to the free baseline', () => {
    expect(effectiveSeatCap({ freeSeats: 3, concurrentLimit: 0 })).toBe(3);
  });

  it('returns 0 when both are 0 — a terminal, no-access state', () => {
    expect(effectiveSeatCap({ freeSeats: 0, concurrentLimit: 0 })).toBe(0);
  });
});
