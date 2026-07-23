import { describe, it, expect } from 'vitest';
import { computeBackoffDelayMs } from './backoff';

describe('computeBackoffDelayMs', () => {
  const options = { baseDelayMs: 1_000, maxDelayMs: 30_000 };

  it('returns the base delay for the first attempt', () => {
    expect(computeBackoffDelayMs(1, options)).toBe(1_000);
  });

  it('doubles the delay per attempt', () => {
    expect(computeBackoffDelayMs(2, options)).toBe(2_000);
    expect(computeBackoffDelayMs(3, options)).toBe(4_000);
    expect(computeBackoffDelayMs(5, options)).toBe(16_000);
  });

  it('caps the delay at maxDelayMs', () => {
    expect(computeBackoffDelayMs(6, options)).toBe(30_000);
    expect(computeBackoffDelayMs(20, options)).toBe(30_000);
  });

  it('stays finite and capped for very large attempt numbers', () => {
    expect(computeBackoffDelayMs(5_000, options)).toBe(30_000);
  });

  it('clamps attempts below 1 to the first attempt', () => {
    expect(computeBackoffDelayMs(0, options)).toBe(1_000);
    expect(computeBackoffDelayMs(-3, options)).toBe(1_000);
  });

  it('adds jitter bounded by jitterMs', () => {
    const withJitter = { ...options, jitterMs: 500 };
    expect(computeBackoffDelayMs(1, withJitter, () => 0)).toBe(1_000);
    expect(computeBackoffDelayMs(1, withJitter, () => 1)).toBe(1_500);
    expect(computeBackoffDelayMs(2, withJitter, () => 0.5)).toBe(2_250);
  });

  it('caps the jittered delay at maxDelayMs', () => {
    const withJitter = { ...options, jitterMs: 500 };
    expect(computeBackoffDelayMs(6, withJitter, () => 1)).toBe(30_000);
  });
});
