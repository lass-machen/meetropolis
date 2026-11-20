import fs from 'node:fs/promises';
import path from 'node:path';
import { assertLockHeld } from './tenantDeletionJournalLock.js';
import {
  CHECKPOINT_FILE,
  COMPACT_CHECKPOINT_FILE,
  COMPACT_JOURNAL_FILE,
  JOURNAL_FILE,
  loadJournalForWrite,
  sha256Hex,
  syncDirectoryBestEffort,
  withJournalLock,
  writeFileDurably,
} from './tenantDeletionJournal.js';
import type { JournalEntry, LoadedJournal } from './tenantDeletionJournal.js';

/**
 * Compacts the journal prefix that no longer has to be kept and removes the
 * files an interrupted compaction leaves behind. Every function here runs under
 * the journal writer lock.
 *
 * A compaction writes in four steps:
 * (a) the compact checkpoint, describing the kept suffix;
 * (b) the compact journal, holding only the kept suffix;
 * (c) the compact journal is renamed over the journal;
 * (d) the compact checkpoint is renamed over the checkpoint.
 * Steps (a) and (b) are durable before the first rename, so a rename never
 * exposes a file that is still unwritten. The journal is switched before the
 * checkpoint: between (c) and (d) the checkpoint file still describes the old
 * journal, which is gone, while the compact checkpoint describes the new journal
 * exactly. The loader adopts that compact checkpoint in this case, so a crash in
 * the window loses no kept entry. Reversing the renames would leave a checkpoint
 * that fits neither file and no copy the loader can adopt. A crash before (c)
 * leaves the old journal and checkpoint valid; the next writer removes the
 * leftovers.
 */

/** Journal state and the hash of its last line, read under the writer lock. */
export interface JournalSnapshot {
  entries: readonly JournalEntry[];
  endHead: string;
}

/** Reads all entries under the writer lock. Only a checkpoint roll-forward can write. */
export function readJournalSnapshot(journalDir: string): Promise<JournalSnapshot | null> {
  return withJournalLock(journalDir, async () => {
    const state = await loadJournalForWrite(journalDir);
    if (state === null) return null;
    return { entries: state.entries, endHead: state.endHead };
  });
}

/** Deletes the files of an interrupted compaction. They are never trusted. */
async function removeCompactFiles(journalDir: string): Promise<void> {
  await fs.rm(path.join(journalDir, COMPACT_JOURNAL_FILE), { force: true });
  await fs.rm(path.join(journalDir, COMPACT_CHECKPOINT_FILE), { force: true });
}

/**
 * Removes the files of an interrupted compaction under the writer lock. Returns
 * false and removes nothing when the journal is unavailable, because a compact
 * checkpoint may be the only copy that fits a journal that is already switched.
 */
export function removeCompactionLeftovers(journalDir: string): Promise<boolean> {
  return withJournalLock(journalDir, async () => {
    const state = await loadJournalForWrite(journalDir);
    if (state === null) return false;
    await removeCompactFiles(journalDir);
    await syncDirectoryBestEffort(journalDir);
    return true;
  });
}

/** Groups the positions of the entries by key, in journal order. */
function indexesByKey(entries: readonly JournalEntry[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const group = groups.get(entry.key) ?? [];
    group.push(index);
    groups.set(entry.key, group);
  });
  return groups;
}

/**
 * Finds the longest journal prefix that holds only removable keys completely.
 * The cut starts before the first line of a kept key and moves back while a
 * key still has lines on both sides of it, until no key straddles the cut.
 */
function removablePrefix(
  entries: readonly JournalEntry[],
  isRemovable: (key: string, entries: readonly JournalEntry[]) => boolean,
): { cut: number; removedKeys: string[] } {
  const groups = indexesByKey(entries);
  const kept = new Set<string>();
  for (const [key, indexes] of groups) {
    if (
      !isRemovable(
        key,
        indexes.map((index) => entries[index]),
      )
    )
      kept.add(key);
  }
  const firstKept = entries.findIndex((entry) => kept.has(entry.key));
  let cut = firstKept === -1 ? entries.length : firstKept;
  let moved = true;
  while (moved) {
    let next = cut;
    for (const indexes of groups.values()) {
      if (indexes[0] < cut && indexes[indexes.length - 1] >= cut) next = Math.min(next, indexes[0]);
    }
    moved = next < cut;
    cut = next;
  }
  const removedKeys = [...new Set(entries.slice(0, cut).map((entry) => entry.key))];
  return { cut, removedKeys };
}

/** Steps (a) and (b): the compact checkpoint first, then the kept suffix as compact journal. */
async function writeCompactCopies(journalDir: string, token: string, state: LoadedJournal, cut: number): Promise<void> {
  const { entries, lines, endHead } = state;
  const baseSeq = entries[cut - 1].seq;
  const baseHead = sha256Hex(lines[cut - 1]);
  const checkpoint =
    entries.length > cut ? { seq: entries[entries.length - 1].seq, head: endHead } : { seq: baseSeq, head: baseHead };
  await writeFileDurably(
    path.join(journalDir, COMPACT_CHECKPOINT_FILE),
    JSON.stringify({ v: 1, ...checkpoint, baseSeq, baseHead }),
  );
  await writeFileDurably(path.join(journalDir, COMPACT_JOURNAL_FILE), lines.slice(cut).join(''));
  await assertLockHeld(journalDir, token);
}

/** Steps (c) and (d): the journal is switched first, the checkpoint second. */
async function switchToCompactFiles(journalDir: string, token: string): Promise<void> {
  await fs.rename(path.join(journalDir, COMPACT_JOURNAL_FILE), path.join(journalDir, JOURNAL_FILE));
  await syncDirectoryBestEffort(journalDir);
  await assertLockHeld(journalDir, token);
  await fs.rename(path.join(journalDir, COMPACT_CHECKPOINT_FILE), path.join(journalDir, CHECKPOINT_FILE));
  await syncDirectoryBestEffort(journalDir);
}

/**
 * Drops the journal prefix whose keys are all removable, as decided by
 * `isRemovable(key, entries of that key)`. Leftovers of an earlier attempt are
 * removed first. Returns null, with nothing removed, when the journal is
 * unavailable. Writes no compact files when no prefix can be dropped.
 */
export function compactJournalPrefix(
  journalDir: string,
  isRemovable: (key: string, entries: readonly JournalEntry[]) => boolean,
): Promise<{ removedKeys: string[] } | null> {
  return withJournalLock(journalDir, async (token) => {
    const state = await loadJournalForWrite(journalDir);
    if (state === null) return null;
    await removeCompactFiles(journalDir);
    const { cut, removedKeys } = removablePrefix(state.entries, isRemovable);
    if (cut === 0) return { removedKeys };
    await writeCompactCopies(journalDir, token, state, cut);
    await switchToCompactFiles(journalDir, token);
    return { removedKeys };
  });
}
