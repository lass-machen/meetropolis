import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import type { PrismaClient } from '../generated/prisma/index.js';

/**
 * Deletion model tests for the two future tables `DeletionJournal` and
 * `DeletionTask` (see deletion specification, minimal data model). The model layer
 * does not exist yet, so every fixture goes through typed
 * `$queryRaw`/`$executeRaw` against the real PostgreSQL database.
 *
 * Until the schema fix lands, the `to_regclass` existence assertions at
 * the start of each test are the failing (red) assertions. They are
 * plain assertions, not setup errors.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tenantDeletionTasks.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

// Fixed fixture clock. Not a retention rule: `journalUntil` is a
// synthetic schema-test deadline only.
const REQUESTED_AT = new Date('2026-11-07T00:00:00Z');
const JOURNAL_UNTIL = new Date('2026-11-08T00:00:00Z');

const tenantIds: string[] = [];
const userIds: string[] = [];
const journalIds: string[] = [];
const taskIds: string[] = [];

type TablePresence = { rel: string | null };

async function queryTablePresence(prisma: PrismaClient): Promise<TablePresence[]> {
  return prisma.$queryRaw<TablePresence[]>`
    SELECT to_regclass(${'\"DeletionJournal\"'})::text AS "rel"
    UNION ALL
    SELECT to_regclass(${'\"DeletionTask\"'})::text AS "rel"`;
}

async function requireTables(prisma: PrismaClient): Promise<void> {
  const presence = await queryTablePresence(prisma);
  expect(presence).toHaveLength(2);
  expect(presence[0]?.rel).not.toBeNull();
  expect(presence[1]?.rel).not.toBeNull();
}

type JournalRow = {
  id: string;
  idempotencyKey: string;
  scope: string;
  tenantRef: string;
  accountRefs: string[];
  objectRefs: string[];
  policyVersion: string;
  requestedAt: Date;
  journalUntil: Date;
  generation: bigint;
};

type TaskRow = {
  id: string;
  journalId: string;
  kind: string;
  targetSystem: string;
  objectId: string;
  objectGeneration: string;
  storageKey: string;
  dedupeKey: string;
};

async function insertJournal(
  prisma: PrismaClient,
  journal: { id: string; idempotencyKey: string; tenantRef: string; accountRefs: string[] },
): Promise<void> {
  const emptyObjectRefs: string[] = [];
  journalIds.push(journal.id);
  await prisma.$executeRaw`
    INSERT INTO "DeletionJournal"
      ("id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs", "policyVersion", "requestedAt", "journalUntil")
    VALUES
      (${journal.id}, ${journal.idempotencyKey}, ${'tenant'}, ${journal.tenantRef}, ${journal.accountRefs}, ${emptyObjectRefs}, ${'deletion-test-v1'}, ${REQUESTED_AT}, ${JOURNAL_UNTIL})`;
}

async function insertTask(
  prisma: PrismaClient,
  task: {
    id: string;
    journalId: string;
    objectId: string;
    objectGeneration: string;
    storageKey: string;
    dedupeKey: string;
  },
): Promise<void> {
  taskIds.push(task.id);
  await prisma.$executeRaw`
    INSERT INTO "DeletionTask"
      ("id", "journalId", "kind", "targetSystem", "objectId", "objectGeneration", "storageKey", "dedupeKey", "nextAttemptAt")
    VALUES
      (${task.id}, ${task.journalId}, ${'file'}, ${'asset_packs'}, ${task.objectId}, ${task.objectGeneration}, ${task.storageKey}, ${task.dedupeKey}, ${REQUESTED_AT})`;
}

async function readJournal(prisma: PrismaClient, id: string): Promise<JournalRow[]> {
  return prisma.$queryRaw<JournalRow[]>`
    SELECT "id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs",
           "policyVersion", "requestedAt", "journalUntil", "generation"
    FROM "DeletionJournal" WHERE "id" = ${id}`;
}

async function readTask(prisma: PrismaClient, id: string): Promise<TaskRow[]> {
  return prisma.$queryRaw<TaskRow[]>`
    SELECT "id", "journalId", "kind", "targetSystem", "objectId", "objectGeneration",
           "storageKey", "dedupeKey"
    FROM "DeletionTask" WHERE "id" = ${id}`;
}

type ForeignKeyRef = { table: string; references: string };

async function queryTenantUserForeignKeys(prisma: PrismaClient): Promise<ForeignKeyRef[]> {
  return prisma.$queryRaw<ForeignKeyRef[]>`
    SELECT tc."table_name" AS "table", ccu."table_name" AS "references"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name IN (${'DeletionJournal'}, ${'DeletionTask'})
      AND ccu.table_name IN (${'Tenant'}, ${'User'})`;
}

describe('tenant deletion journal and tasks survive tenant/user removal (real database)', () => {
  afterAll(async () => {
    const prisma = createPrismaClient();
    try {
      const presence = await queryTablePresence(prisma);
      if (presence.length === 2 && presence.every((row) => row.rel !== null)) {
        for (const id of taskIds) {
          await prisma.$executeRaw`DELETE FROM "DeletionTask" WHERE "id" = ${id}`;
        }
        for (const id of journalIds) {
          await prisma.$executeRaw`DELETE FROM "DeletionJournal" WHERE "id" = ${id}`;
        }
      }
      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (tenantIds.length > 0) {
        await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it('keeps journal and task rows with unchanged references after tenant and user rows are deleted', async () => {
    const prisma = createPrismaClient();
    try {
      await requireTables(prisma);

      const suffix = crypto.randomUUID();
      const tenantId = `deletion_test_${crypto.randomUUID()}`;
      const userId = `deletion_test_${crypto.randomUUID()}`;
      tenantIds.push(tenantId);
      userIds.push(userId);
      const tenant = await prisma.tenant.create({
        data: { id: tenantId, slug: `deletion-test-${suffix}`, name: `deletion-test-${suffix}` },
      });
      const user = await prisma.user.create({ data: { id: userId, email: `deletion-test-${suffix}@example.test` } });

      const journalId = crypto.randomUUID();
      const idempotencyKey = `deletion-test-${crypto.randomUUID()}`;
      await insertJournal(prisma, { id: journalId, idempotencyKey, tenantRef: tenant.id, accountRefs: [user.id] });

      const objectId = crypto.randomUUID();
      const objectGeneration = crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const storageKey = `${tenant.id}/${objectId}/${objectGeneration}`;
      const dedupeKey = `deletion-test-${crypto.randomUUID()}`;
      await insertTask(prisma, { id: taskId, journalId, objectId, objectGeneration, storageKey, dedupeKey });

      const journalBefore = await readJournal(prisma, journalId);
      const taskBefore = await readTask(prisma, taskId);
      expect(journalBefore).toHaveLength(1);
      expect(taskBefore).toHaveLength(1);

      await prisma.user.delete({ where: { id: user.id } });
      await prisma.tenant.delete({ where: { id: tenant.id } });

      const journalAfter = await readJournal(prisma, journalId);
      const taskAfter = await readTask(prisma, taskId);
      expect(journalAfter).toHaveLength(1);
      expect(taskAfter).toHaveLength(1);
      expect(journalAfter[0]?.tenantRef).toBe(tenant.id);
      expect(journalAfter[0]?.accountRefs).toEqual([user.id]);
      expect(journalAfter[0]?.objectRefs).toEqual([]);
      expect(journalAfter[0]?.generation).toBe(journalBefore[0]?.generation);
      expect(taskAfter[0]?.objectId).toBe(objectId);
      expect(taskAfter[0]?.objectGeneration).toBe(objectGeneration);
      expect(taskAfter[0]?.storageKey).toBe(storageKey);

      expect(await queryTenantUserForeignKeys(prisma)).toEqual([]);
      await expect(prisma.$executeRaw`DELETE FROM "DeletionJournal" WHERE "id" = ${journalId}`).rejects.toMatchObject({
        code: 'P2010',
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23503',
              kind: 'ForeignKeyConstraintViolation',
              constraint: { index: 'DeletionTask_journalId_fkey' },
            },
          },
        },
      });
    } finally {
      await prisma.$disconnect();
    }
  });

  it('dedupes repeated journal and task inserts and orders generations monotonically', async () => {
    const prisma = createPrismaClient();
    try {
      await requireTables(prisma);

      const idempotencyKey = `deletion-test-${crypto.randomUUID()}`;
      const emptyObjectRefs: string[] = [];
      const firstJournalId = crypto.randomUUID();
      const duplicateJournalId = crypto.randomUUID();
      journalIds.push(firstJournalId, duplicateJournalId);
      const firstJournal = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DeletionJournal"
          ("id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs", "policyVersion", "requestedAt", "journalUntil")
        VALUES
          (${firstJournalId}, ${idempotencyKey}, ${'tenant'}, ${`deletion-test-${crypto.randomUUID()}`}, ${[`deletion-test-${crypto.randomUUID()}`]}, ${emptyObjectRefs}, ${'deletion-test-v1'}, ${REQUESTED_AT}, ${JOURNAL_UNTIL})
        ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING "id" AS "id"`;
      expect(firstJournal).toHaveLength(1);

      const secondJournal = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DeletionJournal"
          ("id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs", "policyVersion", "requestedAt", "journalUntil")
        VALUES
          (${duplicateJournalId}, ${idempotencyKey}, ${'tenant'}, ${`deletion-test-${crypto.randomUUID()}`}, ${[`deletion-test-${crypto.randomUUID()}`]}, ${emptyObjectRefs}, ${'deletion-test-v1'}, ${REQUESTED_AT}, ${JOURNAL_UNTIL})
        ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING "id" AS "id"`;
      expect(secondJournal).toHaveLength(0);

      const journalCount = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT COUNT(*) AS "n" FROM "DeletionJournal" WHERE "idempotencyKey" = ${idempotencyKey}`;
      expect(journalCount[0]?.n).toBe(1n);

      const journalId = firstJournal[0]?.id ?? '';
      const dedupeKey = `deletion-test-${crypto.randomUUID()}`;
      const objectId = crypto.randomUUID();
      const objectGeneration = crypto.randomUUID();
      const storageKey = `deletion-test-fixture/${objectId}/${objectGeneration}`;
      const firstTaskId = crypto.randomUUID();
      const duplicateTaskId = crypto.randomUUID();
      taskIds.push(firstTaskId, duplicateTaskId);
      const firstTask = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DeletionTask"
          ("id", "journalId", "kind", "targetSystem", "objectId", "objectGeneration", "storageKey", "dedupeKey", "nextAttemptAt")
        VALUES
          (${firstTaskId}, ${journalId}, ${'file'}, ${'asset_packs'}, ${objectId}, ${objectGeneration}, ${storageKey}, ${dedupeKey}, ${REQUESTED_AT})
        ON CONFLICT ("dedupeKey") DO NOTHING RETURNING "id" AS "id"`;
      expect(firstTask).toHaveLength(1);

      const secondTask = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "DeletionTask"
          ("id", "journalId", "kind", "targetSystem", "objectId", "objectGeneration", "storageKey", "dedupeKey", "nextAttemptAt")
        VALUES
          (${duplicateTaskId}, ${journalId}, ${'file'}, ${'asset_packs'}, ${objectId}, ${objectGeneration}, ${storageKey}, ${dedupeKey}, ${REQUESTED_AT})
        ON CONFLICT ("dedupeKey") DO NOTHING RETURNING "id" AS "id"`;
      expect(secondTask).toHaveLength(0);

      const storedTask = await readTask(prisma, firstTask[0]?.id ?? '');
      expect(storedTask).toHaveLength(1);
      expect(storedTask[0]?.objectId).toBe(objectId);
      expect(storedTask[0]?.objectGeneration).toBe(objectGeneration);
      expect(storedTask[0]?.storageKey).toBe(storageKey);
      expect(storedTask[0]?.dedupeKey).toBe(dedupeKey);

      const firstGenerationId = crypto.randomUUID();
      const secondGenerationId = crypto.randomUUID();
      journalIds.push(firstGenerationId, secondGenerationId);
      const firstGeneration = await prisma.$queryRaw<Array<{ generation: bigint }>>`
        INSERT INTO "DeletionJournal"
          ("id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs", "policyVersion", "requestedAt", "journalUntil")
        VALUES
          (${firstGenerationId}, ${`deletion-test-${crypto.randomUUID()}`}, ${'tenant'}, ${`deletion-test-${crypto.randomUUID()}`}, ${[`deletion-test-${crypto.randomUUID()}`]}, ${emptyObjectRefs}, ${'deletion-test-v1'}, ${REQUESTED_AT}, ${JOURNAL_UNTIL})
        RETURNING "generation" AS "generation"`;
      const secondGeneration = await prisma.$queryRaw<Array<{ generation: bigint }>>`
        INSERT INTO "DeletionJournal"
          ("id", "idempotencyKey", "scope", "tenantRef", "accountRefs", "objectRefs", "policyVersion", "requestedAt", "journalUntil")
        VALUES
          (${secondGenerationId}, ${`deletion-test-${crypto.randomUUID()}`}, ${'tenant'}, ${`deletion-test-${crypto.randomUUID()}`}, ${[`deletion-test-${crypto.randomUUID()}`]}, ${emptyObjectRefs}, ${'deletion-test-v1'}, ${REQUESTED_AT}, ${JOURNAL_UNTIL})
        RETURNING "generation" AS "generation"`;
      expect(firstGeneration).toHaveLength(1);
      expect(secondGeneration).toHaveLength(1);
      expect(typeof firstGeneration[0]?.generation).toBe('bigint');
      expect(typeof secondGeneration[0]?.generation).toBe('bigint');
      expect((secondGeneration[0]?.generation ?? 0n) > (firstGeneration[0]?.generation ?? 0n)).toBe(true);
    } finally {
      await prisma.$disconnect();
    }
  });
});
