import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * Writer lock of the tenant deletion journal directory: a lock directory
 * created atomically with mkdir, an owner token inside it, and takeover of
 * an orphaned lock only by rename plus token check.
 */

/** Lock directory of the journal; only one writer at a time. */
const LOCK_DIR_NAME = 'journal.lock';
/** File inside the lock directory that holds the token of the holder. */
const LOCK_OWNER_FILE = 'owner';
/** Longest a writer waits for the lock before the journal is unavailable. */
const LOCK_WAIT_MS = 10_000;
/** A lock that is older than this counts as orphaned. */
const LOCK_STALE_MS = 30_000;
/** Pause between two attempts to take the lock. */
const LOCK_POLL_MS = 50;

/** Thrown for any unreadable, unwritable or inconsistent journal state. */
export class JournalUnavailableError extends Error {
  constructor() {
    super('tenant deletion journal is unavailable');
    this.name = 'JournalUnavailableError';
  }
}

function lockDirPath(journalDir: string): string {
  return path.join(journalDir, LOCK_DIR_NAME);
}

function lockOwnerPath(lockDir: string): string {
  return path.join(lockDir, LOCK_OWNER_FILE);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads the owner token; a missing or unreadable file counts as empty. */
async function readOwnerToken(lockDir: string): Promise<string> {
  try {
    return await fs.readFile(lockOwnerPath(lockDir), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Creates the lock directory. The non-recursive mkdir is atomic, so exactly
 * one process wins. Returns false when the directory already exists; a
 * missing or unwritable journal directory leaves the journal unavailable.
 */
async function tryCreateLockDir(lockDir: string): Promise<boolean> {
  try {
    await fs.mkdir(lockDir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw new JournalUnavailableError();
  }
}

/** Writes the owner token of the holder and flushes it to disk. */
async function writeOwnerToken(lockDir: string, token: string): Promise<void> {
  const handle = await fs.open(lockOwnerPath(lockDir), 'w');
  try {
    await handle.writeFile(token, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Reads the modification time of the lock directory; null when it is gone. */
async function statLockDir(lockDir: string): Promise<{ mtimeMs: number } | null> {
  try {
    const stats = await fs.stat(lockDir);
    return { mtimeMs: stats.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new JournalUnavailableError();
  }
}

/**
 * Takes over a lock that has been orphaned for longer than the stale window.
 * The lock directory is renamed aside first; only when the owner file inside
 * the moved directory still holds the token that was judged stale, the moved
 * directory is removed. Every takeover is logged; a foreign lock is never
 * removed.
 */
async function takeOverStaleLock(lockDir: string, seen: string): Promise<boolean> {
  const moved = `${lockDir}.stale-${randomBytes(8).toString('hex')}`;
  try {
    await fs.rename(lockDir, moved);
  } catch {
    // Another process was faster and moved the lock itself.
    return false;
  }
  const movedOwner = await readOwnerToken(moved);
  if (movedOwner !== seen) {
    // Not the lock that was judged: back off, keep the directory and do not
    // move it back.
    return false;
  }
  logger.warn({ event: 'tenant_delete.journal_lock_taken_over' });
  // Only the directory that this process moved aside is removed.
  await fs.rm(moved, { recursive: true, force: true }).catch(() => undefined);
  return true;
}

/**
 * Takes the write lock of the journal directory and returns the owner token.
 * The lock is held until releaseLock is called. A lock that is older than the
 * stale window is taken over; otherwise the writer waits for the holder.
 */
export async function acquireLock(journalDir: string): Promise<string> {
  const lockDir = lockDirPath(journalDir);
  const token = `${process.pid}-${randomBytes(16).toString('hex')}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    if (await tryCreateLockDir(lockDir)) {
      try {
        await writeOwnerToken(lockDir, token);
      } catch {
        // The lock was created but cannot carry the owner token: remove the
        // own empty lock and report the journal as unavailable.
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
        throw new JournalUnavailableError();
      }
      return token;
    }
    const stats = await statLockDir(lockDir);
    if (stats === null) continue;
    if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
      const seen = await readOwnerToken(lockDir);
      if (await takeOverStaleLock(lockDir, seen)) continue;
    }
    // The deadline also bounds a takeover that keeps failing.
    if (Date.now() > deadline) throw new JournalUnavailableError();
    await sleep(LOCK_POLL_MS);
  }
}

/**
 * Checks that the lock is still held with the own token. Every other state
 * fails closed: the journal is unavailable.
 */
export async function assertLockHeld(journalDir: string, token: string): Promise<void> {
  const owner = await readOwnerToken(lockDirPath(journalDir));
  if (owner !== token) throw new JournalUnavailableError();
}

/**
 * Releases the lock. The lock directory is only removed when the owner file
 * still holds the own token; a foreign lock is never removed.
 */
export async function releaseLock(journalDir: string, token: string): Promise<void> {
  const lockDir = lockDirPath(journalDir);
  const owner = await readOwnerToken(lockDir);
  if (owner !== token) return;
  // A lock that cannot be removed stays behind and is taken over as stale
  // later; it must not mask the outcome of the append.
  await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
}
