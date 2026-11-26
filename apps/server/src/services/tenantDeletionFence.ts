import type { PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';

/**
 * Fence for an intent that has no outcome yet. It inserts a blocked row under the intent's
 * idempotency key. The unique index on that key decides the race with a deletion transaction that
 * may still be running: a transaction that holds the key makes the insert wait and then fail, a
 * transaction that has already ended lets the insert succeed and blocks every later attempt with
 * the same key. The unique index decides instead of comparing timestamps, so a late transaction
 * cannot slip through. The blocked row has no tenant reference and never counts as a tenant
 * journal row.
 */

export type FenceOutcome = 'abort' | 'commit' | 'open';

export interface FenceIntent {
  key: string;
  journalUntil: string;
}

const POLICY_VERSION = 'tenant-deletion-fence-v1';
const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '5s'";
const STATEMENT_TIMEOUT_SQL = "SET LOCAL statement_timeout = '10s'";

/** True for the Prisma error of a unique key conflict. */
function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/** Logs the failure by its code only, never by its message. */
function logFenceFailure(error: unknown): void {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  logger.warn({ event: 'tenant_deletion.intent_fence_failed', code: typeof code === 'string' ? code : 'unknown' });
}

/** Inserts the blocked row in its own transaction. The timeouts are constant SQL and bound each statement. */
async function insertBlockedRow(prisma: PrismaClient, intent: FenceIntent): Promise<void> {
  // Prisma's default 5 s transaction timeout would cut in before the 10 s statement timeout below.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(LOCK_TIMEOUT_SQL);
      await tx.$executeRawUnsafe(STATEMENT_TIMEOUT_SQL);
      await tx.deletionJournal.create({
        data: {
          idempotencyKey: intent.key,
          scope: 'tenant',
          tenantRef: null,
          accountRefs: [],
          objectRefs: [],
          policyVersion: POLICY_VERSION,
          status: 'blocked',
          journalUntil: new Date(intent.journalUntil),
        },
      });
    },
    { timeout: 15_000, maxWait: 5_000 },
  );
}

/** Reads the row that caused the unique conflict. A read error leaves the intent open. */
async function settleConflict(prisma: PrismaClient, key: string): Promise<FenceOutcome> {
  try {
    const row = await prisma.deletionJournal.findUnique({
      where: { idempotencyKey: key },
      select: { dbDeletedAt: true, status: true },
    });
    if (row?.dbDeletedAt) return 'commit';
    return row?.status === 'blocked' ? 'abort' : 'open';
  } catch (error) {
    logFenceFailure(error);
    return 'open';
  }
}

/**
 * Fences an intent without an outcome. 'abort': the key is blocked for every deletion transaction.
 * 'commit': the database recorded a deletion time. 'open': no decision. Never throws.
 */
export async function fenceUndecidedIntent(prisma: PrismaClient, intent: FenceIntent): Promise<FenceOutcome> {
  try {
    await insertBlockedRow(prisma, intent);
    return 'abort';
  } catch (error) {
    if (isUniqueConflict(error)) return settleConflict(prisma, intent.key);
    logFenceFailure(error);
    return 'open';
  }
}
