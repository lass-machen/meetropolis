/**
 * Guest revocation must survive the session cache.
 *
 * Authentication resolves a token against its `Session` row through a
 * short-lived in-process cache (api/utils/sessionCache.ts). Three paths end a
 * guest's sessions — the admin revoke route, the REST guest-expiry middleware
 * and the room sweep — and each of them used to delete the rows with a raw
 * `prisma.session.deleteMany`, leaving the resolved session in the cache. The
 * consequence was not merely a stale REST answer: the Colyseus world join
 * (rooms/lifecycle/onAuth.ts) authenticates through the very same
 * `validateSessionToken`, so a guest whose access had just been revoked could
 * still enter the world — presence, camera, microphone — for up to
 * SESSION_CACHE_TTL_MS.
 *
 * Every test therefore asserts against `validateSessionToken` — the function
 * the world join calls — with real timers and no TTL advance: revocation has to
 * bite NOW, not in 30 seconds.
 *
 * The admin revocation is covered against a real database in
 * api/routes/guestRevocation.integration.test.ts.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const SECRET = 'guest-revocation-test-secret';
const TENANT: Tenant = {
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme',
  concurrentLimit: 50,
  freeSeats: 3,
  bypassLimits: false,
  isInternal: false,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  defaultMapName: 'office',
  publicRegistrationEnabled: true,
};
const GUEST_USER = 'guest-user-1';
const ADMIN_USER = 'admin-user-1';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'guest-revocation-test-secret';
  process.env.NODE_ENV = 'test';
});

/**
 * In-memory Prisma double, built before the imports below.
 *
 * It has to exist that early — and stay the same instance — because
 * api/middleware/guestExpiry.ts calls `createPrismaClient()` at module scope
 * and holds on to the result. `beforeEach` therefore resets the tables in
 * place instead of handing out a fresh double.
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
  interface MembershipRow {
    id: string;
    tenantId: string;
    userId: string;
    role: string;
    expiresAt: Date | null;
  }

  const sessions: SessionRow[] = [];
  const memberships: MembershipRow[] = [];

  const matches = (row: MembershipRow, where: Record<string, any>): boolean => {
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (typeof where.tenantId === 'string' && row.tenantId !== where.tenantId) return false;
    if (typeof where.userId === 'string' && row.userId !== where.userId) return false;
    if (Array.isArray(where.userId?.in) && !where.userId.in.includes(row.userId)) return false;
    if (typeof where.role === 'string' && row.role !== where.role) return false;
    if (where.expiresAt?.lt) {
      if (!row.expiresAt || row.expiresAt.getTime() >= where.expiresAt.lt.getTime()) return false;
    }
    const compound = where.tenantId_userId;
    if (compound && (row.tenantId !== compound.tenantId || row.userId !== compound.userId)) return false;
    return true;
  };

  const removeWhere = <T>(rows: T[], pred: (row: T) => boolean): number => {
    let removed = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (pred(rows[i])) {
        rows.splice(i, 1);
        removed++;
      }
    }
    return removed;
  };

  const prisma = {
    session: {
      findUnique: ({ where }: any) => Promise.resolve(sessions.find((r) => r.tokenHash === where.tokenHash) ?? null),
      findMany: ({ where }: any) =>
        Promise.resolve(
          sessions.filter((r) => {
            if (Array.isArray(where?.id?.in) && !where.id.in.includes(r.id)) return false;
            if (where?.expiresAt?.gt && !(r.expiresAt.getTime() > where.expiresAt.gt.getTime())) return false;
            return true;
          }),
        ),
      update: ({ where, data }: any) => {
        const row = sessions.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row ?? null);
      },
      deleteMany: ({ where }: any) =>
        Promise.resolve({ count: removeWhere(sessions, (r) => r.userId === where.userId) }),
    },
    membership: {
      findUnique: ({ where }: any) => Promise.resolve(memberships.find((m) => matches(m, where)) ?? null),
      findFirst: ({ where }: any) => Promise.resolve(memberships.find((m) => matches(m, where)) ?? null),
      findMany: ({ where }: any) => Promise.resolve(memberships.filter((m) => matches(m, where))),
      delete: ({ where }: any) => {
        removeWhere(memberships, (m) => m.id === where.id);
        return Promise.resolve({});
      },
    },
    guestToken: { deleteMany: () => Promise.resolve({ count: 0 }) },
    tenant: { findUnique: () => Promise.resolve({ id: 'tenant-1', slug: 'acme', name: 'Acme' }) },
  };

  return { sessions, memberships, prisma };
});

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('./db.js', () => ({ createPrismaClient: () => db.prisma }));

// Guest admin routes are enterprise-gated; the OSS loader resolves to null.
vi.mock('./tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ isMultiTenantEnabled: () => true }),
}));

// The invite mail is fire-and-forget and irrelevant here.
vi.mock('./emailLoader.js', () => ({ sendIfAvailable: vi.fn() }));

import { hashSessionToken, validateSessionToken } from './api/utils/sessionAuth.js';
import { clearSessionCache, getCachedSession } from './api/utils/sessionCache.js';
import { setAuthResolution } from './api/utils/authState.js';
import { guestExpiryMiddleware } from './api/middleware/guestExpiry.js';
import { startGuestExpiryInterval } from './rooms/lifecycle/guestExpiry.js';
import { createWorldAccess } from './rooms/lifecycle/worldAccess.js';
import type { WorldRoom } from './rooms/WorldRoom.js';
import type { PrismaClient, Tenant } from './generated/prisma/index.js';

const prisma = db.prisma as unknown as PrismaClient;

/** Seed a live session row for `userId` and return its raw token. */
function seedSession(userId: string): string {
  const token = jwt.sign({ sub: userId, tid: TENANT.id, jti: `${Math.random()}` }, SECRET);
  db.sessions.push({
    id: `sess-${db.sessions.length + 1}`,
    userId,
    tokenHash: hashSessionToken(token),
    userAgent: null,
    ipAddress: null,
    expiresAt: new Date(Date.now() + 60_000),
    lastActiveAt: new Date(),
  });
  return token;
}

/**
 * Resolve the token once so the cache holds it — the precondition that made the
 * bug reachable. A test that skipped this would pass against the broken code.
 */
async function warmCache(token: string): Promise<void> {
  await expect(validateSessionToken(prisma, token)).resolves.not.toBeNull();
  expect(getCachedSession(hashSessionToken(token))).not.toBeNull();
}

beforeEach(() => {
  db.sessions.length = 0;
  db.memberships.length = 0;
  db.memberships.push(
    { id: 'm-guest', tenantId: TENANT.id, userId: GUEST_USER, role: 'guest', expiresAt: new Date(Date.now() + 60_000) },
    { id: 'm-admin', tenantId: TENANT.id, userId: ADMIN_USER, role: 'admin', expiresAt: null },
  );
  clearSessionCache();
  vi.clearAllMocks();
});

describe('guestExpiryMiddleware (REST)', () => {
  function makeApp(): express.Application {
    const app = express();
    app.use((req, _res, next) => {
      req.tenant = TENANT;
      setAuthResolution(req, {
        auth: { userId: GUEST_USER, tenantId: TENANT.id, sessionId: 'guest-sess', tokenHash: 'guest-hash' },
      });
      next();
    });
    app.use(guestExpiryMiddleware);
    app.get('/probe', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('an expired guest is locked out immediately, cache included', async () => {
    const token = seedSession(GUEST_USER);
    await warmCache(token);
    db.memberships[0].expiresAt = new Date(Date.now() - 1_000);

    const res = await request(makeApp()).get('/probe');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'guest_expired' });

    expect(getCachedSession(hashSessionToken(token))).toBeNull();
    await expect(validateSessionToken(prisma, token)).resolves.toBeNull();
  });

  it('lets a guest whose membership is still valid through untouched', async () => {
    const token = seedSession(GUEST_USER);
    await warmCache(token);

    const res = await request(makeApp()).get('/probe');
    expect(res.status).toBe(200);

    await expect(validateSessionToken(prisma, token)).resolves.not.toBeNull();
  });
});

describe('room guest-expiry sweep', () => {
  /** Database session row id behind a seeded token, as onAuth would store it. */
  function sessionRowId(token: string): string {
    const row = db.sessions.find((s) => s.tokenHash === hashSessionToken(token));
    if (!row) throw new Error('test setup: session row missing');
    return row.id;
  }

  function makeRoom(
    players: Map<string, { identity: string }>,
    clients: unknown[],
    sessionIds: Map<string, string>,
  ): WorldRoom {
    // The sweep reads each session's verified tenant from the registry, never
    // the room slug: every player here was verified for this tenant at join time.
    // The bundled session check needs each entry's database session row, as a
    // real join via onAuth would store it.
    const room = {
      metadata: { tenant: TENANT.slug },
      prismaForPresence: prisma,
      state: { players },
      clients,
    } as unknown as WorldRoom;
    room.worldAccess = createWorldAccess(room);
    for (const [sessionId, player] of players) {
      const rowId = sessionIds.get(sessionId);
      room.worldAccess.register(sessionId, {
        identity: player.identity,
        tenantId: TENANT.id,
        tenantSlug: TENANT.slug,
        sessionId: rowId ?? null,
        authSessionId: rowId,
        isNpc: false,
        zonePrivacyVersion: 1,
      });
    }
    return room;
  }

  /**
   * Fire the 60s interval WITHOUT moving the clock: only the timer functions
   * are faked. Advancing `Date.now()` by 60s instead would expire the 30s cache
   * entry all by itself, and the test would pass against the broken code too.
   */
  async function runOneSweep(room: WorldRoom): Promise<void> {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const interval = startGuestExpiryInterval(room);
      await vi.advanceTimersByTimeAsync(60_000);
      clearInterval(interval);
    } finally {
      vi.useRealTimers();
    }
    // The interval body is detached (`void (async () => …)()`); let it settle.
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('an expired guest swept from the room cannot re-authenticate with the same token', async () => {
    const token = seedSession(GUEST_USER);
    await warmCache(token);
    db.memberships[0].expiresAt = new Date(Date.now() - 1_000);

    const leave = vi.fn();
    const error = vi.fn();
    const players = new Map([['sess-a', { identity: GUEST_USER }]]);
    const sessionIds = new Map([['sess-a', sessionRowId(token)]]);
    await runOneSweep(makeRoom(players, [{ sessionId: 'sess-a', leave, error }], sessionIds));

    // Kicked from the room …
    expect(error).toHaveBeenCalledWith(4006, 'guest_expired');
    expect(leave).toHaveBeenCalled();
    // … and, the point of the fix, unable to walk straight back in.
    expect(db.sessions.filter((s) => s.userId === GUEST_USER)).toHaveLength(0);
    expect(getCachedSession(hashSessionToken(token))).toBeNull();
    await expect(validateSessionToken(prisma, token)).resolves.toBeNull();
  });

  it('does not touch a guest whose membership is still valid', async () => {
    const token = seedSession(GUEST_USER);
    await warmCache(token);

    const leave = vi.fn();
    const players = new Map([['sess-a', { identity: GUEST_USER }]]);
    const sessionIds = new Map([['sess-a', sessionRowId(token)]]);
    await runOneSweep(makeRoom(players, [{ sessionId: 'sess-a', leave, error: vi.fn() }], sessionIds));

    expect(leave).not.toHaveBeenCalled();
    await expect(validateSessionToken(prisma, token)).resolves.not.toBeNull();
  });
});
