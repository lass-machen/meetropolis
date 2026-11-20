/**
 * Shared rate-limit budget across two limiter instances against real Redis.
 */
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorHandler } from '../errorHandler.js';
import { closeSharedRedis } from '../../ops/redisConnection.js';
import { createRateLimiter } from './rateLimit.js';

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

describe.skipIf(!process.env.REDIS_TEST_URL)('createSharedRateLimitStore with Redis', { retry: 2 }, () => {
  beforeAll(() => {
    process.env.REDIS_URL = process.env.REDIS_TEST_URL;
  });

  afterAll(async () => {
    await closeSharedRedis();
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it('shares one budget across two separately created limiters of the same name', async () => {
    const name = `shared_${randomUUID()}`;
    const opts: LimiterOptions = { name, windowMs: 60_000, limit: 3 };
    const appA = makeApp(opts);
    const appB = makeApp(opts);

    expect((await request(appA).post('/protected')).status).toBe(200);
    expect((await request(appB).post('/protected')).status).toBe(200);
    expect((await request(appA).post('/protected')).status).toBe(200);
    expect((await request(appB).post('/protected')).status).toBe(429);
  });
});
