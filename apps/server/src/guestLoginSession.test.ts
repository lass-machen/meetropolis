/**
 * Guest magic-link redemption must establish a real session, or fail the login.
 *
 * `POST /auth/guest` used to mint the JWT, set the auth cookie and only then
 * record the `Session` row through a helper whose catch merely logged. Since the
 * session row became the authority (api/utils/sessionAuth.ts), a swallowed
 * insert failure stopped being a harmless tracking gap: the guest walked away
 * with a 200, a valid cookie and no session row — which resolves to 401 on the
 * very next request and cannot be revoked from the session list either.
 *
 * The route now goes through `establishSession`, so the row is written BEFORE
 * the cookie and a failure propagates. These tests assert the two properties
 * that inversion buys, against `validateSessionToken` — the same function the
 * Colyseus world join (rooms/lifecycle/onAuth.ts) authenticates with.
 */
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = { id: 'tenant-1', slug: 'acme' };
const GUEST_USER = { id: 'guest-user-1', email: 'guest@example.test', name: 'Guest' };
const RAW_GUEST_TOKEN = 'f'.repeat(64);

vi.hoisted(() => {
  process.env.JWT_SECRET = 'guest-login-test-secret';
  process.env.NODE_ENV = 'test';
});

/**
 * In-memory Prisma double. `session.create` is switchable: `failNextCreate`
 * reproduces the transient insert failure (pool exhausted, dropped connection)
 * whose swallowing was the bug.
 */
const db = vi.hoisted(() => {
  interface SessionRow {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
    lastActiveAt: Date;
  }
  const sessions: SessionRow[] = [];
  // `validTokenHash` is filled in beforeEach: hashing needs the crypto import,
  // which is not initialised yet inside this hoisted block.
  const state = {
    failNextCreate: false,
    validTokenHash: '',
    guestTokenExpiresAt: new Date(),
    membershipExpiresAt: new Date(),
  };

  const prisma = {
    session: {
      create: ({ data }: any) => {
        if (state.failNextCreate) return Promise.reject(new Error('db unavailable'));
        const row: SessionRow = {
          id: `sess-${sessions.length + 1}`,
          userId: data.userId,
          tokenHash: data.tokenHash,
          userAgent: data.userAgent ?? null,
          ipAddress: data.ipAddress ?? null,
          expiresAt: data.expiresAt,
          lastActiveAt: new Date(),
        };
        sessions.push(row);
        return Promise.resolve({ id: row.id });
      },
      findUnique: ({ where }: any) => Promise.resolve(sessions.find((r) => r.tokenHash === where.tokenHash) ?? null),
      update: ({ where, data }: any) => {
        const row = sessions.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row ?? null);
      },
    },
    guestToken: {
      findUnique: ({ where }: any) => {
        if (where.token !== state.validTokenHash) return Promise.resolve(null);
        return Promise.resolve({
          token: where.token,
          expiresAt: state.guestTokenExpiresAt,
          membership: {
            expiresAt: state.membershipExpiresAt,
            user: { id: 'guest-user-1', email: 'guest@example.test', name: 'Guest' },
            tenant: { id: 'tenant-1', slug: 'acme' },
          },
        });
      },
    },
  };

  return { sessions, state, prisma };
});

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ isMultiTenantEnabled: () => true }),
}));

vi.mock('./emailLoader.js', () => ({ sendIfAvailable: vi.fn() }));

import { hashSessionToken, validateSessionToken } from './api/utils/sessionAuth.js';
import { clearSessionCache } from './api/utils/sessionCache.js';
import { registerGuestRoutes } from './api/routes/guests.js';
import type { PrismaClient } from './generated/prisma/index.js';

const prisma = db.prisma as unknown as PrismaClient;

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  registerGuestRoutes(app, prisma);
  return app;
}

/** Read the raw `auth_token` value out of the Set-Cookie header, or null. */
function readAuthCookie(res: request.Response): string | null {
  const raw = res.headers['set-cookie'];
  const cookies: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = cookies.find((c) => c.startsWith('auth_token='));
  if (!hit) return null;
  const value = hit.split(';')[0].slice('auth_token='.length);
  return value.length > 0 ? decodeURIComponent(value) : null;
}

beforeEach(() => {
  db.sessions.length = 0;
  db.state.failNextCreate = false;
  db.state.validTokenHash = crypto.createHash('sha256').update(RAW_GUEST_TOKEN).digest('hex');
  db.state.guestTokenExpiresAt = new Date(Date.now() + 60_000);
  db.state.membershipExpiresAt = new Date(Date.now() + 60_000);
  clearSessionCache();
  vi.clearAllMocks();
});

describe('POST /auth/guest — session establishment', () => {
  it('writes a session row and hands out a cookie that actually authenticates', async () => {
    const res = await request(makeApp()).post('/auth/guest').send({ token: RAW_GUEST_TOKEN });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(GUEST_USER.id);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].userId).toBe(GUEST_USER.id);

    // The cookie is worthless unless it resolves against the row. This is the
    // call the world join makes.
    const cookie = readAuthCookie(res);
    expect(cookie).not.toBeNull();
    expect(db.sessions[0].tokenHash).toBe(hashSessionToken(cookie as string));

    clearSessionCache(); // force the DB path, not the cache establishSession warmed
    const auth = await validateSessionToken(prisma, cookie as string);
    expect(auth).not.toBeNull();
    expect(auth?.userId).toBe(GUEST_USER.id);
    expect(auth?.tenantId).toBe(TENANT.id);
  });

  it('fails the login when the session row cannot be written — no cookie, no 200', async () => {
    // The regression guard. The old code answered 200 here and set the cookie
    // anyway, leaving the guest locked out behind a valid-looking login.
    db.state.failNextCreate = true;

    const res = await request(makeApp()).post('/auth/guest').send({ token: RAW_GUEST_TOKEN });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'login failed' });
    expect(readAuthCookie(res)).toBeNull();
    expect(db.sessions).toHaveLength(0);
  });

  it('gives two logins in the same second two separately revocable sessions', async () => {
    // Without the `jti` establishSession adds, both JWTs are byte-identical
    // (`iat` has second resolution) and collide on Session.tokenHash's unique
    // constraint.
    const app = makeApp();
    const first = await request(app).post('/auth/guest').send({ token: RAW_GUEST_TOKEN });
    const second = await request(app).post('/auth/guest').send({ token: RAW_GUEST_TOKEN });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.sessions).toHaveLength(2);
    expect(db.sessions[0].tokenHash).not.toBe(db.sessions[1].tokenHash);
    expect(readAuthCookie(first)).not.toBe(readAuthCookie(second));
  });

  it('does not establish a session for an unknown token', async () => {
    const res = await request(makeApp())
      .post('/auth/guest')
      .send({ token: 'a'.repeat(64) });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'invalid_token' });
    expect(db.sessions).toHaveLength(0);
    expect(readAuthCookie(res)).toBeNull();
  });
});
