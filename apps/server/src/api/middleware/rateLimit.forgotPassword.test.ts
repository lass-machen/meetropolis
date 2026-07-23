/**
 * Tests for the per-ADDRESS budget on POST /auth/forgot.
 *
 * Lives in its own file because the limiters are built once at module import
 * from the environment, and this one needs `RATE_LIMIT_FORGOT_PASSWORD_EMAIL_*`
 * set before that happens — rateLimit.test.ts covers the factory itself.
 *
 * Why the endpoint needs a second budget on top of the per-IP one: it now mails
 * a real reset link, so a caller who rotates IPs could otherwise bury a known
 * address in mail (and keep invalidating the link its owner is trying to use).
 */
import express from 'express';
import request from 'supertest';
import { describe, it, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.RATE_LIMIT_ENABLED = 'true';
  // A small, explicit budget so the test states its own limit.
  process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL_MAX = '2';
  process.env.RATE_LIMIT_FORGOT_PASSWORD_EMAIL_WINDOW_MS = '60000';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { forgotPasswordEmailRateLimiter } from './rateLimit.js';
import { errorHandler } from '../errorHandler.js';

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.post('/auth/forgot', forgotPasswordEmailRateLimiter, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

let app: express.Application;

beforeEach(() => {
  app = makeApp();
});

const forgot = (email: unknown) => request(app).post('/auth/forgot').send({ email });

// The limiter is a module-level singleton with a process-wide MemoryStore, so
// its counters outlive a test. Each test therefore uses addresses of its own
// rather than resetting shared state — which is also closer to production,
// where the store is never reset either.
describe('forgotPasswordEmailRateLimiter', () => {
  it('budgets per address, not per request', async () => {
    await forgot('budget@example.test').expect(200);
    await forgot('budget@example.test').expect(200);

    await forgot('budget@example.test').expect(429);
  });

  it('does not let one address consume another address budget', async () => {
    await forgot('victim@example.test').expect(200);
    await forgot('victim@example.test').expect(200);
    await forgot('victim@example.test').expect(429);

    // Same IP, different address: still served, because the budget belongs to
    // the address. (The per-IP limiter mounted alongside it caps this.)
    await forgot('bystander@example.test').expect(200);
  });

  it('ignores case and surrounding whitespace when keying', async () => {
    await forgot('casing@example.test').expect(200);
    await forgot('  Casing@Example.TEST  ').expect(200);

    // Would still be request #1 for a naive key.
    await forgot('CASING@example.test').expect(429);
  });

  it('keeps counting a request without a usable address', async () => {
    // Falls back to the IP budget rather than dodging accounting entirely.
    // These are the only requests in this file that key by IP.
    await forgot(undefined).expect(200);
    await forgot(42).expect(200);

    await forgot(null).expect(429);
  });
});
