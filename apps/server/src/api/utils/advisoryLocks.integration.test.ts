/**
 * Exercises pg_advisory_xact_lock helpers against a real PostgreSQL database.
 * Locks are transaction-scoped; contention is observed via pg_locks.
 */

import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { acquireMapAdvisoryLock, acquireMapAdvisoryLocks, acquirePackAdvisoryLocks } from './advisoryLocks.js';

if (!process.env.DATABASE_URL) {
  throw new Error('advisoryLocks.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();

const TX_OPTS = { timeout: 15_000, maxWait: 15_000 } as const;

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function countWaitingAdvisoryLocks(): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.locktype = 'advisory'
      AND NOT l.granted
      AND a.datname = current_database()
  `);
  return rows[0]?.n ?? 0;
}

async function waitForWaitingAdvisoryLock(minCount = 1, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await countWaitingAdvisoryLocks()) >= minCount) return;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${minCount} waiting advisory lock(s)`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('advisoryLocks', () => {
  it('serializes two transactions on the same map lock', async () => {
    const mapId = crypto.randomUUID();
    const hold = createDeferred();
    let bAcquired = false;

    const txA = prisma.$transaction(async (tx) => {
      await acquireMapAdvisoryLock(tx, mapId);
      await hold.promise;
    }, TX_OPTS);

    // Give A a moment to acquire before B starts competing.
    await new Promise((r) => setTimeout(r, 100));

    const txB = prisma.$transaction(async (tx) => {
      await acquireMapAdvisoryLock(tx, mapId);
      bAcquired = true;
    }, TX_OPTS);

    try {
      await waitForWaitingAdvisoryLock(1);
      expect(bAcquired).toBe(false);
    } finally {
      hold.resolve();
    }

    await Promise.all([txA, txB]);
    expect(bAcquired).toBe(true);
  }, 20_000);

  it('does not block on a different map id', async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const hold = createDeferred();
    let bDone = false;

    const txA = prisma.$transaction(async (tx) => {
      await acquireMapAdvisoryLock(tx, id1);
      await hold.promise;
    }, TX_OPTS);

    await new Promise((r) => setTimeout(r, 100));

    try {
      await prisma.$transaction(async (tx) => {
        await acquireMapAdvisoryLock(tx, id2);
        bDone = true;
      }, TX_OPTS);
      expect(bDone).toBe(true);
    } finally {
      hold.resolve();
      await txA;
    }
  }, 20_000);

  it('releases the lock when the transaction rolls back', async () => {
    const mapId = crypto.randomUUID();

    await expect(
      prisma.$transaction(async (tx) => {
        await acquireMapAdvisoryLock(tx, mapId);
        throw new Error('forced rollback');
      }, TX_OPTS),
    ).rejects.toThrow('forced rollback');

    let acquired = false;
    await prisma.$transaction(async (tx) => {
      await acquireMapAdvisoryLock(tx, mapId);
      expect(await countWaitingAdvisoryLocks()).toBe(0);
      acquired = true;
    }, TX_OPTS);
    expect(acquired).toBe(true);
  }, 20_000);

  it('acquires several map and pack locks in any input order without deadlock', async () => {
    const pairs = Array.from({ length: 5 }, () => ({
      m1: crypto.randomUUID(),
      m2: crypto.randomUUID(),
      p1: crypto.randomUUID(),
      p2: crypto.randomUUID(),
    }));

    await Promise.all(
      pairs.flatMap(({ m1, m2, p1, p2 }) => [
        prisma.$transaction(async (tx) => {
          await acquireMapAdvisoryLocks(tx, [m2, m1]);
          await acquirePackAdvisoryLocks(tx, [p2, p1]);
        }, TX_OPTS),
        prisma.$transaction(async (tx) => {
          await acquireMapAdvisoryLocks(tx, [m1, m2]);
          await acquirePackAdvisoryLocks(tx, [p1, p2]);
        }, TX_OPTS),
      ]),
    );
  }, 20_000);
});
