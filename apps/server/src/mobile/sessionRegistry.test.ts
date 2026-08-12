import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MobileSession } from './mobileSession.js';
import {
  registerSession,
  getOwnedSession,
  getSession,
  removeSession,
  closeAllSessions,
  sessionCount,
} from './sessionRegistry.js';

/** The registry only needs an id, an owner and a way to shut the entry down. */
function fakeSession(sessionId: string, userId: string) {
  return {
    sessionId,
    userId,
    close: vi.fn(async () => {}),
  } as unknown as MobileSession & { close: ReturnType<typeof vi.fn> };
}

beforeEach(async () => {
  await closeAllSessions();
});

describe('session ownership', () => {
  it('returns a session to its owner', () => {
    const session = fakeSession('s1', 'user-1');
    registerSession(session);
    expect(getOwnedSession('s1', 'user-1')).toBe(session);
  });

  it('refuses a session that belongs to someone else', () => {
    // Without this check, any authenticated account could steer a stranger's
    // avatar by guessing a session id.
    registerSession(fakeSession('s1', 'user-1'));
    expect(getOwnedSession('s1', 'user-2')).toBeUndefined();
  });

  it('answers the same way for unknown and for foreign ids', () => {
    registerSession(fakeSession('s1', 'user-1'));
    // Both undefined, so the caller cannot probe which ids exist.
    expect(getOwnedSession('does-not-exist', 'user-2')).toBeUndefined();
    expect(getOwnedSession('s1', 'user-2')).toBeUndefined();
  });
});

describe('session lifecycle', () => {
  it('closes the session when it is removed', async () => {
    const session = fakeSession('s1', 'user-1');
    registerSession(session);
    await removeSession('s1');
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(getSession('s1')).toBeUndefined();
  });

  it('tolerates removing an id that is already gone', async () => {
    await expect(removeSession('never-existed')).resolves.toBeUndefined();
  });
});

describe('per-user cap', () => {
  it('keeps a handful of devices for the same user', () => {
    registerSession(fakeSession('s1', 'user-1'));
    registerSession(fakeSession('s2', 'user-1'));
    registerSession(fakeSession('s3', 'user-1'));
    expect(sessionCount()).toBe(3);
  });

  it('evicts the oldest session once a user exceeds the cap', async () => {
    // A phone stuck in a reconnect loop would otherwise accumulate ghost
    // sessions, each holding a Colyseus connection into the world room.
    const oldest = fakeSession('s1', 'user-1');
    registerSession(oldest);
    registerSession(fakeSession('s2', 'user-1'));
    registerSession(fakeSession('s3', 'user-1'));
    registerSession(fakeSession('s4', 'user-1'));

    await vi.waitFor(() => expect(getSession('s1')).toBeUndefined());
    expect(oldest.close).toHaveBeenCalled();
    expect(getSession('s4')).toBeDefined();
  });

  it('counts the cap per user, not globally', async () => {
    registerSession(fakeSession('a1', 'user-1'));
    registerSession(fakeSession('a2', 'user-1'));
    registerSession(fakeSession('a3', 'user-1'));
    registerSession(fakeSession('b1', 'user-2'));

    await vi.waitFor(() => expect(sessionCount()).toBe(4));
    expect(getSession('a1')).toBeDefined();
    expect(getSession('b1')).toBeDefined();
  });
});
