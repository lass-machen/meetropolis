import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import { appendJournalEntry, decideJournalIntents } from './tenantDeletionJournal.js';
import { removeCompactionLeftovers } from './tenantDeletionJournalCompaction.js';
import { compactExpiredJournals } from './deletionJournalExpiry.js';
import {
  fsErrorCode,
  hasLiveReference,
  removeTarget,
  resolveTaskTargets,
  targetExists,
} from './deletionTaskTargets.js';

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_LEASE_MS = 300_000;
const TASK_BATCH_SIZE = 100;
const JOURNAL_BATCH_SIZE = 100;
const RETRY_BASE_MS = 60_000;

/** Options of one pass over the due deletion tasks. `now` is the only clock the pass reads. */
export interface RunDeletionTasksOptions {
  prisma: PrismaClient;
  journalDir: string;
  now: Date;
  maxAttempts?: number;
  leaseMs?: number;
  maxCopyLifetimeMs: number;
  /**
   * Age after which an undecided journal intent may be fenced, see decideJournalIntents. The same age is
   * the minimum age of an account journal without tasks before it is completed.
   */
  abortAfterMs: number;
}

/** Counters of one pass. */
export interface DeletionTaskRunResult {
  done: number;
  retried: number;
  failed: number;
  manual: number;
  expired: number;
}

interface TaskSettings {
  maxAttempts: number;
  leaseMs: number;
}

/** A task as leased in this pass. */
interface Lease {
  taskId: string;
  leaseToken: string;
  attempts: number;
  now: Date;
}

type Settlement = { kind: 'done' } | { kind: 'retry' | 'failed' | 'manual_required'; code: string };

type TaskUpdate = Prisma.DeletionTaskUpdateManyMutationInput;

function findDueTasks(prisma: PrismaClient, now: Date) {
  return prisma.deletionTask.findMany({
    where: {
      journal: { status: 'cleanup_pending', dbDeletedAt: { not: null } },
      OR: [
        { status: { in: ['pending', 'retry'] }, nextAttemptAt: { lte: now } },
        { status: 'leased', leaseUntil: { lte: now } },
      ],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }],
    take: TASK_BATCH_SIZE,
    select: {
      id: true,
      status: true,
      leaseToken: true,
      attempts: true,
      kind: true,
      targetSystem: true,
      objectId: true,
      storageKey: true,
    },
  });
}

type DueTask = Awaited<ReturnType<typeof findDueTasks>>[number];

/**
 * Runs one pass over the due deletion tasks, completes the journals whose tasks are all done,
 * compacts the journal entries past their copy lifetime and then logs a single line when tasks need
 * attention. Leftovers of an interrupted compaction are removed first, undecided journal intents are
 * decided next. Due checks, leases, retry times, completion times and the compaction limit all derive
 * from `options.now`.
 */
export async function runDeletionTasks(options: RunDeletionTasksOptions): Promise<DeletionTaskRunResult> {
  await removeLeftovers(options.journalDir);
  await decideOpenIntents(options);
  const settings: TaskSettings = {
    maxAttempts: positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS, 'maxAttempts'),
    leaseMs: positiveInteger(options.leaseMs, DEFAULT_LEASE_MS, 'leaseMs'),
  };
  const result: DeletionTaskRunResult = { done: 0, retried: 0, failed: 0, manual: 0, expired: 0 };
  await processDueTasks(options.prisma, options.now, settings, result);
  await completeJournals(options.prisma, options.journalDir, options.now, options.abortAfterMs);
  result.expired = await compactExpired(options);
  await warnAboutStuckTasks(options.prisma);
  return result;
}

/** Leftover files of an interrupted compaction are removed first. A failure does not stop the pass. */
async function removeLeftovers(journalDir: string): Promise<void> {
  try {
    if (await removeCompactionLeftovers(journalDir)) return;
    logger.warn({ event: 'tenant_deletion.journal_unavailable', code: 'leftovers_not_removed' });
  } catch (error) {
    logger.warn({ event: 'tenant_deletion.journal_unavailable', code: fsErrorCode(error) });
  }
}

/** A failure is logged by its code and does not stop the pass. */
async function decideOpenIntents(options: RunDeletionTasksOptions): Promise<void> {
  try {
    await decideJournalIntents({
      prisma: options.prisma,
      journalDir: options.journalDir,
      now: options.now,
      abortAfterMs: options.abortAfterMs,
    });
  } catch (error) {
    logger.error({ event: 'tenant_deletion.intent_decision_failed', code: fsErrorCode(error) });
  }
}

/** A failed compaction is logged by its code and counts as no removed keys. */
async function compactExpired(options: RunDeletionTasksOptions): Promise<number> {
  try {
    return await compactExpiredJournals(options.prisma, options.journalDir, options.now, options.maxCopyLifetimeMs);
  } catch (error) {
    logger.error({ event: 'tenant_deletion.journal_compaction_failed', code: fsErrorCode(error) });
    return 0;
  }
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be an integer of at least 1`);
  return value;
}

async function processDueTasks(
  prisma: PrismaClient,
  now: Date,
  settings: TaskSettings,
  result: DeletionTaskRunResult,
): Promise<void> {
  const tasks = await findDueTasks(prisma, now);
  for (const task of tasks) {
    try {
      await processTask(prisma, task, now, settings, result);
    } catch (error) {
      // The lease runs out on its own, so the task becomes due again in a later pass.
      logger.error({ event: 'tenant_deletion.task_error', taskId: task.id, code: unexpectedErrorCode(error) });
    }
  }
}

/** File system codes stay visible; every other unexpected error is reported as `task_error`. */
function unexpectedErrorCode(error: unknown): string {
  const code = fsErrorCode(error);
  return code === 'fs_error' ? 'task_error' : code;
}

async function processTask(
  prisma: PrismaClient,
  task: DueTask,
  now: Date,
  settings: TaskSettings,
  result: DeletionTaskRunResult,
): Promise<void> {
  const leaseToken = randomBytes(16).toString('hex');
  const claim = await prisma.deletionTask.updateMany({
    where: { id: task.id, status: task.status, leaseToken: task.leaseToken, attempts: task.attempts },
    data: {
      status: 'leased',
      leaseToken,
      leaseUntil: new Date(now.getTime() + settings.leaseMs),
      attempts: { increment: 1 },
    },
  });
  if (claim.count !== 1) return;
  const lease: Lease = { taskId: task.id, leaseToken, attempts: task.attempts + 1, now };
  const settlement = finalize(await decideOutcome(prisma, task), lease.attempts, settings.maxAttempts);
  await settle(prisma, lease, settlement, result);
}

/** Runs the checks and removals of one task and says how the task should end. */
async function decideOutcome(prisma: PrismaClient, task: DueTask): Promise<Settlement> {
  const resolution = resolveTaskTargets(task);
  if (!resolution.ok) return { kind: 'failed', code: resolution.code };
  if (await hasLiveReference(prisma, task)) return { kind: 'manual_required', code: 'target_still_referenced' };
  for (const target of resolution.targets) {
    const outcome = await removeTarget(target);
    if (outcome.kind === 'refused') return { kind: 'failed', code: outcome.code };
    if (outcome.kind === 'error') return { kind: 'retry', code: outcome.code };
  }
  return { kind: 'done' };
}

/** A retryable error that has used up its attempts ends as failed. */
function finalize(settlement: Settlement, attempts: number, maxAttempts: number): Settlement {
  if (settlement.kind === 'retry' && attempts >= maxAttempts) return { kind: 'failed', code: settlement.code };
  return settlement;
}

/** The row update that ends a lease. Every ending releases the lease. */
function settlementData(settlement: Settlement, lease: Lease): TaskUpdate {
  const released = { leaseToken: null, leaseUntil: null };
  switch (settlement.kind) {
    case 'done':
      return { ...released, status: 'done', completedAt: lease.now, lastErrorCode: null };
    case 'retry':
      return {
        ...released,
        status: 'retry',
        nextAttemptAt: new Date(lease.now.getTime() + 2 ** lease.attempts * RETRY_BASE_MS),
        lastErrorCode: settlement.code,
      };
    case 'failed':
    case 'manual_required':
      return { ...released, status: settlement.kind, lastErrorCode: settlement.code };
  }
}

/** Writes the outcome under the lease token. A lost lease is logged and not counted. */
async function settle(
  prisma: PrismaClient,
  lease: Lease,
  settlement: Settlement,
  result: DeletionTaskRunResult,
): Promise<void> {
  const written = await prisma.deletionTask.updateMany({
    where: { id: lease.taskId, status: 'leased', leaseToken: lease.leaseToken },
    data: settlementData(settlement, lease),
  });
  if (written.count !== 1) {
    logger.warn({ event: 'tenant_deletion.task_lease_lost', taskId: lease.taskId });
    return;
  }
  if (settlement.kind === 'done') {
    result.done += 1;
  } else if (settlement.kind === 'retry') {
    result.retried += 1;
  } else if (settlement.kind === 'failed') {
    result.failed += 1;
    logger.warn({ event: 'tenant_deletion.task_failed', taskId: lease.taskId, code: settlement.code });
  } else {
    result.manual += 1;
    logger.warn({ event: 'tenant_deletion.task_manual_required', taskId: lease.taskId, code: settlement.code });
  }
}

/**
 * Journals ready for completion: all tasks done, or, for an account journal without tasks, a database
 * deletion older than the minimum age. The minimum age keeps the pass from racing the request that
 * deletes the account.
 */
function findCompletableJournals(prisma: PrismaClient, accountCutoff: Date) {
  return prisma.deletionJournal.findMany({
    where: {
      status: 'cleanup_pending',
      dbDeletedAt: { not: null },
      OR: [
        { tasks: { some: {}, every: { status: 'done' } } },
        { scope: 'account', tasks: { none: {} }, dbDeletedAt: { lte: accountCutoff } },
      ],
    },
    orderBy: [{ dbDeletedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, idempotencyKey: true, scope: true, tenantRef: true, accountRefs: true },
    take: JOURNAL_BATCH_SIZE,
  });
}

type CompletableJournal = Awaited<ReturnType<typeof findCompletableJournals>>[number];

/** Reference fields of a completed entry: the tenant, or the account with an empty tenant reference. */
type CompletionRefs = { tenantRef: string; accountRef?: string };

/** Undefined when the row does not carry the reference that its scope needs. */
function completionRefs(journal: CompletableJournal): CompletionRefs | undefined {
  if (journal.scope !== 'account') {
    return journal.tenantRef === null ? undefined : { tenantRef: journal.tenantRef };
  }
  const accountRef = journal.accountRefs[0];
  return accountRef === undefined ? undefined : { tenantRef: '', accountRef };
}

/**
 * Completes the cleanup_pending journals that findCompletableJournals selects. The completed entry goes
 * to the journal file before the database status changes. A failed journal write ends the pass, because
 * the journal file is unavailable for the remaining journals as well.
 */
async function completeJournals(
  prisma: PrismaClient,
  journalDir: string,
  now: Date,
  abortAfterMs: number,
): Promise<void> {
  const journals = await findCompletableJournals(prisma, new Date(now.getTime() - abortAfterMs));
  for (const journal of journals) {
    const refs = completionRefs(journal);
    if (refs === undefined) {
      const code = journal.scope === 'account' ? 'missing_account_ref' : 'missing_tenant_ref';
      logger.warn({ event: 'tenant_deletion.journal_not_completed', journalId: journal.id, code });
      continue;
    }
    if (!(await doneTasksAreSettled(prisma, journal.id, now))) continue;
    if (!(await appendCompletedEntry(journalDir, journal, refs, now))) return;
    await prisma.deletionJournal.updateMany({
      where: { id: journal.id, status: 'cleanup_pending' },
      data: { status: 'completed', completedAt: now },
    });
  }
}

/**
 * True when every done task of the journal still matches its files. A task with a file on disk is
 * reopened, and a task that cannot be mapped to files or is not done keeps the journal open.
 */
async function doneTasksAreSettled(prisma: PrismaClient, journalId: string, now: Date): Promise<boolean> {
  const tasks = await prisma.deletionTask.findMany({
    where: { journalId },
    select: { id: true, status: true, kind: true, targetSystem: true, objectId: true, storageKey: true },
  });
  let settled = true;
  for (const task of tasks) {
    if (task.status !== 'done') {
      settled = false;
      continue;
    }
    const resolution = resolveTaskTargets(task);
    if (!resolution.ok) {
      logger.warn({
        event: 'tenant_deletion.journal_not_completed',
        journalId,
        taskId: task.id,
        code: 'invalid_done_task',
      });
      settled = false;
      continue;
    }
    const present = await Promise.all(resolution.targets.map((target) => targetExists(target)));
    if (present.includes(true)) {
      const reopened = await prisma.deletionTask.updateMany({
        where: { id: task.id, status: 'done' },
        data: { status: 'pending', nextAttemptAt: now, completedAt: null },
      });
      if (reopened.count === 1) logger.warn({ event: 'tenant_deletion.task_reopened', taskId: task.id });
      settled = false;
    }
  }
  return settled;
}

/** Appends the completed entry of one journal. False when the journal file cannot be written. */
async function appendCompletedEntry(
  journalDir: string,
  journal: CompletableJournal,
  refs: CompletionRefs,
  now: Date,
): Promise<boolean> {
  try {
    await appendJournalEntry(journalDir, {
      type: 'completed',
      key: journal.idempotencyKey,
      ...refs,
      at: now.toISOString(),
    });
    return true;
  } catch (error) {
    logger.error({ event: 'tenant_deletion.journal_unavailable', journalId: journal.id, code: fsErrorCode(error) });
    return false;
  }
}

/** One log line when tasks have failed or wait for a person. Counts only, no identifiers. */
async function warnAboutStuckTasks(prisma: PrismaClient): Promise<void> {
  const failed = await prisma.deletionTask.count({ where: { status: 'failed' } });
  const manualRequired = await prisma.deletionTask.count({ where: { status: 'manual_required' } });
  if (failed > 0 || manualRequired > 0) {
    logger.warn({ event: 'tenant_deletion.tasks_need_attention', failed, manualRequired });
  }
}
