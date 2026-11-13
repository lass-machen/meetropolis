import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import type { PendingDeletionOutcome } from './tenantDeletionJournal.js';
import {
  JournalUnavailableError,
  appendJournalEntry,
  createIdempotencyKey,
  parseRetentionDays,
  prepareJournalForWrite,
  recordPendingFailure,
} from './tenantDeletionJournal.js';
import type { JournalPlanResolverOptions } from './tenantDeletionPlanning.js';
import {
  FILE_TASK_GENERATION,
  TENANT_DELETION_JOURNAL_MAX_COPY_LIFETIME_MS,
  dedupeKeyFor,
  readTransactionTimeMs,
} from './tenantDeletionPlanning.js';
import { isRestorePending } from './tenantDeletionRestoreMarker.js';

/**
 * Journal entries for account deletions, that is deletions that are not tenant
 * deletions. Such rows carry the account reference only; the tenant reference
 * stays empty. The resolver runs inside the deletion transaction, the other
 * functions write before and after it.
 */

/** Journal state of one account deletion, planned inside its transaction. */
export type AccountJournalPlan = { journalDir: string; key: string; journalUntil: string; at: string };

/** Plans one account deletion; undefined means the journal cannot record it. */
export type AccountJournalResolver = (
  tx: Prisma.TransactionClient,
  userId: string,
) => Promise<AccountJournalPlan | undefined>;

/** Policy marker stored on every account journal row. */
const ACCOUNT_JOURNAL_POLICY_VERSION = 'account-deletion-journal-v1';

let accountJournalResolver: AccountJournalResolver | undefined;

/** Thrown when a registered journal cannot record an account deletion. */
export class AccountDeletionJournalUnavailableError extends Error {
  readonly code = 'account_deletion_journal_unavailable' as const;

  constructor() {
    super('account deletion blocked: no valid retention plan available');
    this.name = 'AccountDeletionJournalUnavailableError';
  }
}

/**
 * Builds the resolver for account deletions. Nothing is read or called here. Each call
 * checks the restore marker, the retention setting and the journal state, then appends
 * the intent, mirroring the tenant resolver.
 */
export function createAccountJournalPlanResolver(options: JournalPlanResolverOptions): AccountJournalResolver {
  const { journalDir, allowDuringRestoreReplay } = options;
  return async (tx, userId) => {
    if (allowDuringRestoreReplay !== true && (await isRestorePending(journalDir))) return undefined;
    if (parseRetentionDays(options.retentionDays) === undefined) return undefined;
    try {
      const transactionMs = await readTransactionTimeMs(tx, undefined);
      if (!(await prepareJournalForWrite(journalDir))) return undefined;
      const at = new Date(transactionMs).toISOString();
      const journalUntil = new Date(transactionMs + TENANT_DELETION_JOURNAL_MAX_COPY_LIFETIME_MS).toISOString();
      const key = createIdempotencyKey();
      await appendJournalEntry(journalDir, {
        type: 'intent',
        key,
        tenantRef: '',
        accountRef: userId,
        at,
        journalUntil,
      });
      return { journalDir, key, journalUntil, at };
    } catch (error) {
      if (error instanceof JournalUnavailableError) return undefined;
      throw error;
    }
  };
}

/** Registers the account resolver; undefined clears it, which leaves account deletions unjournaled. */
export function registerAccountDeletionJournal(resolver: AccountJournalResolver | undefined): void {
  accountJournalResolver = resolver;
}

/** The registered account resolver, if any. */
export function getAccountDeletionJournal(): AccountJournalResolver | undefined {
  return accountJournalResolver;
}

/**
 * Plans the journal entry of an account deletion inside its transaction. Without a
 * registered resolver the deletion runs unjournaled; with one, a resolver that cannot
 * plan blocks the deletion. The log line carries no user reference.
 */
export async function resolveAccountJournalOrThrow(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<AccountJournalPlan | undefined> {
  const resolver = getAccountDeletionJournal();
  if (resolver === undefined) return undefined;
  const plan = await resolver(tx, userId);
  if (plan === undefined) {
    logger.warn({ event: 'account_delete.journal_unavailable' });
    throw new AccountDeletionJournalUnavailableError();
  }
  return plan;
}

/**
 * Writes the account journal row and, for a custom avatar, its file task. Runs inside the
 * deletion transaction. Returns the journal id.
 */
export async function writeAccountJournalInTx(
  tx: Prisma.TransactionClient,
  plan: AccountJournalPlan,
  userId: string,
  avatarUuid: string | null,
): Promise<string> {
  const journal = await tx.deletionJournal.create({
    data: {
      idempotencyKey: plan.key,
      scope: 'account',
      tenantRef: null,
      accountRefs: [userId],
      objectRefs: avatarUuid === null ? [] : [avatarUuid],
      policyVersion: ACCOUNT_JOURNAL_POLICY_VERSION,
      requestedAt: new Date(plan.at),
      journalUntil: new Date(plan.journalUntil),
    },
  });
  if (avatarUuid !== null) {
    const task = {
      kind: 'file',
      targetSystem: 'custom_avatars',
      objectId: avatarUuid,
      objectGeneration: FILE_TASK_GENERATION,
    };
    await tx.deletionTask.create({
      data: {
        ...task,
        journalId: journal.id,
        dedupeKey: dedupeKeyFor(journal.id, task),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(plan.at),
      },
    });
  }
  return journal.id;
}

/**
 * Records the database deletion time on the account row and sets it to cleanup_pending.
 * transaction_timestamp() is fixed for the whole transaction, so the time equals the intent time.
 */
export async function completeAccountJournalInTx(tx: Prisma.TransactionClient, journalId: string): Promise<void> {
  const transactionMs = await readTransactionTimeMs(tx, undefined);
  await tx.deletionJournal.update({
    where: { id: journalId },
    data: { dbDeletedAt: new Date(transactionMs), status: 'cleanup_pending' },
  });
}

/** Journal reference of one account intent; the tenant reference stays empty. */
function pendingOf(plan: AccountJournalPlan, userId: string): PendingDeletionOutcome {
  return {
    journalDir: plan.journalDir,
    key: plan.key,
    tenantRef: '',
    accountRef: userId,
    journalUntil: plan.journalUntil,
  };
}

/**
 * Records the committed account deletion as a commit entry. If the commit cannot be written,
 * nothing else is recorded. Otherwise, without file tasks, the row is completed right away;
 * with file tasks, completion waits for the tasks. Never throws: the deletion is committed,
 * and a missing record is healed by the next reconciliation.
 */
export async function recordAccountDeletionCommitted(
  prisma: PrismaClient,
  plan: AccountJournalPlan,
  userId: string,
  hasTasks: boolean,
): Promise<void> {
  try {
    await appendJournalEntry(plan.journalDir, {
      type: 'commit',
      key: plan.key,
      tenantRef: '',
      accountRef: userId,
      at: new Date().toISOString(),
    });
  } catch {
    // The open intent is decided by the next reconciliation and the worker completes the row later.
    return;
  }
  if (hasTasks) return;
  try {
    await appendJournalEntry(plan.journalDir, {
      type: 'completed',
      key: plan.key,
      tenantRef: '',
      accountRef: userId,
      at: new Date().toISOString(),
    });
    await prisma.deletionJournal.update({
      where: { idempotencyKey: plan.key },
      data: { status: 'completed', completedAt: new Date() },
    });
  } catch {
    // A missing completion is healed by the next reconciliation.
  }
}

/** Records a rolled-back account deletion. The caller rethrows the original error. */
export async function recordAccountDeletionFailed(
  prisma: PrismaClient,
  plan: AccountJournalPlan,
  userId: string,
): Promise<void> {
  await recordPendingFailure(prisma, pendingOf(plan, userId));
}
