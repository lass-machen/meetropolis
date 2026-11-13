import type { PrismaClient } from '../generated/prisma/index.js';
import { logger } from '../logger.js';
import type { JournalEntry } from './tenantDeletionJournal.js';
import { compactJournalPrefix, readJournalSnapshot } from './tenantDeletionJournalCompaction.js';
import { isRestorePending } from './tenantDeletionRestoreMarker.js';

/*
 * Removes journal keys that are past their copy lifetime, from the journal file and from the database.
 *
 * limit = now - maxCopyLifetimeMs. A line or row whose time equals the limit counts as expired.
 *
 * A key of the snapshot is removable in one of two ways:
 * - completed: the database row has status `completed` and completedAt <= limit (a key without a row
 *   needs only the file condition), the file holds at least one `completed` line, and every
 *   `completed` line has at <= limit.
 * - aborted: the file holds no `commit` and no `completed` line, its last line that is not `intent`
 *   is `abort` with at <= limit, and the database row is absent or has status `blocked`.
 * Other row statuses keep the key. Keys outside the snapshot are never removed, and a key whose line
 * count changed after the snapshot is kept for this pass.
 *
 * Order within one pass:
 * 1. delete the `blocked` rows of removable aborted keys,
 * 2. compact the journal prefix, which switches the journal file,
 * 3. delete the tasks and then the journal rows of the removed completed keys, and of completed rows
 *    past the limit whose key is missing from the snapshot, in one transaction.
 * Step 1 runs before the switch on purpose: if the switch fails, the abort lines remain without a row,
 * and the next pass removes them. An unavailable journal file ends the pass before step 3.
 */

/** How a key may leave the journal: its completion or its abort has passed the limit. */
type Verdict = 'completed' | 'aborted';

/** Completed rows without a snapshot key that one pass removes at most. */
const LEFTOVER_ROW_BATCH = 100;

function findRows(prisma: PrismaClient, keys: string[]) {
  return prisma.deletionJournal.findMany({
    where: { idempotencyKey: { in: keys } },
    select: { id: true, idempotencyKey: true, status: true, completedAt: true },
  });
}

type KeyRow = Awaited<ReturnType<typeof findRows>>[number];

/** Groups the journal lines by key, in journal order. */
function groupByKey(entries: readonly JournalEntry[]): Map<string, JournalEntry[]> {
  const groups = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.key) ?? [];
    group.push(entry);
    groups.set(entry.key, group);
  }
  return groups;
}

/** True when there is at least one `completed` line and every one of them is at or before the limit. */
function completedLinesExpired(lines: readonly JournalEntry[], limit: number): boolean {
  const completed = lines.filter((entry) => entry.type === 'completed');
  return completed.length > 0 && completed.every((entry) => Date.parse(entry.at) <= limit);
}

/** True when nothing was committed or completed and the last decision is an abort at or before the limit. */
function abortLinesExpired(lines: readonly JournalEntry[], limit: number): boolean {
  if (lines.some((entry) => entry.type === 'commit' || entry.type === 'completed')) return false;
  const decisions = lines.filter((entry) => entry.type !== 'intent');
  if (decisions.length === 0) return false;
  const last = decisions[decisions.length - 1];
  return last.type === 'abort' && Date.parse(last.at) <= limit;
}

/** The verdict of one key from its lines and its database row, or null when the key stays. */
function verdictFor(lines: readonly JournalEntry[], row: KeyRow | undefined, limit: number): Verdict | null {
  if (row === undefined) {
    if (completedLinesExpired(lines, limit)) return 'completed';
    return abortLinesExpired(lines, limit) ? 'aborted' : null;
  }
  if (row.status === 'completed') {
    const rowExpired = row.completedAt !== null && row.completedAt.getTime() <= limit;
    return rowExpired && completedLinesExpired(lines, limit) ? 'completed' : null;
  }
  if (row.status === 'blocked') return abortLinesExpired(lines, limit) ? 'aborted' : null;
  return null;
}

/** The verdicts of all snapshot keys that may leave the journal file. */
function decideVerdicts(groups: Map<string, JournalEntry[]>, rows: KeyRow[], limit: number): Map<string, Verdict> {
  const rowByKey = new Map(rows.map((row): [string, KeyRow] => [row.idempotencyKey, row]));
  const verdicts = new Map<string, Verdict>();
  for (const [key, lines] of groups) {
    const verdict = verdictFor(lines, rowByKey.get(key), limit);
    if (verdict !== null) verdicts.set(key, verdict);
  }
  return verdicts;
}

/**
 * Deletes the blocked rows of removable aborted keys before the journal file changes. A crash in
 * between leaves abort lines without a row, which the next pass removes.
 */
async function deleteBlockedRows(prisma: PrismaClient, verdicts: Map<string, Verdict>): Promise<void> {
  const keys = [...verdicts].filter(([, verdict]) => verdict === 'aborted').map(([key]) => key);
  if (keys.length === 0) return;
  await prisma.deletionJournal.deleteMany({ where: { idempotencyKey: { in: keys }, status: 'blocked' } });
}

/**
 * Deletes the tasks before the journal rows, in one transaction. The journal delete repeats the
 * status and time conditions of the verdict.
 */
function deleteJournalRows(prisma: PrismaClient, ids: string[], limit: number): Promise<void> {
  return prisma.$transaction(async (tx) => {
    await tx.deletionTask.deleteMany({ where: { journalId: { in: ids } } });
    await tx.deletionJournal.deleteMany({
      where: { id: { in: ids }, status: 'completed', completedAt: { lte: new Date(limit) } },
    });
  });
}

/** Ends a pass that a restore interrupted before its next deletion; returns the keys counted so far. */
function pausedForRestore(counted: number): number {
  logger.warn({ event: 'tenant_deletion.compaction_paused_for_restore' });
  return counted;
}

/**
 * Compacts the journal entries that are past their copy lifetime and deletes the matching database
 * rows. Returns the number of keys whose file lines or database rows were removed in this pass.
 * An unavailable journal file logs `tenant_deletion.journal_unavailable` and removes nothing.
 * While a restore is pending, the pass logs `tenant_deletion.compaction_paused_for_restore` and stops
 * before its next deletion. The marker is checked before each deletion block; a pass stopped this way
 * returns the keys removed so far.
 */
export async function compactExpiredJournals(
  prisma: PrismaClient,
  journalDir: string,
  now: Date,
  maxCopyLifetimeMs: number,
): Promise<number> {
  if (await isRestorePending(journalDir)) return pausedForRestore(0);
  const limit = now.getTime() - maxCopyLifetimeMs;
  const snapshot = await readJournalSnapshot(journalDir);
  if (snapshot === null) {
    logger.warn({ event: 'tenant_deletion.journal_unavailable', code: 'snapshot_unavailable' });
    return 0;
  }
  const groups = groupByKey(snapshot.entries);
  const rows = await findRows(prisma, [...groups.keys()]);
  const verdicts = decideVerdicts(groups, rows, limit);
  if (await isRestorePending(journalDir)) return pausedForRestore(0);
  await deleteBlockedRows(prisma, verdicts);
  if (await isRestorePending(journalDir)) return pausedForRestore(0);
  const compacted = await compactJournalPrefix(
    journalDir,
    (key, entries) => verdicts.has(key) && groups.get(key)?.length === entries.length,
  );
  if (compacted === null) {
    logger.warn({ event: 'tenant_deletion.journal_unavailable', code: 'compaction_unavailable' });
    return 0;
  }
  const removed = new Set(compacted.removedKeys);
  const rowIds = rows
    .filter((row) => row.status === 'completed' && removed.has(row.idempotencyKey))
    .map((row) => row.id);
  const leftovers = await prisma.deletionJournal.findMany({
    where: {
      status: 'completed',
      completedAt: { lte: new Date(limit) },
      idempotencyKey: { notIn: [...groups.keys()] },
    },
    select: { id: true },
    take: LEFTOVER_ROW_BATCH,
  });
  const ids = [...rowIds, ...leftovers.map((row) => row.id)];
  if (ids.length > 0) {
    if (await isRestorePending(journalDir)) return pausedForRestore(compacted.removedKeys.length);
    await deleteJournalRows(prisma, ids, limit);
  }
  return compacted.removedKeys.length + leftovers.length;
}
