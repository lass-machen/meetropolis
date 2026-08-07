/**
 * Regression proof for the relationship between Express proxy trust and the
 * per-IP budgets enforced by the rate-limit middleware.
 */
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'true';
});

import { errorHandler } from '../errorHandler.js';
import { createRateLimiter } from './rateLimit.js';

function makeApp(trustProxy: boolean | number, name: string): express.Application {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/limited', createRateLimiter({ name, windowMs: 60_000, limit: 1 }), (req, res) => {
    res.json({ ip: req.ip });
  });
  app.use(errorHandler);
  return app;
}

function forwardedFor(clientAddress: string): string {
  // The rightmost address represents the single proxy hop that is trusted.
  return `${clientAddress}, 203.0.113.254`;
}

afterEach(() => {
  delete process.env.RATE_LIMIT_ENABLED;
});

describe('proxy trust and IP rate-limit budgets', () => {
  it('lets a forged address reset the budget when the whole chain is trusted', async () => {
    const app = makeApp(true, 'trust_proxy_true_repro');

    const first = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.1'));
    const second = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.2'));
    const third = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.3'));
    const fourth = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.4'));
    const repeated = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.1'));

    expect([first.status, second.status, third.status, fourth.status]).toEqual([200, 200, 200, 200]);
    expect(first.body.ip).toBe('198.51.100.1');
    expect(second.body.ip).toBe('198.51.100.2');
    expect(third.body.ip).toBe('198.51.100.3');
    expect(fourth.body.ip).toBe('198.51.100.4');
    expect(repeated.status).toBe(429);
  });

  it('holds one budget when only the proxy hop is trusted', async () => {
    const app = makeApp(1, 'trust_proxy_one_repro');

    const first = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.10'));
    const forgedAgain = await request(app).get('/limited').set('X-Forwarded-For', forwardedFor('198.51.100.11'));

    expect(first.status).toBe(200);
    expect(first.body.ip).toBe('203.0.113.254');
    expect(forgedAgain.status).toBe(429);
  });
});
