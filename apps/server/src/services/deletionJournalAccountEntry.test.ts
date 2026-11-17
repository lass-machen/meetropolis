import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHECKPOINT_FILE, JOURNAL_FILE, appendJournalEntry, loadJournal } from './tenantDeletionJournal.js';
import type { JournalAppendInput, LoadedJournal } from './tenantDeletionJournal.js';

// Account lines of the deletion journal: the bytes the writer produces, the
// chains the loader accepts and the line shapes it must reject. Every test
// uses a real temporary directory; there is no database, no mock and no fake clock.

const ZERO_PREV = '0'.repeat(64);
const TENANT_REF = 'cm3t000000000000000000001';
const ACCOUNT_REF = 'cm3a000000000000000000001';
const TENANT_KEY = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_KEY = '22222222-2222-4222-8222-222222222222';
const HEAD_AFTER_FIVE_LINES = '42582e89efeeaadc062f31d5d826a01df7c827d14bd411b7f654cb3ba3521812';

// The five lines exactly as they must appear in journal.jsonl, one JSON object per line.
const TENANT_INTENT_LINE =
  '{"v":1,"seq":1,"prev":"0000000000000000000000000000000000000000000000000000000000000000","type":"intent","key":"11111111-1111-4111-8111-111111111111","tenantRef":"cm3t000000000000000000001","at":"2026-11-12T10:00:00.000Z","journalUntil":"2026-11-26T10:00:00.000Z"}';
const TENANT_COMMIT_LINE =
  '{"v":1,"seq":2,"prev":"4d68c160e10a6a9f38dc5817a2c4c5a04e245152815e66bad694cfbd496d4e07","type":"commit","key":"11111111-1111-4111-8111-111111111111","tenantRef":"cm3t000000000000000000001","at":"2026-11-12T10:00:01.000Z"}';
const ACCOUNT_INTENT_LINE =
  '{"v":1,"seq":3,"prev":"7cd78b90ddee95d7b24ded0e41d02c75d8abbacea965fedb3f480b052624533d","type":"intent","key":"22222222-2222-4222-8222-222222222222","tenantRef":"","accountRef":"cm3a000000000000000000001","at":"2026-11-12T11:00:00.000Z","journalUntil":"2026-11-26T11:00:00.000Z"}';
const ACCOUNT_COMMIT_LINE =
  '{"v":1,"seq":4,"prev":"7500a48c9d7dabd8a5039fad5824c5b404013f2c45d7a8cf7117318747b93382","type":"commit","key":"22222222-2222-4222-8222-222222222222","tenantRef":"","accountRef":"cm3a000000000000000000001","at":"2026-11-12T11:00:00.250Z"}';
const ACCOUNT_COMPLETED_LINE =
  '{"v":1,"seq":5,"prev":"fc6e318a46c0b76884a81771824c8071af1c2462dc615692c2a97de6f1b0fbdf","type":"completed","key":"22222222-2222-4222-8222-222222222222","tenantRef":"","accountRef":"cm3a000000000000000000001","at":"2026-11-12T11:01:00.000Z"}';

const CHAIN_LINES = [
  TENANT_INTENT_LINE,
  TENANT_COMMIT_LINE,
  ACCOUNT_INTENT_LINE,
  ACCOUNT_COMMIT_LINE,
  ACCOUNT_COMPLETED_LINE,
];

// Inputs that the writer turns into CHAIN_LINES, in the same order.
const CHAIN_INPUTS: JournalAppendInput[] = [
  {
    type: 'intent',
    key: TENANT_KEY,
    tenantRef: TENANT_REF,
    at: '2026-11-12T10:00:00.000Z',
    journalUntil: '2026-11-26T10:00:00.000Z',
  },
  { type: 'commit', key: TENANT_KEY, tenantRef: TENANT_REF, at: '2026-11-12T10:00:01.000Z' },
  {
    type: 'intent',
    key: ACCOUNT_KEY,
    tenantRef: '',
    accountRef: ACCOUNT_REF,
    at: '2026-11-12T11:00:00.000Z',
    journalUntil: '2026-11-26T11:00:00.000Z',
  },
  { type: 'commit', key: ACCOUNT_KEY, tenantRef: '', accountRef: ACCOUNT_REF, at: '2026-11-12T11:00:00.250Z' },
  { type: 'completed', key: ACCOUNT_KEY, tenantRef: '', accountRef: ACCOUNT_REF, at: '2026-11-12T11:01:00.000Z' },
];

/** SHA-256 over a journal line including its newline; the next line carries this value as prev. */
function hashLine(line: string): string {
  return createHash('sha256').update(`${line}\n`, 'utf8').digest('hex');
}

// Line three of a chain that follows the two tenant lines.
const PREV_OF_THIRD_LINE = hashLine(TENANT_COMMIT_LINE);

// Each case replaces line three with one shape that the loader must reject.
const THIRD_LINE_NEGATIVES: [string, string][] = [
  [
    'rejects an account line that carries both references',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"${TENANT_REF}","accountRef":"${ACCOUNT_REF}","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects an account line with an empty accountRef',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"","accountRef":"","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects a line with neither tenantRef nor accountRef',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects an accountRef that contains a dot',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"","accountRef":"a.b","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects an accountRef written before tenantRef',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","accountRef":"${ACCOUNT_REF}","tenantRef":"","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects an account intent without journalUntil',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"intent","key":"${ACCOUNT_KEY}","tenantRef":"","accountRef":"${ACCOUNT_REF}","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects an accountRef longer than 64 characters',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"","accountRef":"${'a'.repeat(65)}","at":"2026-11-12T11:00:00.250Z"}`,
  ],
  [
    'rejects journalUntil on an account commit',
    `{"v":1,"seq":3,"prev":"${PREV_OF_THIRD_LINE}","type":"commit","key":"${ACCOUNT_KEY}","tenantRef":"","accountRef":"${ACCOUNT_REF}","at":"2026-11-12T11:00:00.250Z","journalUntil":"2026-11-26T11:00:00.000Z"}`,
  ],
];

// Inputs that appendJournalEntry must refuse before it touches the journal.
const REJECTED_INPUTS: [string, JournalAppendInput][] = [
  [
    'rejects an empty tenantRef without accountRef',
    { type: 'commit', key: ACCOUNT_KEY, tenantRef: '', at: '2026-11-12T11:00:00.250Z' },
  ],
  [
    'rejects a line that carries both references',
    {
      type: 'commit',
      key: ACCOUNT_KEY,
      tenantRef: TENANT_REF,
      accountRef: ACCOUNT_REF,
      at: '2026-11-12T11:00:00.250Z',
    },
  ],
  [
    'rejects an accountRef that contains a dot',
    { type: 'commit', key: ACCOUNT_KEY, tenantRef: '', accountRef: 'a.b', at: '2026-11-12T11:00:00.250Z' },
  ],
];

async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

/** Writes journal.jsonl with the given lines and a checkpoint that points at the last of them. */
async function writeChainFiles(journalDir: string, lines: string[]): Promise<void> {
  const checkpoint = {
    v: 1,
    seq: lines.length,
    head: hashLine(lines[lines.length - 1]),
    baseSeq: 0,
    baseHead: ZERO_PREV,
  };
  await fs.writeFile(path.join(journalDir, JOURNAL_FILE), lines.map((line) => `${line}\n`).join(''), 'utf8');
  await fs.writeFile(path.join(journalDir, CHECKPOINT_FILE), JSON.stringify(checkpoint), 'utf8');
}

async function loadRequired(journalDir: string): Promise<LoadedJournal> {
  const state = await loadJournal(journalDir);
  if (state === null) throw new Error('journal is not loadable');
  return state;
}

describe('deletion journal account lines', () => {
  let dir: string;

  beforeEach(async () => {
    // Every test gets its own empty temporary journal directory.
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deletion-journal-account-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('appendJournalEntry', () => {
    it('writes the five chain lines byte for byte into an empty directory', async () => {
      for (const input of CHAIN_INPUTS) {
        await appendJournalEntry(dir, input);
      }

      expect(await readText(path.join(dir, JOURNAL_FILE))).toBe(CHAIN_LINES.map((line) => `${line}\n`).join(''));
      const checkpoint: unknown = JSON.parse(await readText(path.join(dir, CHECKPOINT_FILE)));
      expect(checkpoint).toStrictEqual({ v: 1, seq: 5, head: HEAD_AFTER_FIVE_LINES, baseSeq: 0, baseHead: ZERO_PREV });
      // Only the two journal files remain, so the writer lock was released.
      expect((await fs.readdir(dir)).sort()).toStrictEqual(['checkpoint.json', 'journal.jsonl']);
    });
  });

  describe('appendJournalEntry with an invalid reference', () => {
    beforeEach(async () => {
      // The chain files equal what the writer produces for CHAIN_INPUTS (checked
      // byte for byte by the case above), written without the writer's disk flushes.
      await writeChainFiles(dir, CHAIN_LINES);
    });

    it.each(REJECTED_INPUTS)('%s', async (_description, input) => {
      const journalBefore = await readText(path.join(dir, JOURNAL_FILE));
      const checkpointBefore = await readText(path.join(dir, CHECKPOINT_FILE));

      await expect(appendJournalEntry(dir, input)).rejects.toThrow('invalid journal entry');

      expect(await readText(path.join(dir, JOURNAL_FILE))).toBe(journalBefore);
      expect(await readText(path.join(dir, CHECKPOINT_FILE))).toBe(checkpointBefore);
      // No lock directory or other leftover: the listing still shows the two journal files only.
      expect((await fs.readdir(dir)).sort()).toStrictEqual(['checkpoint.json', 'journal.jsonl']);
    });
  });

  describe('loadJournal', () => {
    it('accepts the five chain lines and keeps accountRef only on the account lines', async () => {
      await writeChainFiles(dir, CHAIN_LINES);

      const state = await loadRequired(dir);

      expect(state.entries).toStrictEqual([
        {
          seq: 1,
          prev: ZERO_PREV,
          type: 'intent',
          key: TENANT_KEY,
          tenantRef: TENANT_REF,
          at: '2026-11-12T10:00:00.000Z',
          journalUntil: '2026-11-26T10:00:00.000Z',
        },
        {
          seq: 2,
          prev: hashLine(TENANT_INTENT_LINE),
          type: 'commit',
          key: TENANT_KEY,
          tenantRef: TENANT_REF,
          at: '2026-11-12T10:00:01.000Z',
        },
        {
          seq: 3,
          prev: hashLine(TENANT_COMMIT_LINE),
          type: 'intent',
          key: ACCOUNT_KEY,
          tenantRef: '',
          accountRef: ACCOUNT_REF,
          at: '2026-11-12T11:00:00.000Z',
          journalUntil: '2026-11-26T11:00:00.000Z',
        },
        {
          seq: 4,
          prev: hashLine(ACCOUNT_INTENT_LINE),
          type: 'commit',
          key: ACCOUNT_KEY,
          tenantRef: '',
          accountRef: ACCOUNT_REF,
          at: '2026-11-12T11:00:00.250Z',
        },
        {
          seq: 5,
          prev: hashLine(ACCOUNT_COMMIT_LINE),
          type: 'completed',
          key: ACCOUNT_KEY,
          tenantRef: '',
          accountRef: ACCOUNT_REF,
          at: '2026-11-12T11:01:00.000Z',
        },
      ]);
      expect(state.endHead).toBe(HEAD_AFTER_FIVE_LINES);
    });

    describe('third line of a chain', () => {
      it.each(THIRD_LINE_NEGATIVES)('%s', async (_description, line) => {
        await writeChainFiles(dir, [TENANT_INTENT_LINE, TENANT_COMMIT_LINE, line]);

        expect(await loadJournal(dir)).toBeNull();
      });

      it('accepts the same chain when the third line is the valid account intent', async () => {
        await writeChainFiles(dir, [TENANT_INTENT_LINE, TENANT_COMMIT_LINE, ACCOUNT_INTENT_LINE]);

        expect((await loadRequired(dir)).entries).toHaveLength(3);
      });
    });
  });
});
