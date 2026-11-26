import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Restore marker for the tenant deletion journal.
 *
 * `scripts/restore.sh` writes `restore-pending.json` into the journal
 * directory before it touches the database. While the marker is present the
 * restored database is older than the journal: no open intent may be decided
 * from a missing database row and the journal must not be compacted. Only
 * the restore replay tool removes the marker, as its last step.
 *
 * The marker carries no tenant reference. A marker that exists but cannot be
 * read counts as present (fail closed); only a missing file means no marker.
 */

export const RESTORE_PENDING_FILE = 'restore-pending.json';

export interface RestorePendingMarker {
  v: 1;
  /** ISO time at which the marker was written. */
  createdAt: string;
  /** Creation time of the restored copy in epoch seconds, null if unknown. */
  copyCreatedAt: number | null;
  /** Sequence of the last journal line when the marker was written, null if unknown. */
  journalSeq: number | null;
}

export class RestorePendingUnreadableError extends Error {
  readonly code = 'restore_pending_unreadable';

  constructor() {
    super('restore marker present but unreadable');
    this.name = 'RestorePendingUnreadableError';
  }
}

function markerPath(journalDir: string): string {
  return path.join(journalDir, RESTORE_PENDING_FILE);
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT';
}

/** True while a restore replay is pending; any error other than ENOENT counts as pending. */
export async function isRestorePending(journalDir: string): Promise<boolean> {
  try {
    await fs.lstat(markerPath(journalDir));
    return true;
  } catch (error) {
    return !isMissing(error);
  }
}

function readCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  return undefined;
}

function parseMarker(raw: string): RestorePendingMarker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RestorePendingUnreadableError();
  }
  if (typeof parsed !== 'object' || parsed === null) throw new RestorePendingUnreadableError();
  const record = parsed as Record<string, unknown>;
  const createdAt = record.createdAt;
  const copyCreatedAt = readCount(record.copyCreatedAt);
  const journalSeq = readCount(record.journalSeq);
  if (
    record.v !== 1 ||
    typeof createdAt !== 'string' ||
    Number.isNaN(Date.parse(createdAt)) ||
    copyCreatedAt === undefined ||
    journalSeq === undefined
  ) {
    throw new RestorePendingUnreadableError();
  }
  return { v: 1, createdAt, copyCreatedAt, journalSeq };
}

/**
 * Reads the marker. Returns null when no marker exists and throws
 * RestorePendingUnreadableError when a marker exists but is not a regular
 * file with valid content.
 */
export async function readRestorePending(journalDir: string): Promise<RestorePendingMarker | null> {
  const file = markerPath(journalDir);
  let raw: string;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) throw new RestorePendingUnreadableError();
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    if (error instanceof RestorePendingUnreadableError) throw error;
    throw new RestorePendingUnreadableError();
  }
  return parseMarker(raw);
}

/** Removes the marker; a missing marker is fine. */
export async function clearRestorePending(journalDir: string): Promise<void> {
  try {
    await fs.unlink(markerPath(journalDir));
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  // Makes the removal durable before the caller reports success. As for the
  // journal checkpoint, a directory that cannot be opened is skipped; a
  // failed sync is reported to the caller.
  await fs.open(journalDir, 'r').then(
    async (dir) => {
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    },
    () => undefined,
  );
}
