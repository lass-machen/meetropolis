import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_FILE,
  COMPACT_CHECKPOINT_FILE,
  COMPACT_JOURNAL_FILE,
  JOURNAL_FILE,
  appendJournalEntry,
  loadJournal,
} from './tenantDeletionJournal.js';
import type { JournalEntryType, LoadedJournal } from './tenantDeletionJournal.js';
import {
  compactJournalPrefix,
  readJournalSnapshot,
  removeCompactionLeftovers,
} from './tenantDeletionJournalCompaction.js';

const TENANT_REF = 'tenant-ref-1';
const KEY_A = 'deletion-key-a';
const KEY_B = 'deletion-key-b';
const KEY_X = 'deletion-key-x';
const AT = '2026-03-01T10:00:00.000Z';
const JOURNAL_UNTIL = '2026-03-02T10:00:00.000Z';
const LIFECYCLE: JournalEntryType[] = ['intent', 'commit', 'completed'];
const PAIR: JournalEntryType[] = ['intent', 'commit'];

interface JournalPaths {
  journal: string;
  checkpoint: string;
  compactJournal: string;
  compactCheckpoint: string;
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createJournalDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenant-journal-compaction-'));
  createdDirs.push(dir);
  return dir;
}

function journalPaths(dir: string): JournalPaths {
  return {
    journal: path.join(dir, JOURNAL_FILE),
    checkpoint: path.join(dir, CHECKPOINT_FILE),
    compactJournal: path.join(dir, COMPACT_JOURNAL_FILE),
    compactCheckpoint: path.join(dir, COMPACT_CHECKPOINT_FILE),
  };
}

/** Appends the entries of one key through the production writer, in the given order. */
async function appendEntries(dir: string, key: string, types: JournalEntryType[]): Promise<void> {
  for (const type of types) {
    await appendJournalEntry(dir, {
      type,
      key,
      tenantRef: TENANT_REF,
      at: AT,
      ...(type === 'intent' ? { journalUntil: JOURNAL_UNTIL } : {}),
    });
  }
}

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Splits journal text into lines, each line keeping its trailing newline. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n/g) ?? [];
}

/** Expected hash of a journal line, computed here and not with the product code. */
function expectedLineHash(line: string): string {
  return createHash('sha256').update(line, 'utf8').digest('hex');
}

async function loadRequired(dir: string): Promise<LoadedJournal> {
  const state = await loadJournal(dir);
  if (state === null) throw new Error('journal is not loadable');
  return state;
}

describe('compactJournalPrefix', () => {
  it('drops a removable key prefix and keeps the remaining lines byte-identical', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    await appendEntries(dir, KEY_B, PAIR);
    const before = await loadRequired(dir);
    const originalLines = splitLines(await readText(paths.journal));
    expect(originalLines).toHaveLength(5);

    const result = await compactJournalPrefix(dir, (key) => key === KEY_A);

    expect(result).toEqual({ removedKeys: [KEY_A] });
    expect(await readText(paths.journal)).toBe(originalLines.slice(3).join(''));
    const after = await loadRequired(dir);
    expect(after.entries.map((entry) => entry.key)).toEqual([KEY_B, KEY_B]);
    expect(after.checkpoint).toEqual({
      seq: before.checkpoint.seq,
      head: before.checkpoint.head,
      baseSeq: 3,
      baseHead: expectedLineHash(originalLines[2]),
    });
    expect(await exists(paths.compactJournal)).toBe(false);
    expect(await exists(paths.compactCheckpoint)).toBe(false);
  });

  it('leaves both files untouched when the first journal key is kept', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    await appendEntries(dir, KEY_B, PAIR);
    const journalBefore = await readText(paths.journal);
    const checkpointBefore = await readText(paths.checkpoint);

    const result = await compactJournalPrefix(dir, (key) => key === KEY_B);

    expect(result).toEqual({ removedKeys: [] });
    expect(await readText(paths.journal)).toBe(journalBefore);
    expect(await readText(paths.checkpoint)).toBe(checkpointBefore);
    expect(await exists(paths.compactJournal)).toBe(false);
    expect(await exists(paths.compactCheckpoint)).toBe(false);
  });

  it('keeps a removable key that still has a line behind a kept key', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, ['intent']);
    await appendEntries(dir, KEY_B, ['intent']);
    await appendEntries(dir, KEY_A, ['commit']);
    const journalBefore = await readText(paths.journal);
    const checkpointBefore = await readText(paths.checkpoint);

    const result = await compactJournalPrefix(dir, (key) => key === KEY_A);

    expect(result).toEqual({ removedKeys: [] });
    expect(await readText(paths.journal)).toBe(journalBefore);
    expect(await readText(paths.checkpoint)).toBe(checkpointBefore);
    expect(await exists(paths.compactJournal)).toBe(false);
  });
});

describe('compactJournalPrefix on a fully removable journal', () => {
  it('empties the journal and keeps the chain appendable from the new base', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    const originalLines = splitLines(await readText(paths.journal));

    const result = await compactJournalPrefix(dir, (key) => key === KEY_A);

    expect(result).toEqual({ removedKeys: [KEY_A] });
    expect(await readText(paths.journal)).toBe('');
    const emptied = await loadRequired(dir);
    expect(emptied.entries).toHaveLength(0);
    expect(emptied.checkpoint.baseSeq).toBe(3);
    expect(emptied.checkpoint.seq).toBe(emptied.checkpoint.baseSeq);
    expect(emptied.checkpoint.baseHead).toBe(expectedLineHash(originalLines[2]));
    expect(emptied.checkpoint.head).toBe(emptied.checkpoint.baseHead);

    await appendEntries(dir, KEY_B, ['intent']);

    const appended = await loadRequired(dir);
    expect(appended.entries).toHaveLength(1);
    expect(appended.entries[0]).toMatchObject({
      seq: emptied.checkpoint.baseSeq + 1,
      prev: emptied.checkpoint.baseHead,
      key: KEY_B,
    });
    expect(appended.checkpoint.baseSeq).toBe(3);
  });
});

describe('readJournalSnapshot after an interrupted compaction', () => {
  it('adopts the compact checkpoint after a crash between the two renames', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    await appendEntries(dir, KEY_B, PAIR);
    const oldCheckpoint = await readText(paths.checkpoint);
    await compactJournalPrefix(dir, (key) => key === KEY_A);
    // The compaction ran to completion. Rebuild the state of a crash after the
    // journal rename: the new checkpoint is back in its compact file, the old one is restored.
    const compactedJournal = await readText(paths.journal);
    const compactCheckpoint = await readText(paths.checkpoint);
    await fs.writeFile(paths.checkpoint, oldCheckpoint);
    await fs.writeFile(paths.compactCheckpoint, compactCheckpoint);

    const snapshot = await readJournalSnapshot(dir);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.entries.map((entry) => entry.key)).toEqual([KEY_B, KEY_B]);
    const lines = splitLines(compactedJournal);
    expect(snapshot?.endHead).toBe(expectedLineHash(lines[lines.length - 1]));
    expect(await readText(paths.checkpoint)).toBe(compactCheckpoint);
    expect(await exists(paths.compactCheckpoint)).toBe(false);
    expect(await readText(paths.journal)).toBe(compactedJournal);
  });
});

describe('removeCompactionLeftovers', () => {
  it('ignores a stale compact checkpoint next to a valid checkpoint and removes both leftovers', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    const staleCheckpoint = await readText(paths.checkpoint);
    await appendEntries(dir, KEY_B, PAIR);
    await fs.writeFile(paths.compactCheckpoint, staleCheckpoint);
    await fs.copyFile(paths.journal, paths.compactJournal);
    const journalBefore = await readText(paths.journal);
    const checkpointBefore = await readText(paths.checkpoint);

    const snapshot = await readJournalSnapshot(dir);

    expect(snapshot?.entries).toHaveLength(5);
    expect(await readText(paths.checkpoint)).toBe(checkpointBefore);
    expect(await exists(paths.compactCheckpoint)).toBe(true);

    expect(await removeCompactionLeftovers(dir)).toBe(true);
    expect(await exists(paths.compactCheckpoint)).toBe(false);
    expect(await exists(paths.compactJournal)).toBe(false);
    expect(await readText(paths.journal)).toBe(journalBefore);
    expect(await readText(paths.checkpoint)).toBe(checkpointBefore);
  });

  it('keeps everything in place when neither checkpoint fits the journal', async () => {
    const dir = await createJournalDir();
    const paths = journalPaths(dir);
    await appendEntries(dir, KEY_A, LIFECYCLE);
    await appendEntries(dir, KEY_B, PAIR);
    const foreignLong = await createJournalDir();
    await appendEntries(foreignLong, KEY_X, PAIR);
    const foreignShort = await createJournalDir();
    await appendEntries(foreignShort, KEY_X, ['intent']);
    await fs.copyFile(path.join(foreignLong, CHECKPOINT_FILE), paths.checkpoint);
    await fs.copyFile(path.join(foreignShort, CHECKPOINT_FILE), paths.compactCheckpoint);
    await fs.copyFile(paths.journal, paths.compactJournal);
    const journalBefore = await readText(paths.journal);
    const checkpointBefore = await readText(paths.checkpoint);
    const compactCheckpointBefore = await readText(paths.compactCheckpoint);
    const compactJournalBefore = await readText(paths.compactJournal);

    expect(await readJournalSnapshot(dir)).toBeNull();
    expect(await removeCompactionLeftovers(dir)).toBe(false);

    expect(await readText(paths.journal)).toBe(journalBefore);
    expect(await readText(paths.checkpoint)).toBe(checkpointBefore);
    expect(await readText(paths.compactCheckpoint)).toBe(compactCheckpointBefore);
    expect(await readText(paths.compactJournal)).toBe(compactJournalBefore);
  });
});
