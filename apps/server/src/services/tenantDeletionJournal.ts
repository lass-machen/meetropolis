import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { JournalUnavailableError, acquireLock, assertLockHeld, releaseLock } from './tenantDeletionJournalLock.js';
import { fenceUndecidedIntent } from './tenantDeletionFence.js';
import { isRestorePending } from './tenantDeletionRestoreMarker.js';

export { JournalUnavailableError } from './tenantDeletionJournalLock.js';

/**
 * File adapter for the tenant deletion journal.
 *
 * The journal directory holds `journal.jsonl` (one entry per line, UTF-8,
 * newline-terminated) and `checkpoint.json` (sequence and hash of the last
 * line, written atomically via a temp file and rename). Every append is
 * flushed to disk before the caller continues, so a recorded intent survives
 * a crash and an undecided intent can later be reconciled against the
 * database. Entries carry only opaque identifiers, never names, mails,
 * slugs, tokens or error texts.
 */

export const JOURNAL_FILE = 'journal.jsonl';
export const CHECKPOINT_FILE = 'checkpoint.json';
export const COMPACT_JOURNAL_FILE = 'journal.jsonl.compact';
export const COMPACT_CHECKPOINT_FILE = 'checkpoint.compact.json';
const CHECKPOINT_TMP_FILE = 'checkpoint.json.tmp';

/** Previous-hash of the first entry when no checkpoint exists yet. */
export const ZERO_HEAD = '0'.repeat(64);

const HEX64 = /^[0-9a-f]{64}$/;

export type JournalEntryType = 'intent' | 'commit' | 'abort' | 'completed';

export interface JournalEntry {
  seq: number;
  prev: string;
  type: JournalEntryType;
  key: string;
  tenantRef: string;
  accountRef?: string;
  at: string;
  journalUntil?: string;
}

interface Checkpoint {
  seq: number;
  head: string;
  baseSeq: number;
  baseHead: string;
}

export interface LoadedJournal {
  entries: JournalEntry[];
  checkpoint: Checkpoint;
  /** Complete, chained lines behind the checkpoint, left by a crash. */
  trailing: JournalEntry[];
  /** Hash of the last line, or the base head of an empty journal. */
  endHead: string;
  /** Raw lines including their newline, in the same order as `entries`. */
  lines: string[];
}

export function sha256Hex(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/** Serializes with a fixed field order so the file layout stays stable. */
function serializeEntry(entry: JournalEntry): string {
  const record: Record<string, unknown> = {
    v: 1,
    seq: entry.seq,
    prev: entry.prev,
    type: entry.type,
    key: entry.key,
    ...journalRefs(entry),
    at: entry.at,
  };
  if (entry.type === 'intent') record.journalUntil = entry.journalUntil;
  return `${JSON.stringify(record)}\n`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidDateString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

/** One reference per line: a tenant (tenantRef set, no accountRef) or an account (tenantRef empty, accountRef). */
function hasSingleJournalRef(tenantRef: string, accountRef: unknown): accountRef is string | undefined {
  if (tenantRef !== '') return accountRef === undefined;
  return typeof accountRef === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(accountRef);
}

/** Reference fields of a journal line; accountRef is included only when set. */
export function journalRefs(entry: { tenantRef: string; accountRef?: string }): {
  tenantRef: string;
  accountRef?: string;
} {
  if (entry.accountRef === undefined) return { tenantRef: entry.tenantRef };
  return { tenantRef: entry.tenantRef, accountRef: entry.accountRef };
}

/** Strict parse; returns null for a malformed line. */
function parseEntry(line: string): JournalEntry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const { seq, prev, type, key, tenantRef, accountRef, at, journalUntil } = record;
  if (record.v !== 1 || !Number.isInteger(seq) || (seq as number) <= 0) return null;
  if (typeof prev !== 'string' || !HEX64.test(prev)) return null;
  if (type !== 'intent' && type !== 'commit' && type !== 'abort' && type !== 'completed') return null;
  if (!isNonEmptyString(key) || !isValidDateString(at)) return null;
  if (typeof tenantRef !== 'string' || !hasSingleJournalRef(tenantRef, accountRef)) return null;
  if (type === 'intent') {
    if (!isValidDateString(journalUntil)) return null;
    return { seq: seq as number, prev, type, key, ...journalRefs({ tenantRef, accountRef }), at, journalUntil };
  }
  if (journalUntil !== undefined) return null;
  return { seq: seq as number, prev, type, key, ...journalRefs({ tenantRef, accountRef }), at };
}

function parseCheckpoint(parsed: unknown): Checkpoint | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const { seq, head, baseSeq, baseHead } = record;
  if (record.v !== 1) return null;
  if (!Number.isInteger(seq) || (seq as number) < 0) return null;
  if (!Number.isInteger(baseSeq) || (baseSeq as number) < 0 || (seq as number) < (baseSeq as number)) {
    return null;
  }
  if (typeof head !== 'string' || !HEX64.test(head)) return null;
  if (typeof baseHead !== 'string' || !HEX64.test(baseHead)) return null;
  return { seq: seq as number, head, baseSeq: baseSeq as number, baseHead };
}

/** Parses checkpoint.json content; null when it is not JSON or not a valid checkpoint. */
function parseCheckpointText(raw: string): Checkpoint | null {
  try {
    return parseCheckpoint(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Checks complete lines against a checkpoint. Without a checkpoint only an empty
 * journal fits, starting from the zero base. Returns null when the chain does not
 * run gap-free from the checkpoint base or the checkpoint is not on that chain.
 */
function verifyJournalText(journalText: string, checkpoint: Checkpoint | null): LoadedJournal | null {
  if (checkpoint === null && journalText !== '') return null;
  if (journalText !== '' && !journalText.endsWith('\n')) return null;
  const lines =
    journalText === ''
      ? []
      : journalText
          .slice(0, -1)
          .split('\n')
          .map((body) => `${body}\n`);
  const base = checkpoint ?? { seq: 0, head: ZERO_HEAD, baseSeq: 0, baseHead: ZERO_HEAD };
  const entries: JournalEntry[] = [];
  const heads: string[] = [base.baseHead];
  for (let index = 0; index < lines.length; index += 1) {
    const entry = parseEntry(lines[index].slice(0, -1));
    if (entry === null || entry.seq !== base.baseSeq + index + 1 || entry.prev !== heads[index]) return null;
    if (entry.accountRef !== undefined && serializeEntry(entry) !== lines[index]) return null;
    entries.push(entry);
    heads.push(sha256Hex(lines[index]));
  }
  // After a crash between the durable line and the checkpoint rename the
  // checkpoint lags behind; it must never point past the end or at another head.
  const position = base.seq - base.baseSeq;
  if (position > entries.length || base.head !== heads[position]) return null;
  return { entries, checkpoint: base, trailing: entries.slice(position), endHead: heads[entries.length], lines };
}

/** Reads the compact checkpoint of an interrupted compaction; null when missing or malformed. */
async function readCompactCheckpoint(journalDir: string): Promise<Checkpoint | null> {
  try {
    const raw = await fs.readFile(path.join(journalDir, COMPACT_CHECKPOINT_FILE), 'utf8');
    return parseCheckpoint(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Loads and validates the journal without writing it, except to adopt a compact
 * checkpoint. Only call it while holding the journal lock, because the adoption
 * renames a file. Returns null when the
 * directory is missing, not a directory, or not writable for its owner — the
 * permission check is explicit so read-only directories stay unavailable even
 * for privileged processes. A leftover checkpoint temp file is ignored and
 * removed. The chain must run gap-free from the checkpoint base, and the
 * checkpoint must point at a line of that chain; complete lines behind it are
 * returned as `trailing`. A torn or unparseable last line is never repaired.
 */
export async function loadJournal(journalDir: string): Promise<LoadedJournal | null> {
  let dirStat;
  try {
    dirStat = await fs.stat(journalDir);
  } catch {
    return null;
  }
  if (!dirStat.isDirectory() || (dirStat.mode & 0o200) === 0) return null;
  // A crashed checkpoint rewrite leaves only the temp file behind; it never
  // carries authority and is dropped on every load.
  await fs.rm(path.join(journalDir, CHECKPOINT_TMP_FILE), { force: true }).catch(() => undefined);
  let journalText: string;
  try {
    journalText = await fs.readFile(path.join(journalDir, JOURNAL_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    journalText = '';
  }
  let checkpoint: Checkpoint | null | undefined;
  try {
    checkpoint = parseCheckpointText(await fs.readFile(path.join(journalDir, CHECKPOINT_FILE), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
  }
  // A missing checkpoint means the zero base. A present one that is unparseable or invalid never
  // counts as that base: only the compact checkpoint below may take over.
  const state = checkpoint === null ? null : verifyJournalText(journalText, checkpoint ?? null);
  if (state !== null) return state;
  // A compaction that crashed between its two renames leaves the new journal
  // behind the old checkpoint. The compact checkpoint describes exactly that
  // journal, so it takes over; otherwise the journal stays unavailable.
  const compact = await readCompactCheckpoint(journalDir);
  const adopted = compact === null ? null : verifyJournalText(journalText, compact);
  if (adopted === null) return null;
  await fs.rename(path.join(journalDir, COMPACT_CHECKPOINT_FILE), path.join(journalDir, CHECKPOINT_FILE));
  await syncDirectoryBestEffort(journalDir);
  return adopted;
}

/** Writes a file and flushes its content to disk before returning. */
export async function writeFileDurably(filePath: string, content: string): Promise<void> {
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Flushes directory entries (created or renamed files) to disk. Best effort:
 * a directory that cannot be opened is skipped without an error.
 */
export async function syncDirectoryBestEffort(dir: string): Promise<void> {
  await fs.open(dir, 'r').then(
    async (handle) => {
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    () => undefined,
  );
}

/** Writes the checkpoint atomically: temp file, flush, rename, directory flush. */
async function writeCheckpoint(journalDir: string, checkpoint: Checkpoint): Promise<void> {
  const tmpPath = path.join(journalDir, CHECKPOINT_TMP_FILE);
  await writeFileDurably(tmpPath, JSON.stringify({ v: 1, ...checkpoint }));
  await fs.rename(tmpPath, path.join(journalDir, CHECKPOINT_FILE));
  await syncDirectoryBestEffort(journalDir);
}

/**
 * Loads the journal for a writer that holds the lock. Complete lines behind
 * the checkpoint are durable already, so the checkpoint moves forward to the
 * last of them before anything new is appended.
 */
export async function loadJournalForWrite(journalDir: string): Promise<LoadedJournal | null> {
  const state = await loadJournal(journalDir);
  if (state === null || state.trailing.length === 0) return state;
  const checkpoint: Checkpoint = {
    seq: state.checkpoint.seq + state.trailing.length,
    head: state.endHead,
    baseSeq: state.checkpoint.baseSeq,
    baseHead: state.checkpoint.baseHead,
  };
  await writeCheckpoint(journalDir, checkpoint);
  logger.warn({ event: 'tenant_delete.journal_checkpoint_rolled_forward', count: state.trailing.length });
  return { ...state, checkpoint, trailing: [] };
}

/** Serializes journal writers within one process so sequences stay gap-free. */
let appendChain: Promise<unknown> = Promise.resolve();

function enqueueAppend<T>(task: () => Promise<T>): Promise<T> {
  const run = appendChain.then(task);
  appendChain = run.catch(() => undefined);
  return run;
}

/** Runs a writer task in the process chain and under the directory lock. */
export function withJournalLock<T>(journalDir: string, task: (token: string) => Promise<T>): Promise<T> {
  return enqueueAppend(async () => {
    const token = await acquireLock(journalDir);
    try {
      return await task(token);
    } finally {
      await releaseLock(journalDir, token);
    }
  });
}

/** Append body for a writer that already holds the lock with `token`. */
async function appendLocked(journalDir: string, token: string, entry: JournalEntry): Promise<void> {
  const state = await loadJournalForWrite(journalDir);
  if (state === null) throw new JournalUnavailableError();
  const line = serializeEntry({ ...entry, seq: state.checkpoint.seq + 1, prev: state.checkpoint.head });
  // The lock must be held before the line and before the checkpoint moves.
  await assertLockHeld(journalDir, token);
  const handle = await fs.open(path.join(journalDir, JOURNAL_FILE), 'a');
  try {
    await handle.writeFile(line, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await assertLockHeld(journalDir, token);
  await writeCheckpoint(journalDir, {
    seq: state.checkpoint.seq + 1,
    head: sha256Hex(line),
    baseSeq: state.checkpoint.baseSeq,
    baseHead: state.checkpoint.baseHead,
  });
}

export interface JournalAppendInput {
  type: JournalEntryType;
  key: string;
  tenantRef: string;
  accountRef?: string;
  at: string;
  journalUntil?: string;
}

/** Appends one entry and moves the checkpoint to it, both durable. A rejected entry never reaches the lock. */
export async function appendJournalEntry(journalDir: string, input: JournalAppendInput): Promise<void> {
  const untilOk = input.accountRef === undefined || (input.type === 'intent') === (input.journalUntil !== undefined);
  if (!hasSingleJournalRef(input.tenantRef, input.accountRef) || !untilOk) throw new Error('invalid journal entry');
  await withJournalLock(journalDir, (token) => appendLocked(journalDir, token, { seq: 0, prev: '', ...input }));
}

/**
 * Checks under the writer lock that the journal accepts the next entry and
 * rolls a lagging checkpoint forward. False for an invalid journal state.
 */
export function prepareJournalForWrite(journalDir: string): Promise<boolean> {
  return withJournalLock(journalDir, async () => (await loadJournalForWrite(journalDir)) !== null);
}

export function createIdempotencyKey(): string {
  return randomUUID();
}

/**
 * Parses the raw retention-days setting. Only whole numbers from 1 to 13 are
 * valid: with daily backups a copy then lives at most 14 days, the maximum copy
 * lifetime the journal relies on. Anything else (including missing values)
 * yields undefined so the caller stays unavailable instead of inventing a default.
 */
export function parseRetentionDays(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 1 || value > 13) return undefined;
    return value;
  }
  if (typeof value === 'string') {
    if (!/^(?:[1-9]|1[0-3])$/.test(value.trim())) return undefined;
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

export interface PendingDeletionOutcome {
  journalDir: string;
  key: string;
  tenantRef: string;
  accountRef?: string;
  /** Copy-lifetime limit of the intent (ISO time), needed by the fence. */
  journalUntil: string;
}

const pendingOutcomes = new Map<string, PendingDeletionOutcome[]>();

/** Remembers a written intent until the database transaction settles. */
export function notePendingDeletionOutcome(tenantId: string, outcome: PendingDeletionOutcome): void {
  const existing = pendingOutcomes.get(tenantId) ?? [];
  existing.push(outcome);
  pendingOutcomes.set(tenantId, existing);
}

/** Takes the oldest remembered intent for a tenant, if one exists. */
export function takePendingDeletionOutcome(tenantId: string): PendingDeletionOutcome | undefined {
  const existing = pendingOutcomes.get(tenantId);
  const next = existing?.shift();
  if (existing !== undefined && existing.length === 0) pendingOutcomes.delete(tenantId);
  return next;
}

export interface UndecidedIntentCounts {
  committed: number;
  aborted: number;
  open: number;
}

/** Keys that already have an outcome entry, that is anything but an intent. */
function decidedKeys(entries: readonly JournalEntry[]): Set<string> {
  const decided = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== 'intent') decided.add(entry.key);
  }
  return decided;
}

/** An intent together with its copy-lifetime limit, which the fence needs. */
type OpenIntent = JournalEntry & { journalUntil: string };

/** Intents of the journal that have no outcome entry yet, once per key. */
function undecidedIntents(entries: readonly JournalEntry[]): OpenIntent[] {
  const decided = decidedKeys(entries);
  const seen = new Set<string>();
  return entries.filter((entry): entry is OpenIntent => {
    if (entry.type !== 'intent' || entry.journalUntil === undefined) return false;
    if (decided.has(entry.key) || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

type IntentDecision = 'commit' | 'abort' | 'open';

/** Whether the database row of the key has a deletion time. Undefined when the database cannot answer. */
async function databaseDeletedAt(prisma: PrismaClient, key: string): Promise<boolean | undefined> {
  try {
    const row = await prisma.deletionJournal.findFirst({
      where: { idempotencyKey: key },
      select: { dbDeletedAt: true },
    });
    return Boolean(row?.dbDeletedAt);
  } catch {
    return undefined;
  }
}

/**
 * Decides one intent without the writer lock: a deletion time commits it. While a restore is pending,
 * an intent without deletion time stays open and is never fenced. Otherwise an intent younger than
 * `abortAfterMs` stays open, and anything older is fenced.
 */
async function decideIntent(
  prisma: PrismaClient,
  intent: OpenIntent,
  now: Date,
  abortAfterMs: number,
  journalDir: string,
): Promise<IntentDecision> {
  const deleted = await databaseDeletedAt(prisma, intent.key);
  if (deleted === undefined) return 'open';
  if (deleted) return 'commit';
  if (now.getTime() - Date.parse(intent.at) < abortAfterMs) return 'open';
  // Read right before the fence: a restore that starts during the pass keeps the intent open.
  if (await isRestorePending(journalDir)) return 'open';
  return fenceUndecidedIntent(prisma, { key: intent.key, journalUntil: intent.journalUntil });
}

/**
 * Decides intents without an outcome, for example after a crash between the file and the database.
 * The writer lock covers file access only: open intents are read under it, decided without it, and
 * appended under it after a fresh reload, skipping keys decided meanwhile. A database error keeps an intent open.
 * A restore marker is checked right before each fence and each abort; while it is pending, only commits are decided.
 */
export async function decideJournalIntents(options: {
  prisma: PrismaClient;
  journalDir: string;
  now: Date;
  abortAfterMs: number;
}): Promise<UndecidedIntentCounts> {
  const { prisma, journalDir, now, abortAfterMs } = options;
  const intents = await withJournalLock(journalDir, async () => {
    const state = await loadJournalForWrite(journalDir);
    if (state === null) throw new JournalUnavailableError();
    return undecidedIntents(state.entries);
  });
  const counts: UndecidedIntentCounts = { committed: 0, aborted: 0, open: 0 };
  const decisions: { intent: OpenIntent; outcome: 'commit' | 'abort' }[] = [];
  for (const intent of intents) {
    const decision = await decideIntent(prisma, intent, now, abortAfterMs, journalDir);
    if (decision === 'open') counts.open += 1;
    else decisions.push({ intent, outcome: decision });
  }
  if (decisions.length === 0) return counts;
  return withJournalLock(journalDir, async (token) => {
    const state = await loadJournalForWrite(journalDir);
    if (state === null) throw new JournalUnavailableError();
    const decided = decidedKeys(state.entries);
    for (const { intent, outcome } of decisions) {
      if (decided.has(intent.key)) continue;
      if (outcome === 'abort' && (await isRestorePending(journalDir))) {
        counts.open += 1;
        continue;
      }
      await appendLocked(journalDir, token, {
        seq: 0,
        prev: '',
        type: outcome,
        key: intent.key,
        ...journalRefs(intent),
        at: now.toISOString(),
      });
      if (outcome === 'commit') counts.committed += 1;
      else counts.aborted += 1;
    }
    return counts;
  });
}

/** Writes the commit for a known intent. Never throws. */
export async function recordPendingOutcome(pending: PendingDeletionOutcome): Promise<void> {
  try {
    await appendJournalEntry(pending.journalDir, {
      type: 'commit',
      key: pending.key,
      ...journalRefs(pending),
      at: new Date().toISOString(),
    });
  } catch {
    // A missing outcome is healed by the next reconciliation.
  }
}

/**
 * Records the transaction outcome for a remembered intent. Never throws:
 * the database already decided, and a missing outcome is healed by the next
 * reconciliation.
 */
export async function recordDeletionOutcome(tenantId: string, _outcome: 'commit'): Promise<void> {
  const pending = takePendingDeletionOutcome(tenantId);
  if (pending === undefined) return;
  await recordPendingOutcome(pending);
}

/**
 * Records the outcome after a failed database transaction. The error may have been raised after the
 * COMMIT was sent, so the database decides first: a recorded deletion time commits the intent.
 * Otherwise the fence decides, unless a restore is pending. An open intent is left for reconciliation. Never throws.
 */
export async function recordDeletionFailure(prisma: PrismaClient, tenantId: string): Promise<void> {
  const pending = takePendingDeletionOutcome(tenantId);
  if (pending === undefined) return;
  await recordPendingFailure(prisma, pending);
}

/** Failure outcome for a known intent; recordDeletionFailure delegates here after its take. */
export async function recordPendingFailure(prisma: PrismaClient, pending: PendingDeletionOutcome): Promise<void> {
  const outcome = await failedIntentOutcome(prisma, pending);
  if (outcome === 'open' || (outcome === 'abort' && (await isRestorePending(pending.journalDir)))) {
    logger.warn({ event: 'tenant_deletion.intent_left_open' });
    return;
  }
  try {
    await appendJournalEntry(pending.journalDir, {
      type: outcome,
      key: pending.key,
      ...journalRefs(pending),
      at: new Date().toISOString(),
    });
  } catch {
    // A missing outcome is healed by the next reconciliation.
  }
}

/** Database row first. Then the fence decides, unless a restore is pending: the intent stays open. */
async function failedIntentOutcome(prisma: PrismaClient, pending: PendingDeletionOutcome): Promise<IntentDecision> {
  if ((await databaseDeletedAt(prisma, pending.key)) === true) return 'commit';
  if (await isRestorePending(pending.journalDir)) return 'open';
  return fenceUndecidedIntent(prisma, { key: pending.key, journalUntil: pending.journalUntil });
}
