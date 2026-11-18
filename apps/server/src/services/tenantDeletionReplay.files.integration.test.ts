import crypto from 'crypto';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { deleteTenantWithMembers } from './accountDeletion.js';
import { TENANT_DELETION_PROTOCOL, assertTenantDeletionProtocol } from './tenantDeletionContract.js';
import type { JournalResolvePlan } from './tenantDeletionPlanning.js';
import { createJournalPlanResolver } from './tenantDeletionPlanning.js';
import { appendJournalEntry, loadJournal } from './tenantDeletionJournal.js';
import type { ReplayCommittedDeletionsResult } from './tenantDeletionReplay.js';
import { replayCommittedDeletions } from './tenantDeletionReplay.js';

/**
 * Restore replay of tenant deletions against a REAL PostgreSQL database. A restored copy brings a
 * tenant back under its old id after its deletion was journaled; the replay deletes it again through
 * the tenant deletion path and writes the file tasks of that deletion. A second replay right after
 * must not delete again and must not write another set of file tasks. Each test journals into a
 * fresh temporary directory.
 */

if (!process.env.DATABASE_URL) {
  throw new Error(
    'tenantDeletionReplay.files.integration.test.ts needs DATABASE_URL pointing at a migrated test database',
  );
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let journalDir = '';
/** Creation time of the simulated restored copy; the journaled commit of a test happens after it. */
let copyCreatedAt = new Date();

interface RestoredTenant {
  tenantId: string;
  slug: string;
  assetPackUuid: string;
  avatarPackUuid: string;
  customAvatarUuid: string;
  /** Journal key of the deletion that the restored copy predates. */
  oldKey: string;
}

/** The real tenant deletion, plus a record of the tenant ids it was called with. */
interface CountingDeletion {
  calls: string[];
  remove: (tenantId: string) => Promise<void>;
}

interface FileTaskShape {
  kind: string;
  targetSystem: string;
  objectId: string;
  storageKey: string | null;
}

/** Sequence number of the last journal entry; entries written later carry a higher one. */
async function journalSeq(): Promise<number> {
  const journal = await loadJournal(journalDir);
  expect(journal).not.toBeNull();
  return journal?.checkpoint.seq ?? 0;
}

/**
 * The managed tenant deletion wired like the replay script, but without the enterprise module:
 * deleteTenantWithMembers directly, with a journal plan resolver that may run during a replay.
 */
function countingTenantDeletion(): CountingDeletion {
  const calls: string[] = [];
  let resolver: JournalResolvePlan | undefined;
  return {
    calls,
    remove: async (tenantId) => {
      calls.push(tenantId);
      resolver ??= await createJournalPlanResolver({
        prisma,
        journalDir,
        retentionDays: '7',
        maxCopyLifetimeDays: '14',
        allowDuringRestoreReplay: true,
      });
      const planResolver = resolver;
      await deleteTenantWithMembers(prisma, tenantId, {
        deletionProtocol: TENANT_DELETION_PROTOCOL,
        prepareInTx: async (tx, context) => {
          assertTenantDeletionProtocol(context.deletionProtocol);
          return planResolver(tx, { tenantId, transactionTime: context.transactionTime });
        },
        cleanupInTx: () => Promise.resolve(),
      });
    },
  };
}

/** One tenant with one asset pack, one avatar pack and one custom avatar, all tenant-owned. */
async function createTenantWithPacks(): Promise<Omit<RestoredTenant, 'oldKey'>> {
  const slug = `tenant-replay-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  const user = await prisma.user.create({ data: { email: `tenant-replay-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  const assetPackUuid = crypto.randomUUID();
  await prisma.assetPack.create({
    data: {
      uuid: assetPackUuid,
      tenantId: tenant.id,
      name: slug,
      description: slug,
      author: 'tenant-replay-test',
      version: '1',
      terrain: {},
      structures: {},
      objects: {},
    },
  });
  const avatarPackUuid = crypto.randomUUID();
  await prisma.avatarPack.create({
    data: {
      uuid: avatarPackUuid,
      tenantId: tenant.id,
      name: slug,
      description: slug,
      author: 'tenant-replay-test',
      version: '1',
      avatars: [],
    },
  });
  const customAvatarUuid = crypto.randomUUID();
  await prisma.customAvatar.create({
    data: {
      uuid: customAvatarUuid,
      userId: user.id,
      tenantId: tenant.id,
      config: {},
      spriteUrl: `/packs/avatars/custom/${customAvatarUuid}.png`,
      configHash: 'tenant-replay-test',
    },
  });
  return { tenantId: tenant.id, slug, assetPackUuid, avatarPackUuid, customAvatarUuid };
}

/**
 * Journals the committed deletion of the tenant after the copy was taken, as the original
 * deletion before the restore did. The restored database holds no deletion row for that key.
 */
async function journalCommittedDeletion(tenantId: string): Promise<string> {
  const key = crypto.randomUUID();
  const at = new Date().toISOString();
  const journalUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  await appendJournalEntry(journalDir, { type: 'intent', key, tenantRef: tenantId, at, journalUntil });
  await appendJournalEntry(journalDir, { type: 'commit', key, tenantRef: tenantId, at });
  return key;
}

async function seedRestoredTenant(): Promise<RestoredTenant> {
  const seeded = await createTenantWithPacks();
  const oldKey = await journalCommittedDeletion(seeded.tenantId);
  return { ...seeded, oldKey };
}

/** Runs the replay after the restore; open intents up to the current journal sequence are the old timeline. */
async function replayRestoredJournal(deleter: CountingDeletion): Promise<ReplayCommittedDeletionsResult> {
  return replayCommittedDeletions({
    prisma,
    journalDir,
    since: copyCreatedAt,
    deleteTenant: deleter.remove,
    restoredJournalSeq: await journalSeq(),
  });
}

/** File tasks written for the tenant, in target-system order, reduced to their identifying fields. */
async function fileTasksOf(tenantId: string): Promise<FileTaskShape[]> {
  const tasks = await prisma.deletionTask.findMany({
    where: { journal: { tenantRef: tenantId } },
    orderBy: { targetSystem: 'asc' },
    select: { kind: true, targetSystem: true, objectId: true, storageKey: true },
  });
  return tasks;
}

/** The one set of file tasks a replayed tenant deletion must write, in target-system order. */
function expectedFileTasks(fixture: RestoredTenant): FileTaskShape[] {
  return [
    { kind: 'file', targetSystem: 'asset_packs', objectId: fixture.assetPackUuid, storageKey: null },
    { kind: 'file', targetSystem: 'avatar_packs', objectId: fixture.avatarPackUuid, storageKey: null },
    { kind: 'file', targetSystem: 'custom_avatars', objectId: fixture.customAvatarUuid, storageKey: null },
    { kind: 'file', targetSystem: 'npc_media', objectId: fixture.tenantId, storageKey: fixture.slug },
  ];
}

beforeEach(async () => {
  journalDir = await mkdtemp(path.join(os.tmpdir(), 'tenant-replay-files-test-'));
  copyCreatedAt = new Date(Date.now() - 1000);
});

afterEach(async () => {
  await rm(journalDir, { recursive: true, force: true });
});

afterAll(async () => {
  try {
    if (tenantIds.length > 0) {
      await prisma.deletionTask.deleteMany({ where: { journal: { tenantRef: { in: tenantIds } } } });
      await prisma.deletionJournal.deleteMany({ where: { tenantRef: { in: tenantIds } } });
      await prisma.customAvatar.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.assetPack.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.avatarPack.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    }
    if (userIds.length > 0) {
      await prisma.customAvatar.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

it('replays a committed tenant deletion after the restore and writes exactly one set of file tasks', async () => {
  const fixture = await seedRestoredTenant();
  const deleter = countingTenantDeletion();

  const result = await replayRestoredJournal(deleter);

  expect(result).toMatchObject({ blocked: null, replayed: [fixture.tenantId], closed: [fixture.oldKey] });
  expect(deleter.calls).toEqual([fixture.tenantId]);
  expect(await prisma.tenant.count({ where: { id: fixture.tenantId } })).toBe(0);
  expect(await fileTasksOf(fixture.tenantId)).toEqual(expectedFileTasks(fixture));
});

it('writes no further file tasks and deletes nothing on a second replay right after the first', async () => {
  const fixture = await seedRestoredTenant();
  const deleter = countingTenantDeletion();
  const first = await replayRestoredJournal(deleter);
  expect(first).toMatchObject({ blocked: null, replayed: [fixture.tenantId] });
  const tasksAfterFirst = await fileTasksOf(fixture.tenantId);
  expect(tasksAfterFirst).toEqual(expectedFileTasks(fixture));

  const second = await replayRestoredJournal(deleter);

  expect(second).toMatchObject({ blocked: null, replayed: [] });
  expect(deleter.calls).toEqual([fixture.tenantId]);
  expect(await prisma.tenant.count({ where: { id: fixture.tenantId } })).toBe(0);
  expect(await fileTasksOf(fixture.tenantId)).toEqual(tasksAfterFirst);
});
