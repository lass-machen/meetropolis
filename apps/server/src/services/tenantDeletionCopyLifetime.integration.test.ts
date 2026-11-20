import crypto from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { appendJournalEntry, loadJournal } from './tenantDeletionJournal.js';
import type { JournalEntryType } from './tenantDeletionJournal.js';
import { createJournalPlanResolver, runDeletionTasksOnce } from './tenantDeletionPlanning.js';
import type { RestorePendingMarker } from './tenantDeletionRestoreMarker.js';
import { RESTORE_PENDING_FILE } from './tenantDeletionRestoreMarker.js';

/**
 * Tenant deletion copy lifetime against a REAL PostgreSQL database.
 *
 * The copy lifetime decides the journalUntil of every plan and the compaction
 * boundary of expired completed keys. Each test writes its journal into a
 * fresh temporary directory; database rows are tracked by idempotency key and
 * removed in afterAll.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    'tenantDeletionCopyLifetime.integration.test.ts needs DATABASE_URL pointing at a migrated test database',
  );
}

const DAY_MS = 86_400_000;
const TRANSACTION_TIME = new Date('2026-11-01T00:00:00.000Z');

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const journalKeys: string[] = [];
let journalDir = '';

async function createTenant(): Promise<string> {
  const slug = `copy-lifetime-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

/** Appends the entries of one key through the production writer, in the given order. */
async function appendEntries(
  key: string,
  tenantRef: string,
  types: JournalEntryType[],
  at: string,
  journalUntil: string,
): Promise<void> {
  for (const type of types) {
    await appendJournalEntry(journalDir, {
      type,
      key,
      tenantRef,
      at,
      ...(type === 'intent' ? { journalUntil } : {}),
    });
  }
}

/** A completed tenant key whose lines and database row are `ageDays` old. */
async function createCompletedKey(nowMs: number, ageDays: number): Promise<string> {
  const key = `copy-lifetime-${crypto.randomUUID()}`;
  const tenantRef = `copy-lifetime-tenant-${crypto.randomUUID()}`;
  const at = new Date(nowMs - ageDays * DAY_MS);
  const until = new Date(nowMs + 30 * DAY_MS).toISOString();
  await appendEntries(key, tenantRef, ['intent', 'commit', 'completed'], at.toISOString(), until);
  await prisma.deletionJournal.create({
    data: {
      idempotencyKey: key,
      scope: 'tenant',
      tenantRef,
      policyVersion: 'tenant-deletion-journal-v1',
      requestedAt: at,
      journalUntil: new Date(until),
      status: 'completed',
      completedAt: at,
    },
  });
  journalKeys.push(key);
  return key;
}

/** Keys of all entries in the test journal; empty when nothing was written. */
async function journalKeysOf(): Promise<string[]> {
  const journal = await loadJournal(journalDir);
  return journal?.entries.map((entry) => entry.key) ?? [];
}

/** DeletionJournal rows under one idempotency key. */
async function findRowsByKey(key: string) {
  return prisma.deletionJournal.findMany({ where: { idempotencyKey: key } });
}

describe('deletion journal copy lifetime (real database)', () => {
  beforeEach(async () => {
    journalDir = await mkdtemp(path.join(os.tmpdir(), 'copy-lifetime-test-'));
  });

  afterEach(async () => {
    await rm(journalDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    try {
      if (journalKeys.length > 0) {
        await prisma.deletionTask.deleteMany({
          where: { journal: { idempotencyKey: { in: journalKeys } } },
        });
        await prisma.deletionJournal.deleteMany({ where: { idempotencyKey: { in: journalKeys } } });
      }
      if (tenantIds.length > 0) {
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('sets journalUntil to the transaction time plus the copy lifetime', async () => {
    const tenantId = await createTenant();
    const resolve = await createJournalPlanResolver({
      prisma,
      journalDir,
      retentionDays: '7',
      maxCopyLifetimeDays: '30',
    });

    const plan = await prisma.$transaction((tx) => resolve(tx, { tenantId, transactionTime: TRANSACTION_TIME }));

    expect(plan).toBeDefined();
    expect(plan?.journalUntil).toBeInstanceOf(Date);
    const journalUntilMs = (plan?.journalUntil as Date).getTime();
    expect(journalUntilMs).toBe(TRANSACTION_TIME.getTime() + 30 * DAY_MS);
    const journal = await loadJournal(journalDir);
    const intent = journal?.entries.find((entry) => entry.type === 'intent' && entry.key === plan?.idempotencyKey);
    expect(intent?.journalUntil).toBeDefined();
    expect(new Date(intent?.journalUntil ?? '').getTime()).toBe(journalUntilMs);
  });

  it('resolves to undefined without a copy lifetime and writes no entry', async () => {
    const resolve = await createJournalPlanResolver({
      prisma,
      journalDir,
      retentionDays: '7',
      maxCopyLifetimeDays: undefined,
    });

    const plan = await prisma.$transaction((tx) =>
      resolve(tx, { tenantId: crypto.randomUUID(), transactionTime: TRANSACTION_TIME }),
    );

    expect(plan).toBeUndefined();
    expect(await journalKeysOf()).toHaveLength(0);
  });

  it('resolves to undefined when the lifetime is below retention and writes no entry', async () => {
    const resolve = await createJournalPlanResolver({
      prisma,
      journalDir,
      retentionDays: '7',
      maxCopyLifetimeDays: '6',
    });

    const plan = await prisma.$transaction((tx) =>
      resolve(tx, { tenantId: crypto.randomUUID(), transactionTime: TRANSACTION_TIME }),
    );

    expect(plan).toBeUndefined();
    expect(await journalKeysOf()).toHaveLength(0);
  });

  it('keeps a 20 day old completed key with a 30 day lifetime and removes it with 14 days', async () => {
    const now = new Date();
    const key = await createCompletedKey(now.getTime(), 20);

    await runDeletionTasksOnce({ prisma, journalDir, now, maxCopyLifetimeDays: '30', retentionDays: '7' });

    expect(await journalKeysOf()).toContain(key);
    expect(await findRowsByKey(key)).toHaveLength(1);

    await runDeletionTasksOnce({ prisma, journalDir, now, maxCopyLifetimeDays: '14', retentionDays: '7' });

    expect(await journalKeysOf()).not.toContain(key);
    expect(await findRowsByKey(key)).toHaveLength(0);
  });

  it('keeps a 20 day old completed key when the lifetime is invalid', async () => {
    const now = new Date();
    const key = await createCompletedKey(now.getTime(), 20);

    await runDeletionTasksOnce({ prisma, journalDir, now, maxCopyLifetimeDays: 'abc', retentionDays: '7' });

    expect(await journalKeysOf()).toContain(key);
    expect(await findRowsByKey(key)).toHaveLength(1);
  });

  it('keeps an open cleanup_pending key with a pending task', async () => {
    const now = new Date();
    const key = `copy-lifetime-${crypto.randomUUID()}`;
    const tenantRef = `copy-lifetime-tenant-${crypto.randomUUID()}`;
    const old = new Date(now.getTime() - 40 * DAY_MS);
    await appendEntries(key, tenantRef, ['intent', 'commit'], old.toISOString(), now.toISOString());
    const journal = await prisma.deletionJournal.create({
      data: {
        idempotencyKey: key,
        scope: 'tenant',
        tenantRef,
        policyVersion: 'tenant-deletion-journal-v1',
        requestedAt: old,
        dbDeletedAt: old,
        journalUntil: new Date(now.getTime() + 30 * DAY_MS),
        status: 'cleanup_pending',
      },
    });
    journalKeys.push(key);
    await prisma.deletionTask.create({
      data: {
        journalId: journal.id,
        kind: 'file',
        targetSystem: 'asset_packs',
        objectId: crypto.randomUUID(),
        objectGeneration: '1',
        dedupeKey: `copy-lifetime-${crypto.randomUUID()}`,
        status: 'pending',
        nextAttemptAt: new Date(now.getTime() + 30 * DAY_MS),
      },
    });

    await runDeletionTasksOnce({ prisma, journalDir, now, maxCopyLifetimeDays: '14', retentionDays: '7' });

    expect(await journalKeysOf()).toContain(key);
    expect(await findRowsByKey(key)).toHaveLength(1);
  });

  it('pauses compaction while a restore marker is present', async () => {
    const now = new Date();
    const key = await createCompletedKey(now.getTime(), 20);
    const marker: RestorePendingMarker = {
      v: 1,
      createdAt: '2026-11-12T00:00:00.000Z',
      copyCreatedAt: null,
      journalSeq: null,
    };
    const markerPath = path.join(journalDir, RESTORE_PENDING_FILE);
    await writeFile(markerPath, JSON.stringify(marker));

    await runDeletionTasksOnce({ prisma, journalDir, now, maxCopyLifetimeDays: '14', retentionDays: '7' });

    expect(await journalKeysOf()).toContain(key);
    expect(await findRowsByKey(key)).toHaveLength(1);
    await rm(markerPath, { force: true });
  });
});
