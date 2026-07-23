export interface BackoffOptions {
  /** Delay before the first retry attempt. */
  baseDelayMs: number;
  /** Upper bound for the computed delay, including jitter. */
  maxDelayMs: number;
  /** Maximum random jitter added on top of the exponential delay. */
  jitterMs?: number;
}

/**
 * Computes the delay before retry number `attempt` (1-based) as
 * `baseDelayMs * 2^(attempt - 1)` plus optional random jitter, capped at
 * `maxDelayMs`. Attempts below 1 are treated as 1. `random` is injectable
 * for deterministic tests and must return a value in [0, 1).
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: BackoffOptions,
  random: () => number = Math.random,
): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  const exponential = options.baseDelayMs * Math.pow(2, normalizedAttempt - 1);
  const jitter = (options.jitterMs ?? 0) * random();
  return Math.min(options.maxDelayMs, exponential + jitter);
}
