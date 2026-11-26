import crypto from 'crypto';
import { mkdtemp, readFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { deleteAccount } from './accountDeletion.js';
import type { AccountJournalResolver } from './accountDeletionJournal.js';
import { createAccountJournalPlanResolver, registerAccountDeletionJournal } from './accountDeletionJournal.js';
import type { JournalEntry } from './tenantDeletionJournal.js';
import { JOURNAL_FILE, loadJournal } from './tenantDeletionJournal.js';
import type {
  ReplayCommittedDeletionsOptions,
  ReplayCommittedDeletionsResult,
  ReplayDecision,
} from './tenantDeletionReplay.js';
import { replayCommittedDeletions } from './tenantDeletionReplay.js';

/**
 * Restore replay of account deletions against a REAL PostgreSQL database. A restored copy brings an
 * account back under its old id after its deletion was journaled; the replay deletes it again through
 * the account deletion path. Each test journals into a fresh temporary directory.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('accountDeletionReplay.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let journalDir = '';
/** Creation time of the simulated restored copy; every commit of a test happens after it. */
let copyTakenAt = new Date();

interface TestUser {
  id: string;
  email: string;
}

/** An account deleted through the registered journal, with the journal key of that deletion. */
interface JournaledAccount {
  user: TestUser;
  key: string;
}

/** The real account deletion, plus a record of the user ids it was called with. */
interface CountingDeletion {
  calls: string[];
  remove: (userId: string) => Promise<void>;
}

interface ReplayRun {
  deleteAccount?: (userId: string) => Promise<void>;
  decisions?: ReadonlyMap<string, ReplayDecision>;
}

/** Thrown inside a transaction to leave it without a commit. */
class AbandonedTransaction extends Error {
  constructor() {
    super('transaction left without commit');
    this.name = 'AbandonedTransaction';
  }
}

/** The account resolver as the deletion tool registers it for the test journal directory. */
function accountPlanResolver(): AccountJournalResolver {
  return createAccountJournalPlanResolver({
    prisma,
    journalDir,
    retentionDays: '7',
    maxCopyLifetimeDays: '14',
    allowDuringRestoreReplay: true,
  });
}

/** No test in this file expects a tenant deletion, so the callback fails if one is attempted. */
function refuseTenantDeletion(): Promise<void> {
  return Promise.reject(new Error('tenant deletion is not expected in this test'));
}

async function createTenant(): Promise<string> {
  const slug = `account-replay-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(): Promise<TestUser> {
  const email = `account-replay-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email } });
  userIds.push(user.id);
  return { id: user.id, email };
}

/** Brings the user back under the same id and email, as a restored copy does. */
async function restoreUser(user: TestUser): Promise<void> {
  await prisma.user.create({ data: { id: user.id, email: user.email } });
}

async function makeOwner(userId: string, tenantId: string): Promise<void> {
  await prisma.membership.create({ data: { userId, tenantId, role: 'owner' } });
}

/** Custom avatar row without a sprite file; the file task needs only the uuid. */
async function createCustomAvatar(userId: string): Promise<string> {
  const uuid = crypto.randomUUID();
  const spriteUrl = `/packs/avatars/custom/${uuid}.png`;
  await prisma.customAvatar.create({
    data: { uuid, userId, config: {}, spriteUrl, configHash: 'account-replay-test' },
  });
  return uuid;
}

/** Entries of the test journal from the public loader, which also verifies the hash chain. */
async function readJournalEntries(): Promise<JournalEntry[]> {
  const journal = await loadJournal(journalDir);
  expect(journal).not.toBeNull();
  return journal?.entries ?? [];
}

/** Sequence number of the last journal entry; entries written later carry a higher one. */
async function journalSeq(): Promise<number> {
  const journal = await loadJournal(journalDir);
  expect(journal).not.toBeNull();
  return journal?.checkpoint.seq ?? 0;
}

async function readJournalText(): Promise<string> {
  return readFile(path.join(journalDir, JOURNAL_FILE), 'utf8');
}

/** Entry types written under one journal key, in journal order. */
async function typesOf(key: string): Promise<string[]> {
  const entries = await readJournalEntries();
  return entries.filter((entry) => entry.key === key).map((entry) => entry.type);
}

async function expectUserExists(userId: string): Promise<void> {
  expect(await prisma.user.count({ where: { id: userId } })).toBe(1);
}

async function expectUserGone(userId: string): Promise<void> {
  expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
}

/**
 * Deletes an account with a custom avatar through the registered journal. The deletion leaves an intent
 * and a commit, plus a database row and a file task that wait for completion.
 */
async function deleteJournaledAccount(): Promise<JournaledAccount> {
  const user = await createUser();
  const avatarUuid = await createCustomAvatar(user.id);
  await deleteAccount(prisma, user.id);
  const entries = await readJournalEntries();
  expect(entries.map((entry) => entry.type)).toEqual(['intent', 'commit']);
  const key = entries[0]?.key ?? '';
  const rows = await prisma.deletionJournal.findMany({ where: { idempotencyKey: key } });
  expect(rows).toMatchObject([{ scope: 'account', status: 'cleanup_pending' }]);
  const tasks = await prisma.deletionTask.findMany({ where: { journal: { idempotencyKey: key } } });
  expect(tasks).toMatchObject([{ kind: 'file', targetSystem: 'custom_avatars', objectId: avatarUuid }]);
  return { user, key };
}

/**
 * The restored copy predates the deletion, so it has neither the database row of that deletion nor
 * its file task. Both are removed for the journal key.
 */
async function dropDeletionRecord(key: string): Promise<void> {
  await prisma.deletionTask.deleteMany({ where: { journal: { idempotencyKey: key } } });
  await prisma.deletionJournal.deleteMany({ where: { idempotencyKey: key } });
}

function countingAccountDeletion(): CountingDeletion {
  const calls: string[] = [];
  return {
    calls,
    remove: async (userId) => {
      calls.push(userId);
      await deleteAccount(prisma, userId);
    },
  };
}

/** Runs the replay after the restore; open intents up to the current journal sequence are the old timeline. */
async function replayRestoredJournal(run: ReplayRun): Promise<ReplayCommittedDeletionsResult> {
  const options: ReplayCommittedDeletionsOptions = {
    prisma,
    journalDir,
    since: copyTakenAt,
    deleteTenant: refuseTenantDeletion,
    restoredJournalSeq: await journalSeq(),
  };
  if (run.deleteAccount !== undefined) options.deleteAccount = run.deleteAccount;
  if (run.decisions !== undefined) options.decisions = run.decisions;
  return replayCommittedDeletions(options);
}

/**
 * Writes an account intent through the resolver inside a database transaction that is never committed.
 * The intent stays open in the journal, and the database holds no row for it.
 */
async function openIntentWithoutCommit(userId: string): Promise<string> {
  const resolver = accountPlanResolver();
  let key = '';
  try {
    await prisma.$transaction(async (tx) => {
      const plan = await resolver(tx, userId);
      if (plan === undefined) throw new Error('account intent was not planned');
      key = plan.key;
      throw new AbandonedTransaction();
    });
  } catch (error) {
    if (!(error instanceof AbandonedTransaction)) throw error;
  }
  return key;
}

/** Leaves an open intent of the old timeline in place and checks that it blocks the replay. */
async function expectOpenIntentBlocks(user: TestUser, deleter: CountingDeletion): Promise<string> {
  const key = await openIntentWithoutCommit(user.id);
  expect(await prisma.deletionJournal.count({ where: { accountRefs: { has: user.id } } })).toBe(0);
  const before = await readJournalText();

  const result = await replayRestoredJournal({ deleteAccount: deleter.remove });

  expect(result.blocked).toBe('undecided_intent');
  expect(result.undecided).toEqual([
    expect.objectContaining({ key, tenantRef: '', accountRef: user.id, tenantExists: false, accountExists: true }),
  ]);
  expect(deleter.calls).toEqual([]);
  expect(await readJournalText()).toBe(before);
  await expectUserExists(user.id);
  return key;
}

beforeEach(async () => {
  journalDir = await mkdtemp(path.join(os.tmpdir(), 'account-replay-test-'));
  copyTakenAt = new Date();
  registerAccountDeletionJournal(accountPlanResolver());
});

afterEach(async () => {
  registerAccountDeletionJournal(undefined);
  await rm(journalDir, { recursive: true, force: true });
});

afterAll(async () => {
  try {
    if (userIds.length > 0) {
      await prisma.deletionTask.deleteMany({ where: { journal: { accountRefs: { hasSome: userIds } } } });
      await prisma.deletionJournal.deleteMany({ where: { accountRefs: { hasSome: userIds } } });
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

it('replays a committed account deletion after the restore and closes its old key', async () => {
  const account = await deleteJournaledAccount();
  await dropDeletionRecord(account.key);
  await restoreUser(account.user);
  const seqBefore = await journalSeq();
  const deleter = countingAccountDeletion();

  const result = await replayRestoredJournal({ deleteAccount: deleter.remove });

  expect(result).toEqual({
    blocked: null,
    replayed: [],
    undecided: [],
    closed: [],
    replayedAccounts: [account.user.id],
    closedAccounts: [account.key],
    ownerlessTenants: [],
  });
  expect(deleter.calls).toEqual([account.user.id]);
  await expectUserGone(account.user.id);
  const added = (await readJournalEntries()).filter((entry) => entry.seq > seqBefore);
  expect(added.map((entry) => entry.type)).toEqual(['intent', 'commit', 'completed', 'completed']);
  expect(added.slice(-1)).toMatchObject([{ key: account.key, type: 'completed', accountRef: account.user.id }]);
  expect(await typesOf(account.key)).toEqual(['intent', 'commit', 'completed']);
});

it('closes the old key of an account that no longer exists without deleting anything', async () => {
  const account = await deleteJournaledAccount();
  await dropDeletionRecord(account.key);
  const deleter = countingAccountDeletion();

  const result = await replayRestoredJournal({ deleteAccount: deleter.remove });

  expect(result).toMatchObject({ blocked: null, replayedAccounts: [], closedAccounts: [account.key] });
  expect(deleter.calls).toEqual([]);
  expect(await typesOf(account.key)).toEqual(['intent', 'commit', 'completed']);
  await expectUserGone(account.user.id);
});

it('deletes the account of an open intent once the operator decides to delete it', async () => {
  const user = await createUser();
  const deleter = countingAccountDeletion();
  const key = await expectOpenIntentBlocks(user, deleter);

  const result = await replayRestoredJournal({
    deleteAccount: deleter.remove,
    decisions: new Map<string, ReplayDecision>([[key, 'delete']]),
  });

  expect(result).toMatchObject({ blocked: null, replayedAccounts: [user.id], closedAccounts: [key] });
  expect(deleter.calls).toEqual([user.id]);
  expect(await typesOf(key)).toEqual(['intent', 'commit', 'completed']);
  await expectUserGone(user.id);
});

it('keeps the account of an open intent once the operator decides to keep it', async () => {
  const user = await createUser();
  const deleter = countingAccountDeletion();
  const key = await expectOpenIntentBlocks(user, deleter);

  const result = await replayRestoredJournal({
    deleteAccount: deleter.remove,
    decisions: new Map<string, ReplayDecision>([[key, 'keep']]),
  });

  expect(result).toMatchObject({ blocked: null, replayedAccounts: [], closedAccounts: [] });
  expect(deleter.calls).toEqual([]);
  expect(await typesOf(key)).toEqual(['intent', 'abort']);
  await expectUserExists(user.id);
});

it('reports the tenants that lost their only owner through a replayed account deletion', async () => {
  const soleOwnerTenant = await createTenant();
  const sharedTenant = await createTenant();
  const coOwner = await createUser();
  const account = await deleteJournaledAccount();
  await dropDeletionRecord(account.key);
  await restoreUser(account.user);
  await makeOwner(account.user.id, soleOwnerTenant);
  await makeOwner(account.user.id, sharedTenant);
  await makeOwner(coOwner.id, sharedTenant);
  const deleter = countingAccountDeletion();

  const result = await replayRestoredJournal({ deleteAccount: deleter.remove });

  expect(result).toMatchObject({
    blocked: null,
    replayedAccounts: [account.user.id],
    closedAccounts: [account.key],
    ownerlessTenants: [soleOwnerTenant],
  });
  await expectUserGone(account.user.id);
  expect(await prisma.membership.count({ where: { tenantId: sharedTenant, role: 'owner' } })).toBe(1);
  expect(await prisma.tenant.count({ where: { id: { in: [soleOwnerTenant, sharedTenant] } } })).toBe(2);
});

it('ignores committed account deletions when the replay has no deletion callback', async () => {
  const tenantId = await createTenant();
  const account = await deleteJournaledAccount();
  await dropDeletionRecord(account.key);
  await restoreUser(account.user);
  await makeOwner(account.user.id, tenantId);
  const before = await readJournalText();

  const result = await replayRestoredJournal({});

  expect(result).toEqual({
    blocked: null,
    replayed: [],
    undecided: [],
    closed: [],
    replayedAccounts: [],
    closedAccounts: [],
    ownerlessTenants: [],
  });
  expect(await readJournalText()).toBe(before);
  await expectUserExists(account.user.id);
  expect(await prisma.membership.count({ where: { userId: account.user.id, tenantId, role: 'owner' } })).toBe(1);
  expect(await prisma.tenant.count({ where: { id: tenantId } })).toBe(1);
});
