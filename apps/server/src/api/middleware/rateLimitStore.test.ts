/**
 * Shared rate-limit store without a Redis daemon: unset REDIS_URL keeps the
 * in-process MemoryStore, and an unreachable REDIS_URL falls back locally.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../errorHandler.js';
import { logger } from '../../logger.js';
import { closeSharedRedis } from '../../ops/redisConnection.js';
import { createRateLimiter } from './rateLimit.js';
import { createSharedRateLimitStore } from './rateLimitStore.js';

type LimiterOptions = Parameters<typeof createRateLimiter>[0];

function makeApp(opts: LimiterOptions): express.Application {
  const app = express();
  app.post('/protected', createRateLimiter(opts), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const originalRedisUrl = process.env.REDIS_URL;

afterEach(async () => {
  await closeSharedRedis();
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

describe('createSharedRateLimitStore', { retry: 2 }, () => {
  it('returns undefined when REDIS_URL is unset and createRateLimiter still enforces the budget', async () => {
    delete process.env.REDIS_URL;
    expect(createSharedRateLimitStore('store_memory')).toBeUndefined();

    const app = makeApp({ name: 'store_memory', windowMs: 60_000, limit: 2 });
    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(429);
  });

  it('falls back to a process-local store when Redis is unreachable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const errorSpy = vi.spyOn(logger, 'error');
    try {
      const app = makeApp({ name: `store_fallback_${Date.now()}`, windowMs: 60_000, limit: 3 });
      expect((await request(app).post('/protected')).status).toBe(200);
      expect((await request(app).post('/protected')).status).toBe(200);
      expect((await request(app).post('/protected')).status).toBe(200);
      const blocked = await request(app).post('/protected');
      expect(blocked.status).toBe(429);
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      await closeSharedRedis();
    }
  });
});
