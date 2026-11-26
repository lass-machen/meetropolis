import { LocalPresence } from '@colyseus/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSessionInvalidationRelay, SESSION_INVALIDATED_CHANNEL } from './sessionInvalidationRelay.js';
import { clearSessionCache, getCachedSession, invalidateSessionToken, setCachedSession } from './sessionCache.js';
import type { ResolvedAuth } from './authState.js';

function seed(tokenHash: string, userId: string): void {
  const auth: ResolvedAuth = { userId, sessionId: `session-${tokenHash}`, tokenHash };
  setCachedSession(auth, new Date(Date.now() + 60_000));
}

describe('sessionInvalidationRelay with LocalPresence', () => {
  let presence: LocalPresence;
  let uninstall: (() => void) | undefined;

  beforeEach(() => {
    clearSessionCache();
    presence = new LocalPresence();
  });

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    clearSessionCache();
  });

  it('removes the cached entry for a token invalidation from another process', () => {
    uninstall = installSessionInvalidationRelay(presence, 'process-a');
    seed('hash-1', 'user-1');

    presence.publish(SESSION_INVALIDATED_CHANNEL, {
      kind: 'token',
      tokenHash: 'hash-1',
      origin: 'process-b',
    });

    expect(getCachedSession('hash-1')).toBeNull();
  });

  it('removes every cached entry for a user invalidation from another process', () => {
    uninstall = installSessionInvalidationRelay(presence, 'process-a');
    seed('hash-1', 'user-1');
    seed('hash-2', 'user-1');
    seed('hash-3', 'user-2');

    presence.publish(SESSION_INVALIDATED_CHANNEL, {
      kind: 'user',
      userId: 'user-1',
      origin: 'process-b',
    });

    expect(getCachedSession('hash-1')).toBeNull();
    expect(getCachedSession('hash-2')).toBeNull();
    expect(getCachedSession('hash-3')).not.toBeNull();
  });

  it('ignores messages with its own origin', () => {
    uninstall = installSessionInvalidationRelay(presence, 'process-a');
    seed('hash-1', 'user-1');

    presence.publish(SESSION_INVALIDATED_CHANNEL, {
      kind: 'token',
      tokenHash: 'hash-1',
      origin: 'process-a',
    });

    expect(getCachedSession('hash-1')).not.toBeNull();
  });

  it('publishes exactly one message with origin when a token is invalidated locally', () => {
    const messages: unknown[] = [];
    void presence.subscribe(SESSION_INVALIDATED_CHANNEL, (message: unknown) => {
      messages.push(message);
    });
    uninstall = installSessionInvalidationRelay(presence, 'process-a');
    seed('hash-1', 'user-1');

    invalidateSessionToken('hash-1');

    expect(getCachedSession('hash-1')).toBeNull();
    expect(messages).toEqual([{ kind: 'token', tokenHash: 'hash-1', origin: 'process-a' }]);
  });

  it('publishes nothing after the relay is uninstalled', () => {
    const messages: unknown[] = [];
    void presence.subscribe(SESSION_INVALIDATED_CHANNEL, (message: unknown) => {
      messages.push(message);
    });
    uninstall = installSessionInvalidationRelay(presence, 'process-a');
    uninstall();
    uninstall = undefined;
    seed('hash-1', 'user-1');

    invalidateSessionToken('hash-1');

    expect(messages).toEqual([]);
  });
});
