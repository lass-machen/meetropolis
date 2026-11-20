import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import {
  TENANT_DELETION_PROTOCOL,
  TenantDeletionContractError,
  TenantDeletionJournalUnavailableError,
  assertTenantDeletionProtocol,
} from './tenantDeletionContract.js';
import type {
  TenantDeletionOptions,
  TenantDeletionPlanInput,
  TenantDeletionTaskPlan,
} from './tenantDeletionContract.js';
import {
  JournalUnavailableError,
  appendJournalEntry,
  createIdempotencyKey,
  decideJournalIntents,
  journalUntilFor,
  notePendingDeletionOutcome,
  parseRetentionDays,
  prepareJournalForWrite,
  type UndecidedIntentCounts,
} from './tenantDeletionJournal.js';
import { isRestorePending } from './tenantDeletionRestoreMarker.js';
import { runDeletionTasks } from './deletionTaskWorker.js';
import type { DeletionTaskRunResult } from './deletionTaskWorker.js';

// Restore replay, re-exported for callers that load this module as the entry
// point of the tenant deletion services.
export { replayCommittedDeletions } from './tenantDeletionReplay.js';
export { journalUntilFor, parseMaxCopyLifetimeDays } from './tenantDeletionJournal.js';

// A tenant with large maps deletes tens of thousands of map chunks in one transaction; the Prisma default of 5 s is not enough.
export const TENANT_DELETION_TX_TIMEOUT_MS = 120_000;
export const TENANT_DELETION_TX_MAX_WAIT_MS = 10_000;
export const UNDECIDED_INTENT_RESERVE_MS = 120_000;
export function undecidedIntentAbortAfterMs(): number {
  return TENANT_DELETION_TX_TIMEOUT_MS + TENANT_DELETION_TX_MAX_WAIT_MS + UNDECIDED_INTENT_RESERVE_MS;
}

/** Decides undecided journal intents with the abort threshold of this module. */
export function decideUndecidedIntents(options: {
  prisma: PrismaClient;
  journalDir: string;
  now: Date;
}): Promise<UndecidedIntentCounts> {
  return decideJournalIntents({ ...options, abortAfterMs: undecidedIntentAbortAfterMs() });
}

/**
 * Managed tenant deletion plan.
 *
 * The host first resolves the contract state, then determines exactly one internal
 * transaction time, validates the internal plan completely before the first
 * write, writes journal and tasks, and only then calls the EE cleanup.
 * Every validation error is sanitized (`retention_journal_unavailable`),
 * while DB and callback errors propagate unchanged. No network, worker,
 * or provider call; no fallback, no default, no deadline from env.
 */

/** Validated callbacks; `undefined` means a bare OSS deletion without journal. */
export interface ManagedTenantDeletionCallbacks {
  prepareInTx: NonNullable<TenantDeletionOptions['prepareInTx']>;
  cleanupInTx: NonNullable<TenantDeletionOptions['cleanupInTx']>;
  transactionTime?: Date;
}

/** Result of the preparation; the time is a separate clone of the caller's value. */
export interface TenantDeletionPrepared {
  journalId: string;
  transactionTime: Date;
}

interface ValidatedTaskPlan {
  kind: string;
  targetSystem: string;
  objectId: string;
  objectGeneration: string;
  storageKey?: string;
}

interface ValidatedPlan {
  idempotencyKey: string;
  policyVersion: string;
  journalUntilMs: number;
  tasks: ValidatedTaskPlan[];
}

/**
 * Only checks the contract state; calls no callbacks and reads no DB.
 * Bare empty OSS options yield `undefined`.
 */
export function resolveTenantDeletionOptions(
  options: TenantDeletionOptions = {},
): ManagedTenantDeletionCallbacks | undefined {
  const { deletionProtocol, prepareInTx, cleanupInTx, transactionTime } = options;
  if (
    deletionProtocol === undefined &&
    prepareInTx === undefined &&
    cleanupInTx === undefined &&
    transactionTime === undefined
  ) {
    return undefined;
  }
  assertTenantDeletionProtocol(deletionProtocol);
  if (typeof prepareInTx !== 'function' || typeof cleanupInTx !== 'function') {
    throw new TenantDeletionContractError();
  }
  return { prepareInTx, cleanupInTx, transactionTime };
}

/** Reads ms via the Date intrinsic; strings, numbers and invalid dates yield null. */
function getTimeMs(value: unknown): number | null {
  try {
    const ms: unknown = Date.prototype.getTime.call(value);
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/** Internal transaction time: explicit test input, or DB time read via this host tx. */
export async function readTransactionTimeMs(tx: Prisma.TransactionClient, explicit: Date | undefined): Promise<number> {
  if (explicit !== undefined) {
    const ms = getTimeMs(explicit);
    if (ms === null) throw new TenantDeletionJournalUnavailableError();
    return ms;
  }
  const rows = await tx.$queryRaw<Array<{ transactionTime: unknown }>>`
    SELECT transaction_timestamp() AS "transactionTime"`;
  const ms = getTimeMs(rows[0]?.transactionTime);
  if (ms === null) throw new TenantDeletionJournalUnavailableError();
  return ms;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Validates a single task descriptor and copies it into its own values. */
function validateTaskPlan(task: unknown): ValidatedTaskPlan {
  if (typeof task !== 'object' || task === null) throw new TenantDeletionJournalUnavailableError();
  const record = task as Record<string, unknown>;
  const { kind, targetSystem, objectId, objectGeneration, storageKey } = record;
  if (!isNonEmptyString(kind) || kind.length > 64) throw new TenantDeletionJournalUnavailableError();
  if (!isNonEmptyString(targetSystem) || targetSystem.length > 64) {
    throw new TenantDeletionJournalUnavailableError();
  }
  if (!isNonEmptyString(objectId)) throw new TenantDeletionJournalUnavailableError();
  if (!isNonEmptyString(objectGeneration)) throw new TenantDeletionJournalUnavailableError();
  if (storageKey !== undefined && !isNonEmptyString(storageKey)) {
    throw new TenantDeletionJournalUnavailableError();
  }
  return storageKey === undefined
    ? { kind, targetSystem, objectId, objectGeneration }
    : { kind, targetSystem, objectId, objectGeneration, storageKey };
}

/** Validates the plan completely before the first write; all errors are sanitized. */
function validatePlanInput(plan: unknown, internalMs: number): ValidatedPlan {
  if (typeof plan !== 'object' || plan === null) throw new TenantDeletionJournalUnavailableError();
  const record = plan as Record<string, unknown>;
  const { idempotencyKey, policyVersion, journalUntil, tasks } = record;
  if (!isNonEmptyString(idempotencyKey)) throw new TenantDeletionJournalUnavailableError();
  if (!isNonEmptyString(policyVersion)) throw new TenantDeletionJournalUnavailableError();
  if (!Array.isArray(tasks)) throw new TenantDeletionJournalUnavailableError();
  const journalUntilMs = getTimeMs(journalUntil);
  if (journalUntilMs === null || journalUntilMs <= internalMs) {
    throw new TenantDeletionJournalUnavailableError();
  }
  return { idempotencyKey, policyVersion, journalUntilMs, tasks: tasks.map(validateTaskPlan) };
}

/** Deduplicates per tuple; a differing storage key is a validation error. */
function dedupeTaskPlans(tasks: ValidatedTaskPlan[]): ValidatedTaskPlan[] {
  const seen = new Map<string, ValidatedTaskPlan>();
  for (const task of tasks) {
    const key = JSON.stringify([task.kind, task.targetSystem, task.objectId, task.objectGeneration]);
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, task);
    } else if (existing.storageKey !== task.storageKey) {
      throw new TenantDeletionJournalUnavailableError();
    }
  }
  return [...seen.values()];
}

/** Stable dedupe key across journal and task identity. */
export function dedupeKeyFor(journalId: string, task: ValidatedTaskPlan): string {
  return createHash('sha256')
    .update(JSON.stringify([journalId, task.kind, task.targetSystem, task.objectId, task.objectGeneration]))
    .digest('hex');
}

/** Writes the journal (no upsert) and the tasks; empty task lists are valid. */
async function writeJournalAndTasks(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountRefs: readonly string[],
  plan: ValidatedPlan,
  internalMs: number,
): Promise<string> {
  const journal = await tx.deletionJournal.create({
    data: {
      idempotencyKey: plan.idempotencyKey,
      scope: 'tenant',
      tenantRef: tenantId,
      accountRefs: [...new Set(accountRefs)].sort(),
      objectRefs: [...new Set(plan.tasks.map((task) => task.objectId))].sort(),
      policyVersion: plan.policyVersion,
      requestedAt: new Date(internalMs),
      journalUntil: new Date(plan.journalUntilMs),
    },
  });
  if (plan.tasks.length > 0) {
    await tx.deletionTask.createMany({
      data: plan.tasks.map((task) => ({
        journalId: journal.id,
        kind: task.kind,
        targetSystem: task.targetSystem,
        objectId: task.objectId,
        objectGeneration: task.objectGeneration,
        storageKey: task.storageKey,
        dedupeKey: dedupeKeyFor(journal.id, task),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(internalMs),
      })),
    });
  }
  return journal.id;
}

/**
 * Prepares the managed deletion: determine the time, fetch the plan,
 * validate, write journal/tasks, then call the EE cleanup. Bare
 * calls are a no-op. DB and callback errors propagate unchanged.
 */
export async function prepareTenantDeletionInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  accountRefs: readonly string[],
  managed: ManagedTenantDeletionCallbacks | undefined,
): Promise<TenantDeletionPrepared | undefined> {
  if (managed === undefined) return undefined;
  const internalMs = await readTransactionTimeMs(tx, managed.transactionTime);
  const plan = await managed.prepareInTx(tx, {
    deletionProtocol: TENANT_DELETION_PROTOCOL,
    transactionTime: new Date(internalMs),
  });
  if (plan === undefined) throw new TenantDeletionJournalUnavailableError();
  const validated = validatePlanInput(plan, internalMs);
  const journalId = await writeJournalAndTasks(
    tx,
    tenantId,
    accountRefs,
    { ...validated, tasks: dedupeTaskPlans(validated.tasks) },
    internalMs,
  );
  await managed.cleanupInTx(tx, {
    deletionProtocol: TENANT_DELETION_PROTOCOL,
    transactionTime: new Date(internalMs),
    journalId,
  });
  return { journalId, transactionTime: new Date(internalMs) };
}

/** Policy marker stored on every journal row created through the resolver. */
const JOURNAL_POLICY_VERSION = 'tenant-deletion-journal-v1';

/** Fixed object generation for file tasks: files carry no version counter. */
export const FILE_TASK_GENERATION = '1';

/** Options for the file-backed deletion plan resolver. */
export interface JournalPlanResolverOptions {
  prisma: PrismaClient;
  journalDir: string;
  retentionDays: unknown;
  /** Raw BACKUP_MAX_COPY_LIFETIME_DAYS setting: maximum lifetime of any backup copy in days. */
  maxCopyLifetimeDays: unknown;
  /** Only for the restore replay tool: lets the resolver run while a restore marker is present. */
  allowDuringRestoreReplay?: boolean;
}

/** Plan callback handed to the enterprise deletion route. */
export type JournalResolvePlan = (
  tx: Prisma.TransactionClient,
  input: { tenantId: string; transactionTime: Date },
) => Promise<TenantDeletionPlanInput | undefined>;

interface JournalTaskSource {
  targetSystem: string;
  objectIds: string[];
  storageKey?: string;
}

function toFileTasks(sources: JournalTaskSource[]): TenantDeletionTaskPlan[] {
  const tasks: TenantDeletionTaskPlan[] = [];
  for (const source of sources) {
    for (const objectId of source.objectIds) {
      tasks.push(
        source.storageKey === undefined
          ? {
              kind: 'file',
              targetSystem: source.targetSystem,
              objectId,
              objectGeneration: FILE_TASK_GENERATION,
            }
          : {
              kind: 'file',
              targetSystem: source.targetSystem,
              objectId,
              objectGeneration: FILE_TASK_GENERATION,
              storageKey: source.storageKey,
            },
      );
    }
  }
  return tasks;
}

/**
 * Builds a resolver that persists every deletion intent to the file journal
 * before returning the plan. Unavailable journal state (missing or read-only
 * directory, broken chain or checkpoint, invalid retention setting, missing,
 * invalid or too short copy lifetime) yields
 * undefined so the route answers 409; database errors propagate. While a restore is pending, every call
 * yields undefined as well, unless the restore replay tool allows it.
 */
export async function createJournalPlanResolver(options: JournalPlanResolverOptions): Promise<JournalResolvePlan> {
  const { prisma, journalDir, allowDuringRestoreReplay } = options;
  const retentionDays = parseRetentionDays(options.retentionDays);
  try {
    await decideUndecidedIntents({ prisma, journalDir, now: new Date() });
  } catch (error) {
    if (!(error instanceof JournalUnavailableError)) throw error;
  }

  return async (tx, input) => {
    if (allowDuringRestoreReplay !== true && (await isRestorePending(journalDir))) return undefined;
    if (retentionDays === undefined) return undefined;
    const transactionMs = getTimeMs(input.transactionTime);
    if (transactionMs === null) return undefined;
    const journalUntil = journalUntilFor(transactionMs, options.maxCopyLifetimeDays, options.retentionDays);
    if (journalUntil === undefined) return undefined;
    try {
      if (!(await prepareJournalForWrite(journalDir))) return undefined;
      const tenant = await tx.tenant.findUnique({
        where: { id: input.tenantId },
        select: { slug: true },
      });
      if (tenant === null) return undefined;
      const [assetPacks, avatarPacks, customAvatars] = await Promise.all([
        tx.assetPack.findMany({ where: { tenantId: input.tenantId }, select: { uuid: true } }),
        tx.avatarPack.findMany({ where: { tenantId: input.tenantId }, select: { uuid: true } }),
        tx.customAvatar.findMany({ where: { tenantId: input.tenantId }, select: { uuid: true } }),
      ]);
      const key = createIdempotencyKey();
      await appendJournalEntry(journalDir, {
        type: 'intent',
        key,
        tenantRef: input.tenantId,
        at: new Date(transactionMs).toISOString(),
        journalUntil: journalUntil.toISOString(),
      });
      notePendingDeletionOutcome(input.tenantId, {
        journalDir,
        key,
        tenantRef: input.tenantId,
        journalUntil: journalUntil.toISOString(),
      });
      return {
        idempotencyKey: key,
        policyVersion: JOURNAL_POLICY_VERSION,
        journalUntil,
        tasks: toFileTasks([
          { targetSystem: 'asset_packs', objectIds: assetPacks.map((pack) => pack.uuid) },
          { targetSystem: 'avatar_packs', objectIds: avatarPacks.map((pack) => pack.uuid) },
          { targetSystem: 'custom_avatars', objectIds: customAvatars.map((avatar) => avatar.uuid) },
          { targetSystem: 'npc_media', objectIds: [input.tenantId], storageKey: tenant.slug },
        ]),
      };
    } catch (error) {
      if (error instanceof JournalUnavailableError) return undefined;
      throw error;
    }
  };
}

/**
 * After the tenant DELETE, records the journal state: no
 * completed proof; tasks stay pending. Bare calls are a no-op.
 */
export async function completeTenantDeletionInTx(
  tx: Prisma.TransactionClient,
  prepared: TenantDeletionPrepared | undefined,
): Promise<void> {
  if (prepared === undefined) return;
  await tx.deletionJournal.update({
    where: { id: prepared.journalId },
    data: {
      dbDeletedAt: new Date(Date.prototype.getTime.call(prepared.transactionTime)),
      status: 'cleanup_pending',
    },
  });
}

/** Runs one pass over the due deletion tasks with the journal limits of this module. */
export function runDeletionTasksOnce(options: {
  prisma: PrismaClient;
  journalDir: string;
  now: Date;
  maxAttempts?: number;
  leaseMs?: number;
  maxCopyLifetimeDays: unknown;
  retentionDays: unknown;
}): Promise<DeletionTaskRunResult> {
  const { maxCopyLifetimeDays, retentionDays, ...passOptions } = options;
  return runDeletionTasks({
    ...passOptions,
    maxCopyLifetimeMs: journalUntilFor(0, maxCopyLifetimeDays, retentionDays)?.getTime(),
    abortAfterMs: undecidedIntentAbortAfterMs(),
  });
}
