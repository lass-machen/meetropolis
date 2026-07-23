/**
 * The admin-issued reset token must still work end to end after reset tokens
 * moved to hashed storage: the admin route and POST /auth/reset are two sides
 * of one contract, and a token issued out of band is worthless if the redeem
 * path cannot match it. This is the regression that a hashed rewrite invites,
 * so it gets its own test.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'admin-reset-test-secret';
  process.env.API_TOKEN_PEPPER = 'admin-reset-test-pepper';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/rateLimit.js', () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    loginRateLimiter: passthrough,
    registrationRateLimiter: passthrough,
    passwordResetRateLimiter: passthrough,
    forgotPasswordEmailRateLimiter: passthrough,
    emailVerificationRateLimiter: passthrough,
  };
});

import { registerAdminPasswordResetRoutes } from './admin.passwordReset.js';
import { registerAuthRoutes } from './auth.js';
import { setAuthResolution } from '../utils/authState.js';
import { clearSessionCache } from '../utils/sessionCache.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

interface ResetRow {
  token: string;
  userId: string;
  usedAt: Date | null;
  expiresAt: Date;
}

let resets: ResetRow[];
let passwordHash: string | null;

const TARGET = { id: 'user-target', email: 'target@example.test', name: 'Target' };
const INTERNAL = { id: 'internal-tenant', slug: 'internal' };

function makePrisma(): PrismaClient {
  return {
    user: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === TARGET.id ? { ...TARGET, passwordHash } : null),
      update: ({ data }: { data: { passwordHash?: string } }) => {
        if (data.passwordHash) passwordHash = data.passwordHash;
        return Promise.resolve({ ...TARGET, passwordHash });
      },
    },
    tenant: {
      findUnique: ({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? INTERNAL : null),
    },
    membership: {
      findUnique: () => Promise.resolve({ role: 'owner' }),
    },
    session: {
      findUnique: () => Promise.resolve(null),
      deleteMany: () => Promise.resolve({ count: 0 }),
    },
    passwordReset: {
      create: ({ data }: { data: Omit<ResetRow, 'usedAt'> }) => {
        const row: ResetRow = { usedAt: null, ...data };
        resets.push(row);
        return Promise.resolve({ ...row });
      },
      findUnique: ({ where }: { where: { token: string } }) => {
        const row = resets.find((r) => r.token === where.token);
        return Promise.resolve(row ? { ...row } : null);
      },
      deleteMany: ({ where }: { where: { userId: string; usedAt: null } }) => {
        const before = resets.length;
        resets = resets.filter((r) => !(r.userId === where.userId && r.usedAt === null));
        return Promise.resolve({ count: before - resets.length });
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { token: string; usedAt: null; expiresAt: { gt: Date } };
        data: { usedAt: Date };
      }) => {
        const matched = resets.filter(
          (r) => r.token === where.token && r.usedAt === null && r.expiresAt > where.expiresAt.gt,
        );
        matched.forEach((r) => (r.usedAt = data.usedAt));
        return Promise.resolve({ count: matched.length });
      },
    },
  } as unknown as PrismaClient;
}

function makeApp(): express.Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const prisma = makePrisma();
  // The caller is an authenticated internal owner (super-admin).
  app.use((req, _res, next) => {
    setAuthResolution(req, {
      auth: { userId: 'admin-1', tenantId: INTERNAL.id, sessionId: 'sess-admin', tokenHash: 'hash-admin' },
    });
    (req as express.Request & { tenant?: unknown }).tenant = { ...INTERNAL };
    next();
  });
  registerAdminPasswordResetRoutes(app, prisma);
  registerAuthRoutes(app, prisma);
  return app;
}

beforeEach(() => {
  resets = [];
  passwordHash = 'old-hash';
  clearSessionCache();
});

describe('admin-issued reset tokens (out-of-band fallback)', () => {
  it('returns a token that POST /auth/reset accepts', async () => {
    const app = makeApp();

    const issued = await request(app).post(`/admin/users/${TARGET.id}/reset-token`);
    expect(issued.status).toBe(200);
    expect(issued.body.token).toBeTruthy();

    const reset = await request(app)
      .post('/auth/reset')
      .send({ token: issued.body.token, email: TARGET.email, password: 'brandnewpassword' });

    expect(reset.status).toBe(200);
    expect(passwordHash).not.toBe('old-hash');
  });

  it('stores the admin token hashed, like the self-service one', async () => {
    const app = makeApp();

    const issued = await request(app).post(`/admin/users/${TARGET.id}/reset-token`);

    expect(resets).toHaveLength(1);
    expect(resets[0].token).not.toBe(issued.body.token);
    expect(resets[0].token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('burns the admin token after one use', async () => {
    const app = makeApp();
    const issued = await request(app).post(`/admin/users/${TARGET.id}/reset-token`);

    await request(app).post('/auth/reset').send({ token: issued.body.token, password: 'brandnewpassword' }).expect(200);

    await request(app).post('/auth/reset').send({ token: issued.body.token, password: 'anotherpassword' }).expect(400);
  });
});
