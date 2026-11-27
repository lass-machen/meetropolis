/**
 * Real-database regression: a copy waits for a concurrent copy of the same source.
 *
 * `copyMapToTenant` serializes copies of one source map through a transaction-scoped
 * advisory lock. The waiting copy holds its interactive transaction open while it
 * waits, so the transaction limit has to cover the wait. With the Prisma default of
 * 5 s, a second concurrent copy failed with HTTP 500 as soon as the lock holder took
 * longer than that (template map copies under load in the e2e gate: up to 4.6 s each).
 */
import { randomUUID } from 'crypto';
import { afterAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { acquireMapAdvisoryLock } from '../utils/advisoryLocks.js';
import { copyMapToTenant } from './adminMaps.copy.js';

if (!process.env.DATABASE_URL) {
  throw new Error('adminMaps.copy.lockWait.integration.test.ts requires an isolated migrated DATABASE_URL');
}

const fixture = createHttpFixture();

/** Longer than the Prisma default transaction timeout (5 s). */
const LOCK_HOLD_MS = 6_000;

afterAll(async () => {
  await fixture.close();
});

it('a copy waits for a concurrent holder of the source map lock instead of failing', async () => {
  const source = await fixture.tenant();
  const target = await fixture.tenant();

  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  const holder = fixture.prisma.$transaction(
    async (tx) => {
      await acquireMapAdvisoryLock(tx, source.map.id);
      markHeld();
      await new Promise((resolve) => setTimeout(resolve, LOCK_HOLD_MS));
    },
    { timeout: LOCK_HOLD_MS + 10_000 },
  );
  await held;

  const name = `lock-wait-${randomUUID()}`;
  const copy = await copyMapToTenant(fixture.prisma, source.map.id, target.tenant.id, name);
  await holder;

  expect(copy.name).toBe(name);
  const stored = await fixture.prisma.map.findUnique({ where: { id: copy.id }, select: { tenantId: true } });
  expect(stored?.tenantId).toBe(target.tenant.id);
}, 30_000);
