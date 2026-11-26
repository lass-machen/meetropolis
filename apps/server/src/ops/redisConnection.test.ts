/**
 * Tests for the shared Redis connection helpers.
 *
 * Configuration is read from the environment object passed in, so the
 * cases below never touch `process.env`. The single exception is the
 * client-options case: `getSharedRedis` reads `process.env` by design,
 * so that case sets `REDIS_URL` briefly and restores it afterwards.
 */
import { describe, expect, it } from 'vitest';

import { closeSharedRedis, getSharedRedis, isMultiProcessMode, readRedisUrl } from './redisConnection.js';

describe('readRedisUrl', () => {
  it('returns undefined when REDIS_URL is missing', () => {
    expect(readRedisUrl({})).toBeUndefined();
  });

  it('returns undefined when REDIS_URL is empty', () => {
    expect(readRedisUrl({ REDIS_URL: '' })).toBeUndefined();
  });

  it('returns undefined when REDIS_URL is only whitespace', () => {
    expect(readRedisUrl({ REDIS_URL: '   ' })).toBeUndefined();
  });

  it('returns the trimmed value when REDIS_URL is set', () => {
    expect(readRedisUrl({ REDIS_URL: '  redis://localhost:6379  ' })).toBe('redis://localhost:6379');
  });
});

describe('isMultiProcessMode', () => {
  it('is false without a usable REDIS_URL', () => {
    expect(isMultiProcessMode({})).toBe(false);
    expect(isMultiProcessMode({ REDIS_URL: '' })).toBe(false);
    expect(isMultiProcessMode({ REDIS_URL: '   ' })).toBe(false);
  });

  it('is true when REDIS_URL is set', () => {
    expect(isMultiProcessMode({ REDIS_URL: 'redis://localhost:6379' })).toBe(true);
  });
});

describe('getSharedRedis', () => {
  it('returns undefined without REDIS_URL', () => {
    expect(getSharedRedis()).toBeUndefined();
  });

  it('creates a client that fails fast when Redis is unreachable', async () => {
    const originalUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      const client = getSharedRedis();
      expect(client).toBeDefined();
      expect(client?.options.enableOfflineQueue).toBe(false);
      expect(client?.options.maxRetriesPerRequest).toBe(1);
      expect(getSharedRedis()).toBe(client);
    } finally {
      // The client never became ready; closing must still end cleanly.
      await closeSharedRedis();
      if (originalUrl === undefined) {
        delete process.env.REDIS_URL;
      } else {
        process.env.REDIS_URL = originalUrl;
      }
    }
  });
});

describe('closeSharedRedis', () => {
  it('is a no-op without a client', async () => {
    await expect(closeSharedRedis()).resolves.toBeUndefined();
  });
});
