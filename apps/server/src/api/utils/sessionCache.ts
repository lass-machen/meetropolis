import { logger } from '../../logger.js';
import type { ResolvedAuth } from './authState.js';

/**
 * Short-lived, in-process cache for resolved sessions.
 *
 * Every authenticated request now validates its token against the `Session`
 * table (see sessionAuth.ts) — the row, not the JWT signature, is the
 * authority, so revoking a session takes effect immediately instead of leaving
 * the cookie usable for the remaining 30 days of the token's lifetime. Without
 * a cache that check would add one indexed lookup to every request on the hot
 * path (world join, presence, avatar resolve). Caching the positive result for
 * a few seconds keeps the added cost near zero for a busy client while bounding
 * how long a revoked token can survive.
 *
 * Deliberate design points:
 *
 * - Positive results only. A token with a valid signature but no session row
 *   (revoked, logged out, or issued by a login path that never recorded one)
 *   re-queries every time. That is the rare/attack path, and it removes the
 *   need to invalidate negative entries when a session is established for a
 *   token hash that was previously looked up.
 * - Revocation invalidates eagerly ({@link invalidateSessionToken} /
 *   {@link invalidateSessionsForUser}), so the TTL is only the ceiling for
 *   revocations this process did not perform itself.
 * - With several server processes the relay in sessionInvalidationRelay.ts
 *   forwards each invalidation to the other processes over the shared
 *   presence channel (Redis pub/sub when Redis is configured), so their
 *   caches drop the same entries at once. The TTL remains the bound for
 *   processes without the relay installed and for messages that are lost.
 */

/** How long a resolved session stays trusted without re-reading the row. */
export const SESSION_CACHE_TTL_MS = 30_000;

/**
 * Hard cap on cached sessions. Sized well above the concurrent-session count of
 * a single-node deployment; the eviction below is a memory backstop against
 * token churn (each new login mints a new key), not a tuning knob.
 */
const MAX_ENTRIES = 5_000;

interface CacheEntry {
  auth: ResolvedAuth;
  /** Absolute expiry of the underlying `Session` row. */
  sessionExpiresAtMs: number;
  /** When this entry was written; entries live for SESSION_CACHE_TTL_MS. */
  cachedAtMs: number;
}

/** Insertion-ordered (Map guarantee), which the FIFO eviction below relies on. */
const entries = new Map<string, CacheEntry>();

/**
 * Return the cached identity for `tokenHash`, or null when absent, stale, or
 * backed by a session that has since expired.
 */
export function getCachedSession(tokenHash: string, nowMs: number = Date.now()): ResolvedAuth | null {
  const entry = entries.get(tokenHash);
  if (!entry) return null;
  if (nowMs - entry.cachedAtMs >= SESSION_CACHE_TTL_MS || entry.sessionExpiresAtMs <= nowMs) {
    entries.delete(tokenHash);
    return null;
  }
  return entry.auth;
}

/** Cache a session that was just read from (or written to) the database. */
export function setCachedSession(auth: ResolvedAuth, sessionExpiresAt: Date, nowMs: number = Date.now()): void {
  if (entries.size >= MAX_ENTRIES) evictOldest(nowMs);
  entries.set(auth.tokenHash, {
    auth,
    sessionExpiresAtMs: sessionExpiresAt.getTime(),
    cachedAtMs: nowMs,
  });
}

/** A session invalidation that other processes must apply to their caches. */
export type SessionInvalidation = { kind: 'token'; tokenHash: string } | { kind: 'user'; userId: string };

let invalidationPublisher: ((event: SessionInvalidation) => void) | undefined;

/**
 * Set the publisher that forwards local invalidations to other processes, or
 * clear it with `undefined`. The relay in sessionInvalidationRelay.ts owns
 * this hook while it is installed.
 */
export function setSessionInvalidationPublisher(publisher: ((event: SessionInvalidation) => void) | undefined): void {
  invalidationPublisher = publisher;
}

/** Apply an invalidation to this process's cache only, without publishing it. */
export function applySessionInvalidation(event: SessionInvalidation): void {
  if (event.kind === 'token') {
    entries.delete(event.tokenHash);
    return;
  }
  for (const [tokenHash, entry] of entries) {
    if (entry.auth.userId === event.userId) entries.delete(tokenHash);
  }
}

function publishSessionInvalidation(event: SessionInvalidation): void {
  if (!invalidationPublisher) return;
  try {
    invalidationPublisher(event);
  } catch (e: unknown) {
    logger.warn({
      event: 'auth.session.invalidation_publish_failed',
      kind: event.kind,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Drop the entry for a single token — used when its session is revoked. */
export function invalidateSessionToken(tokenHash: string): void {
  const event: SessionInvalidation = { kind: 'token', tokenHash };
  applySessionInvalidation(event);
  publishSessionInvalidation(event);
}

/**
 * Drop every entry belonging to `userId` — used when all of a user's sessions
 * are revoked at once (logout-everywhere, password change, password reset).
 * Linear over a map bounded by MAX_ENTRIES, and only on those rare writes.
 */
export function invalidateSessionsForUser(userId: string): void {
  const event: SessionInvalidation = { kind: 'user', userId };
  applySessionInvalidation(event);
  publishSessionInvalidation(event);
}

/** Test seam: drop everything. */
export function clearSessionCache(): void {
  entries.clear();
}

/** Test seam: current entry count. */
export function sessionCacheSize(): number {
  return entries.size;
}

/**
 * Make room by first sweeping entries that are stale or whose session expired,
 * and — if that frees nothing — dropping the oldest insertion. Both are safe:
 * a miss only costs one indexed lookup.
 */
function evictOldest(nowMs: number): void {
  for (const [tokenHash, entry] of entries) {
    if (nowMs - entry.cachedAtMs >= SESSION_CACHE_TTL_MS || entry.sessionExpiresAtMs <= nowMs) {
      entries.delete(tokenHash);
    }
  }
  if (entries.size < MAX_ENTRIES) return;
  const oldest = entries.keys().next();
  if (!oldest.done) entries.delete(oldest.value);
}
