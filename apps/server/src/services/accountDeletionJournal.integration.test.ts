import crypto from 'crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import type { Role } from '../generated/prisma/index.js';
import { deleteAccount, removeMemberFromTenant } from './accountDeletion.js';
import {
  AccountDeletionJournalUnavailableError,
  completeAccountJournalInTx,
  createAccountJournalPlanResolver,
  registerAccountDeletionJournal,
  writeAccountJournalInTx,
} from './accountDeletionJournal.js';
import { runDeletionTasksOnce, undecidedIntentAbortAfterMs } from './tenantDeletionPlanning.js';
import type { RestorePendingMarker } from './tenantDeletionRestoreMarker.js';
import { RESTORE_PENDING_FILE, clearRestorePending } from './tenantDeletionRestoreMarker.js';
import type { JournalEntry } from './tenantDeletionJournal.js';
import { JOURNAL_FILE, decideJournalIntents, loadJournal } from './tenantDeletionJournal.js';

/**
 * Account journal of deleteAccount and removeMemberFromTenant against a REAL PostgreSQL
 * database. Each test writes its journal into a fresh temporary directory; the database
 * side is read from the DeletionJournal and DeletionTask rows that reference the account.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('accountDeletionJournal.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const journalKeys: string[] = [];
let journalDir = '';

/** Registers the account resolver for the test journal directory. */
function registerTestJournal(): void {
  registerAccountDeletionJournal(
    createAccountJournalPlanResolver({ prisma, journalDir, retentionDays: '7', maxCopyLifetimeDays: '14' }),
  );
}

async function createTenant(): Promise<string> {
  const slug = `account-journal-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(): Promise<string> {
  const email = `account-journal-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email } });
  userIds.push(user.id);
  return user.id;
}

/** Custom avatar row without a sprite file: the journal and its file task need only the uuid. */
async function createCustomAvatar(userId: string): Promise<string> {
  const uuid = crypto.randomUUID();
  const spriteUrl = `/packs/avatars/custom/${uuid}.png`;
  await prisma.customAvatar.create({
    data: { uuid, userId, config: {}, spriteUrl, configHash: 'account-journal-test' },
  });
  return uuid;
}

async function createMembership(userId: string, tenantId: string, role: Role): Promise<void> {
  await prisma.membership.create({ data: { userId, tenantId, role } });
}

/** Entries of the test journal from the public loader, which also verifies the hash chain. */
async function readJournalEntries(): Promise<JournalEntry[]> {
  const journal = await loadJournal(journalDir);
  expect(journal).not.toBeNull();
  return journal?.entries ?? [];
}

/** Raw journal file content; empty when no entry was written. */
async function readJournalText(): Promise<string> {
  try {
    return await readFile(path.join(journalDir, JOURNAL_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

/** DeletionJournal rows whose account references contain the user. */
async function findAccountJournalRows(userId: string) {
  return prisma.deletionJournal.findMany({ where: { accountRefs: { has: userId } } });
}

/** DeletionTask rows of the account journals that contain the user. */
async function findAccountTaskRows(userId: string) {
  return prisma.deletionTask.findMany({ where: { journal: { accountRefs: { has: userId } } } });
}

/** Every entry of an account deletion names the account and no tenant; all entries share one key. */
function expectAccountEntries(entries: JournalEntry[], userId: string): void {
  for (const entry of entries) {
    expect(entry.tenantRef).toBe('');
    expect(entry.accountRef).toBe(userId);
  }
  expect(new Set(entries.map((entry) => entry.key)).size).toBe(1);
}

/** The single account row of a user with the given journal key and status. */
async function expectAccountRow(userId: string, key: string | undefined, status: string): Promise<void> {
  const rows = await findAccountJournalRows(userId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    scope: 'account',
    tenantRef: null,
    accountRefs: [userId],
    idempotencyKey: key,
    status,
  });
  expect(rows[0]?.dbDeletedAt).toBeInstanceOf(Date);
}

async function expectUserGone(userId: string): Promise<void> {
  expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
}

/** Deletion with a custom avatar: intent and commit, one pending file task, completion waits for the task. */
async function expectAvatarDeletion(userId: string, avatarUuid: string): Promise<void> {
  const entries = await readJournalEntries();
  expect(entries.map((entry) => entry.type)).toEqual(['intent', 'commit']);
  expectAccountEntries(entries, userId);
  await expectAccountRow(userId, entries[0]?.key, 'cleanup_pending');
  const tasks = await findAccountTaskRows(userId);
  expect(tasks).toHaveLength(1);
  expect(tasks[0]).toMatchObject({ kind: 'file', targetSystem: 'custom_avatars', objectId: avatarUuid });
  await expectUserGone(userId);
}

/** Deletion without a custom avatar: intent, commit and completed, no file task. */
async function expectPlainDeletion(userId: string): Promise<void> {
  const entries = await readJournalEntries();
  expect(entries.map((entry) => entry.type)).toEqual(['intent', 'commit', 'completed']);
  expectAccountEntries(entries, userId);
  await expectAccountRow(userId, entries[0]?.key, 'completed');
  const [row] = await findAccountJournalRows(userId);
  expect(row?.completedAt).toBeInstanceOf(Date);
  expect(await findAccountTaskRows(userId)).toHaveLength(0);
  await expectUserGone(userId);
}

/** Filter for the journal rows this file creates: by account reference, or by the key of a blocked intent. */
function journalOwnerFilter() {
  const owners = [
    ...(userIds.length > 0 ? [{ accountRefs: { hasSome: userIds } }] : []),
    ...(journalKeys.length > 0 ? [{ idempotencyKey: { in: journalKeys } }] : []),
  ];
  return owners.length > 0 ? { OR: owners } : undefined;
}

/** Makes the deletion of exactly this user fail with a database exception until the trigger is dropped. */
async function createBlockingUserTrigger(userId: string): Promise<void> {
  await dropBlockingUserTrigger();
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION account_journal_test_block_user_delete() RETURNS trigger AS $$
    BEGIN
      IF OLD.id = '${userId}' THEN RAISE EXCEPTION 'account journal test: user deletion blocked'; END IF;
      RETURN OLD;
    END $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER account_journal_test_block_user_delete BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION account_journal_test_block_user_delete()',
  );
}

async function dropBlockingUserTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS account_journal_test_block_user_delete ON "User"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS account_journal_test_block_user_delete()');
}

/**
 * Plans an account deletion, removes the user and writes the rows in one transaction, without a commit
 * entry: the state of a deletion whose commit was never recorded. Returns the journal key.
 */
async function openAccountIntent(userId: string, avatarUuid: string | null): Promise<string> {
  const key = await prisma.$transaction(async (tx) => {
    const resolve = createAccountJournalPlanResolver({
      prisma,
      journalDir,
      retentionDays: '7',
      maxCopyLifetimeDays: '14',
    });
    const plan = await resolve(tx, userId);
    if (plan === undefined) throw new Error('account journal plan unavailable');
    const journalId = await writeAccountJournalInTx(tx, plan, userId, avatarUuid);
    await tx.user.delete({ where: { id: userId } });
    await completeAccountJournalInTx(tx, journalId);
    return plan.key;
  });
  journalKeys.push(key);
  return key;
}

/** One pass of the production deletion worker over the test journal. */
function runWorkerPass() {
  return runDeletionTasksOnce({
    prisma,
    journalDir,
    now: new Date(),
    maxCopyLifetimeDays: '14',
    retentionDays: '7',
  });
}

/** Passes per test: the worker takes at most 100 due tasks per pass, oldest first, in a shared database. */
const WORKER_PASS_LIMIT = 20;

/** Runs the production worker until `reached` holds, for at most WORKER_PASS_LIMIT passes. */
async function runWorkerUntil(reached: () => Promise<boolean>): Promise<void> {
  for (let pass = 0; pass < WORKER_PASS_LIMIT; pass += 1) {
    if (await reached()) return;
    await runWorkerPass();
  }
}

/** True once the test journal holds an entry of the given type under the key. */
async function journalHasEntry(key: string, type: string): Promise<boolean> {
  return typesOf(await readJournalEntries(), key).includes(type);
}

/** True once the DeletionJournal row under the key has the given status. */
async function rowHasStatus(key: string, status: string): Promise<boolean> {
  return (await findRowsByKey(key)).some((row) => row.status === status);
}

/** Keys of all entries in the test journal, read without assertions so that cleanup can use them. */
async function journalKeysOf(): Promise<string[]> {
  const journal = await loadJournal(journalDir);
  return journal?.entries.map((entry) => entry.key) ?? [];
}

/** deleteAccount must reject with the unavailable error of the account journal. */
async function expectDeletionRefused(userId: string): Promise<void> {
  const failure = await deleteAccount(prisma, userId).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(AccountDeletionJournalUnavailableError);
  expect(failure).toMatchObject({ code: 'account_deletion_journal_unavailable' });
}

/** The user and its membership in the tenant still exist. */
async function expectAccountKept(userId: string, tenantId: string): Promise<void> {
  expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
  expect(await prisma.membership.count({ where: { userId, tenantId } })).toBe(1);
}

/** Entry types of one key, in journal order. */
function typesOf(entries: JournalEntry[], key: string): string[] {
  return entries.filter((entry) => entry.key === key).map((entry) => entry.type);
}

/** Key of the first journal entry, the intent of the deletion under test. */
function keyOfFirstEntry(entries: JournalEntry[]): string {
  const key = entries[0]?.key;
  if (key === undefined) throw new Error('journal holds no entry');
  return key;
}

/** DeletionJournal rows under one idempotency key. */
async function findRowsByKey(key: string) {
  return prisma.deletionJournal.findMany({ where: { idempotencyKey: key } });
}

/**
 * Runs the work with ASSET_PACKS_DIR and NPC_MEDIA_DIR each set to a fresh directory. Both variables and
 * both directories are restored afterwards, even when the work fails.
 */
async function withTemporaryFileDirs(work: () => Promise<void>): Promise<void> {
  const packsDir = await mkdtemp(path.join(os.tmpdir(), 'account-journal-packs-'));
  const npcMediaDir = await mkdtemp(path.join(os.tmpdir(), 'account-journal-npc-'));
  const previousPacksDir = process.env.ASSET_PACKS_DIR;
  const previousNpcMediaDir = process.env.NPC_MEDIA_DIR;
  process.env.ASSET_PACKS_DIR = packsDir;
  process.env.NPC_MEDIA_DIR = npcMediaDir;
  try {
    await work();
  } finally {
    if (previousPacksDir === undefined) delete process.env.ASSET_PACKS_DIR;
    else process.env.ASSET_PACKS_DIR = previousPacksDir;
    if (previousNpcMediaDir === undefined) delete process.env.NPC_MEDIA_DIR;
    else process.env.NPC_MEDIA_DIR = previousNpcMediaDir;
    await rm(packsDir, { recursive: true, force: true });
    await rm(npcMediaDir, { recursive: true, force: true });
  }
}

describe('account deletion journal (real database)', () => {
  beforeEach(async () => {
    journalDir = await mkdtemp(path.join(os.tmpdir(), 'account-journal-test-'));
  });

  afterEach(async () => {
    registerAccountDeletionJournal(undefined);
    await rm(journalDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    try {
      const journalOwners = journalOwnerFilter();
      if (journalOwners !== undefined) {
        await prisma.deletionTask.deleteMany({ where: { journal: journalOwners } });
        await prisma.deletionJournal.deleteMany({ where: journalOwners });
      }
      if (userIds.length > 0) {
        await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (tenantIds.length > 0) {
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('journals an account deletion with a custom avatar and leaves its file task pending', async () => {
    registerTestJournal();
    const userId = await createUser();
    const avatarUuid = await createCustomAvatar(userId);

    await deleteAccount(prisma, userId);

    await expectAvatarDeletion(userId, avatarUuid);
  });

  it('journals an account deletion without a custom avatar and completes it at once', async () => {
    registerTestJournal();
    const userId = await createUser();

    await deleteAccount(prisma, userId);

    await expectPlainDeletion(userId);
  });

  it('writes no journal entry while the removed member keeps another membership', async () => {
    registerTestJournal();
    const removedTenantId = await createTenant();
    const keptTenantId = await createTenant();
    const userId = await createUser();
    await createMembership(userId, removedTenantId, 'member');
    await createMembership(userId, keptTenantId, 'member');

    const result = await removeMemberFromTenant(prisma, { userId, tenantId: removedTenantId });

    expect(result).toEqual({ accountDeleted: false });
    expect(await readJournalText()).toBe('');
    expect(await findAccountJournalRows(userId)).toHaveLength(0);
    const memberships = await prisma.membership.findMany({ where: { userId }, select: { tenantId: true } });
    expect(memberships).toEqual([{ tenantId: keptTenantId }]);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
  });

  it.each<{ role: Role; withAvatar: boolean }>([
    { role: 'member', withAvatar: true },
    { role: 'guest', withAvatar: false },
  ])('removes the last membership of a $role user (avatar $withAvatar)', async ({ role, withAvatar }) => {
    registerTestJournal();
    const tenantId = await createTenant();
    const userId = await createUser();
    await createMembership(userId, tenantId, role);
    const avatarUuid = withAvatar ? await createCustomAvatar(userId) : null;

    const result = await removeMemberFromTenant(prisma, { userId, tenantId });

    expect(result).toEqual({ accountDeleted: true });
    if (avatarUuid === null) {
      await expectPlainDeletion(userId);
    } else {
      await expectAvatarDeletion(userId, avatarUuid);
    }
  });

  it('deletes an account unjournaled when no journal is registered', async () => {
    registerAccountDeletionJournal(undefined);
    const userId = await createUser();
    const avatarUuid = await createCustomAvatar(userId);

    await deleteAccount(prisma, userId);

    expect(await readdir(journalDir)).toEqual([]);
    expect(await findAccountJournalRows(userId)).toHaveLength(0);
    expect(await prisma.deletionTask.count({ where: { objectId: avatarUuid } })).toBe(0);
    await expectUserGone(userId);
  });

  it('blocks the intent key when the user row cannot be deleted', async () => {
    registerTestJournal();
    const userId = await createUser();
    try {
      await createBlockingUserTrigger(userId);
      await expect(deleteAccount(prisma, userId)).rejects.toThrow('account journal test: user deletion blocked');
    } finally {
      await dropBlockingUserTrigger();
      journalKeys.push(...(await journalKeysOf()));
    }

    const entries = await readJournalEntries();
    expect(entries.map((entry) => entry.type)).toEqual(['intent', 'abort']);
    expectAccountEntries(entries, userId);
    const key = keyOfFirstEntry(entries);
    const rows = await findRowsByKey(key);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ idempotencyKey: key, status: 'blocked', tenantRef: null });
    expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
  });

  it('refuses the deletion and keeps a damaged journal file unchanged', async () => {
    registerTestJournal();
    const tenantId = await createTenant();
    const userId = await createUser();
    await createMembership(userId, tenantId, 'member');
    const journalPath = path.join(journalDir, JOURNAL_FILE);
    await writeFile(journalPath, 'damaged line without JSON\n');
    const before = await readFile(journalPath);

    await expectDeletionRefused(userId);

    expect(await readFile(journalPath)).toEqual(before);
    expect(await findAccountJournalRows(userId)).toHaveLength(0);
    await expectAccountKept(userId, tenantId);
  });

  it('refuses the deletion while a restore marker is present and clears it afterwards', async () => {
    registerTestJournal();
    const tenantId = await createTenant();
    const userId = await createUser();
    await createMembership(userId, tenantId, 'member');
    const markerPath = path.join(journalDir, RESTORE_PENDING_FILE);
    const marker: RestorePendingMarker = {
      v: 1,
      createdAt: '2026-11-12T00:00:00.000Z',
      copyCreatedAt: null,
      journalSeq: null,
    };
    await writeFile(markerPath, JSON.stringify(marker));
    const before = await readFile(markerPath);

    await expectDeletionRefused(userId);

    expect(await readdir(journalDir)).toEqual([RESTORE_PENDING_FILE]);
    expect(await readFile(markerPath)).toEqual(before);
    await expectAccountKept(userId, tenantId);
    await clearRestorePending(journalDir);
    expect(await readdir(journalDir)).toEqual([]);
  });

  it('commits an open account intent whose database deletion is recorded', async () => {
    const userId = await createUser();
    const key = await openAccountIntent(userId, null);

    const counts = await decideJournalIntents({
      prisma,
      journalDir,
      now: new Date(),
      abortAfterMs: undecidedIntentAbortAfterMs(),
    });

    expect(counts).toEqual({ committed: 1, aborted: 0, open: 0 });
    const entries = await readJournalEntries();
    expect(entries.map((entry) => entry.type)).toEqual(['intent', 'commit']);
    expect(entries[1]).toMatchObject({ key, tenantRef: '', accountRef: userId });
    await expectUserGone(userId);
  });

  it('completes an account journal without tasks only after its minimum age', async () => {
    await withTemporaryFileDirs(async () => {
      const userId = await createUser();
      const key = await openAccountIntent(userId, null);

      await runWorkerUntil(() => journalHasEntry(key, 'commit'));
      expect(typesOf(await readJournalEntries(), key)).toEqual(['intent', 'commit']);
      expect(await findRowsByKey(key)).toMatchObject([{ status: 'cleanup_pending' }]);

      // The age is set directly in the database; the clock is not overridden.
      await prisma.deletionJournal.update({
        where: { idempotencyKey: key },
        data: { dbDeletedAt: new Date('2000-01-01T00:00:00Z') },
      });
      await runWorkerUntil(() => rowHasStatus(key, 'completed'));

      const entries = await readJournalEntries();
      expect(typesOf(entries, key)).toEqual(['intent', 'commit', 'completed']);
      expect(entries.find((entry) => entry.key === key && entry.type === 'completed')).toMatchObject({
        tenantRef: '',
        accountRef: userId,
      });
      expect(await findRowsByKey(key)).toMatchObject([{ status: 'completed' }]);
    });
  });

  it('completes an account journal once its avatar file task is done', async () => {
    await withTemporaryFileDirs(async () => {
      registerTestJournal();
      const userId = await createUser();
      const avatarUuid = await createCustomAvatar(userId);
      await deleteAccount(prisma, userId);
      await expectAvatarDeletion(userId, avatarUuid);
      const key = keyOfFirstEntry(await readJournalEntries());

      await runWorkerUntil(() => rowHasStatus(key, 'completed'));

      const entries = await readJournalEntries();
      expect(typesOf(entries, key)).toEqual(['intent', 'commit', 'completed']);
      expect(entries.find((entry) => entry.key === key && entry.type === 'completed')).toMatchObject({
        tenantRef: '',
        accountRef: userId,
      });
      expect(await findRowsByKey(key)).toMatchObject([{ status: 'completed' }]);
      expect(await findAccountTaskRows(userId)).toMatchObject([
        { targetSystem: 'custom_avatars', objectId: avatarUuid, status: 'done' },
      ]);
    });
  });
});
