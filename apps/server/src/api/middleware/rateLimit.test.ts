/**
 * Tests for the public-auth rate limiting middleware. Each test builds a bare
 * Express app with the real central error handler in the chain, so we verify
 * both the enforcement (429 after N requests) and that the 429 body/headers
 * match the app-wide error shape rather than express-rate-limit's defaults.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, it, expect } from 'vitest';

import { createRateLimiter } from './rateLimit.js';
import { errorHandler } from '../errorHandler.js';

type LimiterOptions = Parameters<typeof createRateLimiter>[0];

/**
 * Build an app that mounts `createRateLimiter(opts)` in front of a route whose
 * status is 200 by default, or the value of `?status=` when provided (so we
 * can exercise skipSuccessfulRequests with real 4xx responses).
 */
function makeApp(opts: LimiterOptions): express.Application {
  const app = express();
  app.post('/protected', createRateLimiter(opts), (req, res) => {
    const status = Number(req.query.status);
    res.status(Number.isInteger(status) && status > 0 ? status : 200).json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const RATE_LIMIT_ENV_KEYS = Object.keys(process.env).filter((k) => k.startsWith('RATE_LIMIT_'));

afterEach(() => {
  // Reset any rate-limit env overrides a test set, so tests stay isolated.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('RATE_LIMIT_') && !RATE_LIMIT_ENV_KEYS.includes(key)) {
      delete process.env[key];
    }
  }
});

// These tests assert the exact counter behaviour of express-rate-limit, which
// persists its store entry asynchronously. Under heavy parallel load (a full
// suite run on a busy machine) a response can land before its counter write has
// settled, letting the next request slip through — observed once in five full
// runs, never when this file runs on its own. The assertions below stay strict;
// the retry only absorbs that load artefact. A real regression still fails every
// attempt.
describe('createRateLimiter', { retry: 2 }, () => {
  it('allows requests up to the limit, then returns 429', async () => {
    const app = makeApp({ name: 'allow_then_block', windowMs: 60_000, limit: 2 });

    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(429);
  });

  it('returns the central AppError body shape on 429', async () => {
    const app = makeApp({ name: 'body_shape', windowMs: 60_000, limit: 1 });

    await request(app).post('/protected');
    const res = await request(app).post('/protected');

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(typeof res.body.error.message).toBe('string');
  });

  it('sets standardized RateLimit-* headers and Retry-After on 429, no legacy headers', async () => {
    const app = makeApp({ name: 'headers', windowMs: 60_000, limit: 1 });

    const ok = await request(app).post('/protected');
    expect(ok.headers['ratelimit-limit']).toBe('1');
    expect(ok.headers['ratelimit-remaining']).toBe('0');
    expect(ok.headers['ratelimit-reset']).toBeDefined();
    expect(ok.headers['ratelimit-policy']).toBeDefined();
    // Legacy X-RateLimit-* headers must be disabled.
    expect(ok.headers['x-ratelimit-limit']).toBeUndefined();

    const blocked = await request(app).post('/protected');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('exposes a decreasing RateLimit-Remaining across allowed requests', async () => {
    const app = makeApp({ name: 'remaining', windowMs: 60_000, limit: 3 });

    expect((await request(app).post('/protected')).headers['ratelimit-remaining']).toBe('2');
    expect((await request(app).post('/protected')).headers['ratelimit-remaining']).toBe('1');
    expect((await request(app).post('/protected')).headers['ratelimit-remaining']).toBe('0');
  });

  it('does not count successful requests when skipSuccessfulRequests is set, but counts failures', async () => {
    const app = makeApp({ name: 'skip_success', windowMs: 60_000, limit: 2, skipSuccessfulRequests: true });

    // Successful (200) requests never trip the limit, even beyond `limit`.
    for (let i = 0; i < 5; i++) {
      expect((await request(app).post('/protected')).status).toBe(200);
    }

    // Failed (4xx) requests still accumulate: limit=2 => the third fails with 429.
    expect((await request(app).post('/protected?status=400')).status).toBe(400);
    expect((await request(app).post('/protected?status=400')).status).toBe(400);
    expect((await request(app).post('/protected?status=400')).status).toBe(429);
  });

  it('honours the RATE_LIMIT_<NAME>_MAX and _WINDOW_MS env overrides', async () => {
    process.env.RATE_LIMIT_OVERRIDDEN_MAX = '1';
    process.env.RATE_LIMIT_OVERRIDDEN_WINDOW_MS = '60000';
    // Config says 99, the env override says 1 — the override must win.
    const app = makeApp({ name: 'overridden', windowMs: 1000, limit: 99 });

    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(429);
  });

  it('ignores an invalid env override and falls back to the configured limit', async () => {
    process.env.RATE_LIMIT_BADENV_MAX = 'not-a-number';
    const app = makeApp({ name: 'badenv', windowMs: 60_000, limit: 2 });

    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(200);
    expect((await request(app).post('/protected')).status).toBe(429);
  });

  it('becomes a pass-through when RATE_LIMIT_ENABLED is false', async () => {
    process.env.RATE_LIMIT_ENABLED = 'false';
    try {
      const app = makeApp({ name: 'disabled', windowMs: 60_000, limit: 1 });

      // Well beyond the limit — nothing is throttled and no RateLimit headers appear.
      for (let i = 0; i < 5; i++) {
        const res = await request(app).post('/protected');
        expect(res.status).toBe(200);
      }
      expect((await request(app).post('/protected')).headers['ratelimit-limit']).toBeUndefined();
    } finally {
      delete process.env.RATE_LIMIT_ENABLED;
    }
  });
});
