import { RedisPresence } from '@colyseus/redis-presence';
import { describe, expect, it } from 'vitest';
import { installSessionInvalidationRelay, SESSION_INVALIDATED_CHANNEL } from './sessionInvalidationRelay.js';
import { clearSessionCache, getCachedSession, setCachedSession } from './sessionCache.js';
import type { ResolvedAuth } from './authState.js';

const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

// Redis pub/sub drops messages published before SUBSCRIBE completes, so the test republishes until the subscription is live.
function waitFor(condition: () => boolean, republish: () => Promise<unknown>, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const republishTimer = setInterval(() => {
      republish().catch(() => undefined);
    }, 100);
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer);
        clearInterval(republishTimer);
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        clearInterval(republishTimer);
        reject(new Error('timed out waiting for session invalidation over Redis'));
      }
    }, 25);
  });
}

describe.skipIf(!REDIS_TEST_URL)('sessionInvalidationRelay with RedisPresence', () => {
  it('applies an invalidation published by another process', async () => {
    const url = REDIS_TEST_URL as string;
    const publisher = new RedisPresence(url);
    const receiver = new RedisPresence(url);
    const uninstall = installSessionInvalidationRelay(receiver, 'process-b');
    try {
      const auth: ResolvedAuth = { userId: 'user-1', sessionId: 'session-1', tokenHash: 'hash-1' };
      setCachedSession(auth, new Date(Date.now() + 60_000));
      expect(getCachedSession('hash-1')).not.toBeNull();

      const republish = (): Promise<unknown> =>
        publisher.publish(SESSION_INVALIDATED_CHANNEL, {
          kind: 'token',
          tokenHash: 'hash-1',
          origin: 'process-a',
        });

      await waitFor(() => getCachedSession('hash-1') === null, republish);
      expect(getCachedSession('hash-1')).toBeNull();
    } finally {
      uninstall();
      clearSessionCache();
      publisher.shutdown();
      receiver.shutdown();
    }
  });
});
