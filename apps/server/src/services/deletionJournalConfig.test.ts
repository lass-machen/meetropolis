import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkDeletionJournalConfig, type DeletionJournalConfigResult } from './deletionJournalConfig.js';

// Startup check of the deletion journal configuration. Every test uses a real temporary directory
// and its own env object; process.env is never changed and nothing is mocked.

// Runs the check and asserts that the watched directory lists the same entries before and after,
// so neither a valid nor an invalid configuration creates or writes anything.
async function checkWithoutWrites(watched: string, env: NodeJS.ProcessEnv): Promise<DeletionJournalConfigResult> {
  const before = (await fs.readdir(watched)).sort();
  const result = checkDeletionJournalConfig(env);
  expect((await fs.readdir(watched)).sort()).toEqual(before);
  return result;
}

describe('checkDeletionJournalConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deletion-journal-config-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe('without a journal directory', () => {
    it.each<[string, NodeJS.ProcessEnv]>([
      ['unset', {}],
      ['empty', { DELETION_JOURNAL_DIR: '' }],
      ['only spaces', { DELETION_JOURNAL_DIR: '   ' }],
    ])('is valid when DELETION_JOURNAL_DIR is %s', async (_label, env) => {
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: true });
    });
  });

  describe('with a usable journal directory', () => {
    it.each(['1', '13'])('is valid with BACKUP_RETENTION_DAYS %s', async (days) => {
      const env = {
        DELETION_JOURNAL_DIR: dir,
        BACKUP_RETENTION_DAYS: days,
        BACKUP_MAX_COPY_LIFETIME_DAYS: '30',
      };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: true });
    });

    it.each(['0', '14', '', 'abc'])('rejects BACKUP_RETENTION_DAYS %j', async (days) => {
      const env = { DELETION_JOURNAL_DIR: dir, BACKUP_RETENTION_DAYS: days };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'BACKUP_RETENTION_DAYS' });
    });

    it('rejects a missing BACKUP_RETENTION_DAYS', async () => {
      expect(await checkWithoutWrites(dir, { DELETION_JOURNAL_DIR: dir })).toEqual({
        ok: false,
        key: 'BACKUP_RETENTION_DAYS',
      });
    });

    it('rejects a missing BACKUP_MAX_COPY_LIFETIME_DAYS', async () => {
      const env = { DELETION_JOURNAL_DIR: dir, BACKUP_RETENTION_DAYS: '7' };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'BACKUP_MAX_COPY_LIFETIME_DAYS' });
    });

    it.each(['0', '030', 'abc', ''])('rejects BACKUP_MAX_COPY_LIFETIME_DAYS %j', async (lifetime) => {
      const env = {
        DELETION_JOURNAL_DIR: dir,
        BACKUP_RETENTION_DAYS: '7',
        BACKUP_MAX_COPY_LIFETIME_DAYS: lifetime,
      };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'BACKUP_MAX_COPY_LIFETIME_DAYS' });
    });

    it('rejects BACKUP_MAX_COPY_LIFETIME_DAYS below BACKUP_RETENTION_DAYS', async () => {
      const env = {
        DELETION_JOURNAL_DIR: dir,
        BACKUP_RETENTION_DAYS: '7',
        BACKUP_MAX_COPY_LIFETIME_DAYS: '6',
      };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'BACKUP_MAX_COPY_LIFETIME_DAYS' });
    });

    it.each(['7', '30'])('accepts BACKUP_MAX_COPY_LIFETIME_DAYS %s with BACKUP_RETENTION_DAYS 7', async (lifetime) => {
      const env = {
        DELETION_JOURNAL_DIR: dir,
        BACKUP_RETENTION_DAYS: '7',
        BACKUP_MAX_COPY_LIFETIME_DAYS: lifetime,
      };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: true });
    });
  });

  describe('with an unusable journal directory', () => {
    it('rejects a directory that does not exist and does not create it', async () => {
      const env = {
        DELETION_JOURNAL_DIR: path.join(dir, 'missing'),
        BACKUP_RETENTION_DAYS: '1',
        BACKUP_MAX_COPY_LIFETIME_DAYS: '14',
      };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'DELETION_JOURNAL_DIR' });
    });

    it('rejects a path that is a regular file', async () => {
      const file = path.join(dir, 'journal-file');
      await fs.writeFile(file, 'not a directory');
      const env = { DELETION_JOURNAL_DIR: file, BACKUP_RETENTION_DAYS: '1', BACKUP_MAX_COPY_LIFETIME_DAYS: '14' };
      expect(await checkWithoutWrites(dir, env)).toEqual({ ok: false, key: 'DELETION_JOURNAL_DIR' });
    });

    // Root ignores write permission bits, so this case runs only as a regular user.
    it.skipIf(process.getuid?.() === 0)('rejects a directory without owner write permission', async () => {
      const journal = path.join(dir, 'journal');
      await fs.mkdir(journal);
      await fs.chmod(journal, 0o500);
      try {
        const env = { DELETION_JOURNAL_DIR: journal, BACKUP_RETENTION_DAYS: '1', BACKUP_MAX_COPY_LIFETIME_DAYS: '14' };
        expect(await checkWithoutWrites(journal, env)).toEqual({ ok: false, key: 'DELETION_JOURNAL_DIR' });
      } finally {
        // Restores write access so that the afterEach cleanup can remove the directory.
        await fs.chmod(journal, 0o700);
      }
    });
  });
});
