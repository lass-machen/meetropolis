import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRestorePending,
  isRestorePending,
  readRestorePending,
  RestorePendingUnreadableError,
} from './tenantDeletionRestoreMarker.js';

const MARKER_NAME = 'restore-pending.json';

const VALID_MARKER = {
  v: 1,
  createdAt: '2026-11-12T12:00:00.000Z',
  copyCreatedAt: 1762948800,
  journalSeq: 7,
};

async function expectUnreadable(journalDir: string): Promise<void> {
  await expect(readRestorePending(journalDir)).rejects.toBeInstanceOf(RestorePendingUnreadableError);
  await expect(readRestorePending(journalDir)).rejects.toHaveProperty('code', 'restore_pending_unreadable');
}

describe('tenantDeletionRestoreMarker', () => {
  let dir: string;

  beforeEach(async () => {
    // Every test gets its own real temporary journal directory.
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-marker-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('isRestorePending', () => {
    it('returns false when no marker exists', async () => {
      await expect(isRestorePending(dir)).resolves.toBe(false);
    });

    it('returns true for a regular marker file with arbitrary content', async () => {
      await fs.writeFile(path.join(dir, MARKER_NAME), 'arbitrary content, not even JSON');
      await expect(isRestorePending(dir)).resolves.toBe(true);
    });

    it('returns true when a directory carries the marker name', async () => {
      await fs.mkdir(path.join(dir, MARKER_NAME));
      await expect(isRestorePending(dir)).resolves.toBe(true);
    });

    it('returns true for a dangling symlink, because the entry itself is inspected', async () => {
      await fs.symlink(path.join(dir, 'missing-target.json'), path.join(dir, MARKER_NAME));
      await expect(isRestorePending(dir)).resolves.toBe(true);
    });

    it('returns false when the journal directory does not exist', async () => {
      await expect(isRestorePending(path.join(dir, 'missing', 'journal'))).resolves.toBe(false);
    });
  });

  describe('readRestorePending', () => {
    it('returns null when no marker exists', async () => {
      await expect(readRestorePending(dir)).resolves.toBeNull();
    });

    it('returns the marker content for a valid regular file', async () => {
      await fs.writeFile(path.join(dir, MARKER_NAME), JSON.stringify(VALID_MARKER));
      await expect(readRestorePending(dir)).resolves.toEqual({
        v: 1,
        createdAt: '2026-11-12T12:00:00.000Z',
        copyCreatedAt: 1762948800,
        journalSeq: 7,
      });
    });

    it('accepts null for copyCreatedAt and journalSeq when they are unknown', async () => {
      await fs.writeFile(
        path.join(dir, MARKER_NAME),
        JSON.stringify({ ...VALID_MARKER, copyCreatedAt: null, journalSeq: null }),
      );
      await expect(readRestorePending(dir)).resolves.toEqual({
        v: 1,
        createdAt: '2026-11-12T12:00:00.000Z',
        copyCreatedAt: null,
        journalSeq: null,
      });
    });

    it.each([
      ['not JSON', 'not json'],
      ['unsupported version', JSON.stringify({ ...VALID_MARKER, v: 2 })],
      ['missing journalSeq', JSON.stringify({ v: 1, createdAt: VALID_MARKER.createdAt, copyCreatedAt: null })],
      ['negative copyCreatedAt', JSON.stringify({ ...VALID_MARKER, copyCreatedAt: -1 })],
      ['fractional journalSeq', JSON.stringify({ ...VALID_MARKER, journalSeq: 1.5 })],
      ['invalid createdAt', JSON.stringify({ ...VALID_MARKER, createdAt: 'not a date' })],
      ['JSON null', 'null'],
    ])('rejects a regular file with invalid content: %s', async (_label, content) => {
      await fs.writeFile(path.join(dir, MARKER_NAME), content);
      await expectUnreadable(dir);
    });

    it('rejects a directory carrying the marker name', async () => {
      await fs.mkdir(path.join(dir, MARKER_NAME));
      await expectUnreadable(dir);
    });

    it('rejects a symlink even when it points to a valid marker file', async () => {
      const target = path.join(dir, 'target.json');
      await fs.writeFile(target, JSON.stringify(VALID_MARKER));
      await fs.symlink(target, path.join(dir, MARKER_NAME));
      await expectUnreadable(dir);
    });
  });

  describe('clearRestorePending', () => {
    it('removes an existing marker', async () => {
      await fs.writeFile(path.join(dir, MARKER_NAME), JSON.stringify(VALID_MARKER));
      await clearRestorePending(dir);
      await expect(isRestorePending(dir)).resolves.toBe(false);
    });

    it('resolves without error when no marker exists', async () => {
      await expect(clearRestorePending(dir)).resolves.toBeUndefined();
    });
  });
});
