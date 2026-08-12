import { logger } from '../logger.js';
import type { MobileSession } from './mobileSession.js';

/**
 * Live mobile sessions, keyed by session id.
 *
 * Each entry owns a Colyseus connection, so an unbounded registry is an
 * unbounded fan-out into the world room. The per-user cap below is the
 * backstop: a phone that reconnects in a loop (flaky network, app relaunch)
 * would otherwise accumulate ghost sessions that keep publishing presence
 * for a user who is no longer there.
 */

/** Enough for phone plus tablet plus one stale entry mid-reconnect. */
const MAX_SESSIONS_PER_USER = 3;

const sessions = new Map<string, MobileSession>();

export function registerSession(session: MobileSession): void {
  sessions.set(session.sessionId, session);
  void evictOldestBeyondCap(session.userId);
}

export function getSession(sessionId: string): MobileSession | undefined {
  return sessions.get(sessionId);
}

/**
 * Look up a session and verify it belongs to the caller. Returns undefined
 * for both "unknown" and "someone else's" — a caller must not be able to
 * probe which session ids exist by watching the error differ.
 */
export function getOwnedSession(sessionId: string, userId: string): MobileSession | undefined {
  const session = sessions.get(sessionId);
  if (!session || session.userId !== userId) return undefined;
  return session;
}

export async function removeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  sessions.delete(sessionId);
  await session.close();
}

export function sessionCount(): number {
  return sessions.size;
}

/** Test seam: drop everything without touching real timers twice. */
export async function closeAllSessions(): Promise<void> {
  const all = Array.from(sessions.values());
  sessions.clear();
  await Promise.all(all.map((s) => s.close()));
}

async function evictOldestBeyondCap(userId: string): Promise<void> {
  const owned = Array.from(sessions.values()).filter((s) => s.userId === userId);
  if (owned.length <= MAX_SESSIONS_PER_USER) return;
  // Insertion order of a Map is stable, so the head is the oldest session.
  const excess = owned.slice(0, owned.length - MAX_SESSIONS_PER_USER);
  for (const session of excess) {
    logger.info({ userId, sessionId: session.sessionId }, '[mobile] evicting session beyond per-user cap');
    await removeSession(session.sessionId);
  }
}
