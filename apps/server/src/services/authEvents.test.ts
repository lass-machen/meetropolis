/**
 * Unit tests for the auth-event service: the email HMAC, the retention
 * cutoff, the never-throw recording path and the login last-login updates.
 * Runs without a database; the Prisma surface is a test double.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'auth-event-test-secret';
  process.env.NODE_ENV = 'test';
});

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  AUTH_EVENT_RETENTION_DAYS,
  authEventEmailHmac,
  purgeExpiredAuthEvents,
  recordAuthEvent,
} from './authEvents.js';
import { avSessionRef } from '../rooms/lifecycle/avSessionRef.js';
import { logger } from '../logger.js';
import type { PrismaClient } from '../generated/prisma/index.js';

interface AuthEventRow {
  type: string;
  success: boolean;
  userId: string | null;
  tenantId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  emailHmac: string | null;
  createdAt: Date;
}

let rows: AuthEventRow[];
let userUpdates: Array<{ where: { id: string }; data: { lastLoginAt: Date } }>;
let membershipUpdates: Array<{
  where: { userId: string; tenantId: string };
  data: { lastLoginAt: Date };
}>;

function makePrisma(): PrismaClient {
  return {
    authEvent: {
      create: vi.fn(({ data }: { data: AuthEventRow }) => {
        rows.push({ ...data });
        return Promise.resolve({ ...data, id: `event-${rows.length}` });
      }),
      deleteMany: vi.fn(({ where }: { where: { createdAt: { lt: Date } } }) => {
        const before = rows.length;
        rows = rows.filter((row) => !(row.createdAt < where.createdAt.lt));
        return Promise.resolve({ count: before - rows.length });
      }),
    },
    user: {
      update: vi.fn(({ where, data }: { where: { id: string }; data: { lastLoginAt: Date } }) => {
        userUpdates.push({ where, data });
        return Promise.resolve({ id: where.id, ...data });
      }),
    },
    membership: {
      updateMany: vi.fn(
        ({ where, data }: { where: { userId: string; tenantId: string }; data: { lastLoginAt: Date } }) => {
          membershipUpdates.push({ where, data });
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
  } as unknown as PrismaClient;
}

function makeReq(): { headers: { 'user-agent': string }; ip: string } {
  return { headers: { 'user-agent': 'vitest-agent' }, ip: '10.0.0.9' };
}

beforeEach(() => {
  rows = [];
  userUpdates = [];
  membershipUpdates = [];
  vi.clearAllMocks();
});

describe('authEventEmailHmac', () => {
  it('is deterministic for the same address', () => {
    expect(authEventEmailHmac('user@example.com')).toBe(authEventEmailHmac('user@example.com'));
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(authEventEmailHmac('  User@Example.COM ')).toBe(authEventEmailHmac('user@example.com'));
  });

  it('never equals the plain address and uses a fixed digest length', () => {
    const hmac = authEventEmailHmac('user@example.com');
    expect(hmac).not.toContain('user@example.com');
    expect(hmac).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('uses a different key context than the session reference', () => {
    const hmac = authEventEmailHmac('user@example.com');
    const sessionDigest = avSessionRef('user@example.com').split('.')[1];
    expect(hmac).not.toBe(sessionDigest);
  });
});

describe('purgeExpiredAuthEvents', () => {
  it('keeps the retention window at 30 days', () => {
    expect(AUTH_EVENT_RETENTION_DAYS).toBe(30);
  });

  it('deletes only entries older than 30 days and returns their count', async () => {
    const prisma = makePrisma();
    const now = new Date('2026-11-16T12:00:00.000Z');
    rows = [
      {
        type: 'login',
        success: false,
        userId: null,
        tenantId: null,
        ipAddress: null,
        userAgent: null,
        emailHmac: 'old',
        createdAt: new Date('2026-10-16T11:59:59.000Z'),
      },
      {
        type: 'login',
        success: false,
        userId: null,
        tenantId: null,
        ipAddress: null,
        userAgent: null,
        emailHmac: 'fresh',
        createdAt: new Date('2026-10-17T12:00:01.000Z'),
      },
    ];

    const count = await purgeExpiredAuthEvents(prisma, now);

    expect(count).toBe(1);
    expect(rows.map((row) => row.emailHmac)).toEqual(['fresh']);
    expect(prisma.authEvent.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: new Date('2026-10-17T12:00:00.000Z') } },
    });
  });
});

describe('recordAuthEvent', () => {
  it('stores the email digest only for a failed attempt without a user', async () => {
    const prisma = makePrisma();

    await recordAuthEvent(prisma, {
      type: 'login',
      success: false,
      email: '  Unknown@Example.com ',
      req: makeReq() as never,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'login',
      success: false,
      userId: null,
      ipAddress: '10.0.0.9',
      userAgent: 'vitest-agent',
      emailHmac: authEventEmailHmac('unknown@example.com'),
    });
  });

  it('stores no digest when the failed attempt already names a user', async () => {
    const prisma = makePrisma();

    await recordAuthEvent(prisma, {
      type: 'login',
      success: false,
      userId: 'user-1',
      email: 'user@example.com',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].emailHmac).toBeNull();
  });

  it('stores no digest on success, even with an email given', async () => {
    const prisma = makePrisma();

    await recordAuthEvent(prisma, {
      type: 'login',
      success: true,
      userId: 'user-1',
      email: 'user@example.com',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].emailHmac).toBeNull();
  });

  it('updates user and membership login times in one transaction on login success', async () => {
    const prisma = makePrisma();

    await recordAuthEvent(prisma, {
      type: 'login',
      success: true,
      userId: 'user-1',
      tenantId: 'tenant-1',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].where).toEqual({ id: 'user-1' });
    expect(membershipUpdates).toHaveLength(1);
    expect(membershipUpdates[0].where).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
    const stamp = rows[0].createdAt.getTime();
    expect(userUpdates[0].data.lastLoginAt.getTime()).toBe(stamp);
    expect(membershipUpdates[0].data.lastLoginAt.getTime()).toBe(stamp);
  });

  it('skips the membership update when no tenant is given', async () => {
    const prisma = makePrisma();

    await recordAuthEvent(prisma, { type: 'logout', success: true, userId: 'user-1' });
    await recordAuthEvent(prisma, { type: 'login', success: true, userId: 'user-1' });

    expect(membershipUpdates).toHaveLength(0);
    expect(userUpdates).toHaveLength(1);
  });

  it('never throws and logs only the failure kind', async () => {
    const prisma = makePrisma();
    (prisma.authEvent.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TypeError('connection reset by secret-token'),
    );

    await expect(
      recordAuthEvent(prisma, {
        type: 'login',
        success: false,
        email: 'user@example.com',
        req: makeReq() as never,
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const logged = (logger.warn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(logged).toMatchObject({ event: 'auth.event.record_failed', type: 'login', errorName: 'TypeError' });
    expect(JSON.stringify(logged)).not.toContain('user@example.com');
    expect(JSON.stringify(logged)).not.toContain('10.0.0.9');
  });

  it('swallows a failed login transaction as well', async () => {
    const prisma = makePrisma();
    (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db_down'));

    await expect(
      recordAuthEvent(prisma, { type: 'login', success: true, userId: 'user-1', tenantId: 'tenant-1' }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
