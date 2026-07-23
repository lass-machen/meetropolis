/**
 * Unit tests for the session-auth core: the middleware that makes the Session
 * row the authority for a request, the establishment path every login must go
 * through, and the cache that keeps the added lookup off the hot path without
 * letting a revoked token survive it.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'session-auth-test-secret';
  process.env.NODE_ENV = 'test';
});

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  createSessionAuthMiddleware,
  establishSession,
  hashSessionToken,
  validateSessionToken,
  revokeSessionById,
  revokeSessionsForUser,
  revokeSessionByToken,
} from './sessionAuth.js';
import { requireAuth } from './authHelpers.js';
import {
  clearSessionCache,
  getCachedSession,
  setCachedSession,
  sessionCacheSize,
  SESSION_CACHE_TTL_MS,
} from './sessionCache.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const SECRET = 'session-auth-test-secret';

interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  lastActiveAt: Date;
}

let rows: SessionRow[];
let findUnique: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;

function makePrisma(): PrismaClient {
  findUnique = vi.fn(({ where }: { where: { tokenHash?: string; id?: string } }) => {
    const row = rows.find((r) => (where.tokenHash ? r.tokenHash === where.tokenHash : r.id === where.id));
    return Promise.resolve(row ? { ...row } : null);
  });
  update = vi.fn(({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
    const row = rows.find((r) => r.id === where.id);
    if (!row) return Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' }));
    Object.assign(row, data);
    return Promise.resolve({ ...row });
  });
  return {
    session: {
      findUnique,
      update,
      create: vi.fn(({ data }: { data: Omit<SessionRow, 'id' | 'lastActiveAt'> }) => {
        const row: SessionRow = { id: `sess-${rows.length + 1}`, lastActiveAt: new Date(), ...data };
        rows.push(row);
        return Promise.resolve({ id: row.id });
      }),
      delete: vi.fn(({ where }: { where: { id: string } }) => {
        rows = rows.filter((r) => r.id !== where.id);
        return Promise.resolve({});
      }),
      deleteMany: vi.fn(({ where }: { where: { userId?: string; tokenHash?: unknown } }) => {
        const notHash = (where.tokenHash as { not?: string } | undefined)?.not;
        const eqHash = typeof where.tokenHash === 'string' ? where.tokenHash : undefined;
        const before = rows.length;
        rows = rows.filter((r) => {
          if (where.userId && r.userId !== where.userId) return true;
          if (eqHash && r.tokenHash !== eqHash) return true;
          if (notHash && r.tokenHash === notHash) return true;
          return false;
        });
        return Promise.resolve({ count: before - rows.length });
      }),
    },
  } as unknown as PrismaClient;
}

/** Seed a live session for `userId` and return its raw token. */
function seedSession(userId: string, overrides: Partial<SessionRow> = {}): string {
  const token = jwt.sign({ sub: userId, tid: 'tenant-1', jti: `${Math.random()}` }, SECRET);
  rows.push({
    id: `sess-${rows.length + 1}`,
    userId,
    tokenHash: hashSessionToken(token),
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastActiveAt: new Date(),
    ...overrides,
  });
  return token;
}

/** An app whose single route echoes what requireAuth makes of the request. */
function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(createSessionAuthMiddleware(prisma));
  app.get('/probe', (req, res) => {
    const auth = requireAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json(auth);
  });
  return app;
}

beforeEach(() => {
  rows = [];
  clearSessionCache();
});

describe('createSessionAuthMiddleware', () => {
  it('authenticates a token whose session row is live', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');

    const res = await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  it('refuses a valid, unexpired JWT whose session row is gone', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    rows = [];

    const res = await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses a token whose session row has expired', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1', { expiresAt: new Date(Date.now() - 1000) });

    const res = await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(401);
  });

  it('accepts the same token as a Bearer header', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');

    const res = await request(makeApp(prisma)).get('/probe').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('does not touch the database for an anonymous request', async () => {
    const prisma = makePrisma();

    await request(makeApp(prisma)).get('/probe').expect(401);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('does not touch the database for a forged token', async () => {
    const prisma = makePrisma();
    const forged = jwt.sign({ sub: 'user-1' }, 'not-our-secret');

    await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${forged}`).expect(401);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('leaves an API token (non-JWT bearer) to its own guard', async () => {
    const prisma = makePrisma();

    // Opaque API tokens are not JWTs; the middleware must not authenticate
    // them, and must not blow up on them either (requireApiToken handles them).
    await request(makeApp(prisma)).get('/probe').set('Authorization', 'Bearer opaque-api-token').expect(401);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when the session lookup throws', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    findUnique.mockRejectedValueOnce(new Error('db_down'));

    const res = await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(401);
  });

  it('refuses when the row belongs to a different user than the token claims', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    rows[0].userId = 'someone-else';

    const res = await request(makeApp(prisma)).get('/probe').set('Cookie', `auth_token=${token}`);

    expect(res.status).toBe(401);
  });
});

describe('session cache', () => {
  it('serves repeat requests without re-reading the row', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    const app = makeApp(prisma);

    await request(app).get('/probe').set('Cookie', `auth_token=${token}`).expect(200);
    await request(app).get('/probe').set('Cookie', `auth_token=${token}`).expect(200);
    await request(app).get('/probe').set('Cookie', `auth_token=${token}`).expect(200);

    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('stops serving an entry once the TTL is up', () => {
    const auth = { userId: 'u', tenantId: 't', sessionId: 's', tokenHash: 'h' };
    const now = Date.now();

    setCachedSession(auth, new Date(now + 60_000), now);

    expect(getCachedSession('h', now + SESSION_CACHE_TTL_MS - 1)).toEqual(auth);
    expect(getCachedSession('h', now + SESSION_CACHE_TTL_MS)).toBeNull();
  });

  it('stops serving an entry whose session expired inside the TTL window', () => {
    const auth = { userId: 'u', tenantId: 't', sessionId: 's', tokenHash: 'h' };
    const now = Date.now();

    // Session outlives the cache entry by 1s: the row's expiry still wins.
    setCachedSession(auth, new Date(now + 1_000), now);

    expect(getCachedSession('h', now + 999)).toEqual(auth);
    expect(getCachedSession('h', now + 1_001)).toBeNull();
  });

  it('drops a revoked session from the cache immediately', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    const app = makeApp(prisma);
    await request(app).get('/probe').set('Cookie', `auth_token=${token}`).expect(200);
    expect(sessionCacheSize()).toBe(1);

    await revokeSessionById(prisma, 'user-1', rows[0].id);

    // Not merely evicted — the next request must actually be refused, well
    // inside the cache TTL.
    expect(sessionCacheSize()).toBe(0);
    await request(app).get('/probe').set('Cookie', `auth_token=${token}`).expect(401);
  });

  it('drops every cached session of a user on a bulk revoke', async () => {
    const prisma = makePrisma();
    const a = seedSession('user-1');
    const b = seedSession('user-1');
    const other = seedSession('user-2');
    const app = makeApp(prisma);
    for (const t of [a, b, other]) await request(app).get('/probe').set('Cookie', `auth_token=${t}`).expect(200);
    expect(sessionCacheSize()).toBe(3);

    await revokeSessionsForUser(prisma, 'user-1');

    await request(app).get('/probe').set('Cookie', `auth_token=${a}`).expect(401);
    await request(app).get('/probe').set('Cookie', `auth_token=${b}`).expect(401);
    await request(app).get('/probe').set('Cookie', `auth_token=${other}`).expect(200);
  });
});

describe('establishSession', () => {
  function makeRes() {
    const cookies: Array<{ name: string; value: string; options: unknown }> = [];
    return {
      cookies,
      res: { cookie: (name: string, value: string, options: unknown) => cookies.push({ name, value, options }) },
    };
  }
  const req = { headers: { 'user-agent': 'vitest' }, ip: '10.0.0.1' } as unknown as express.Request;

  it('writes the session row and sets the cookie for the same token', async () => {
    const prisma = makePrisma();
    const { res, cookies } = makeRes();

    const out = await establishSession({
      prisma,
      req,
      res: res as unknown as express.Response,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'user-1', tokenHash: hashSessionToken(out.token), userAgent: 'vitest' });
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ name: 'auth_token', value: out.token });
  });

  it('sets no cookie when the row cannot be written', async () => {
    const prisma = makePrisma();
    (prisma.session.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db_down'));
    const { res, cookies } = makeRes();

    await expect(
      establishSession({
        prisma,
        req,
        res: res as unknown as express.Response,
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    ).rejects.toThrow('db_down');

    expect(cookies).toHaveLength(0);
  });

  it('mints a distinct token per call, even within the same second', async () => {
    const prisma = makePrisma();
    const { res } = makeRes();
    const call = () =>
      establishSession({
        prisma,
        req,
        res: res as unknown as express.Response,
        userId: 'user-1',
        tenantId: 'tenant-1',
      });

    const [a, b] = await Promise.all([call(), call()]);

    expect(a.token).not.toBe(b.token);
    expect(rows).toHaveLength(2);
  });

  it('makes the established session usable straight away', async () => {
    const prisma = makePrisma();
    const { res } = makeRes();

    const out = await establishSession({
      prisma,
      req,
      res: res as unknown as express.Response,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(await validateSessionToken(prisma, out.token)).toMatchObject({ userId: 'user-1', tenantId: 'tenant-1' });
  });
});

describe('revocation helpers', () => {
  it('revokeSessionById refuses a session of another user', async () => {
    const prisma = makePrisma();
    seedSession('victim');

    await expect(revokeSessionById(prisma, 'mallory', rows[0].id)).resolves.toBe(false);
    expect(rows).toHaveLength(1);
  });

  it('revokeSessionsForUser can spare the caller', async () => {
    const prisma = makePrisma();
    const keep = seedSession('user-1');
    seedSession('user-1');
    seedSession('user-1');

    const count = await revokeSessionsForUser(prisma, 'user-1', { exceptTokenHash: hashSessionToken(keep) });

    expect(count).toBe(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashSessionToken(keep));
  });

  it('revokeSessionByToken removes exactly the one session', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1');
    seedSession('user-1');

    await revokeSessionByToken(prisma, token);

    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(hashSessionToken(token));
  });
});

describe('lastActiveAt', () => {
  it('refreshes a stale timestamp on a cache miss', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1', { lastActiveAt: new Date(Date.now() - 10 * 60 * 1000) });

    await validateSessionToken(prisma, token);
    await new Promise((resolve) => setImmediate(resolve));

    expect(update).toHaveBeenCalledTimes(1);
    expect(Date.now() - rows[0].lastActiveAt.getTime()).toBeLessThan(1000);
  });

  it('does not write on every request', async () => {
    const prisma = makePrisma();
    const token = seedSession('user-1', { lastActiveAt: new Date() });

    await validateSessionToken(prisma, token);
    await new Promise((resolve) => setImmediate(resolve));

    expect(update).not.toHaveBeenCalled();
  });
});
