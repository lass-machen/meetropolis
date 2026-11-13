import { accessSync, constants, statSync } from 'node:fs';
import { parseRetentionDays } from './tenantDeletionJournal.js';

export type DeletionJournalConfigResult =
  { ok: true } | { ok: false; key: 'BACKUP_RETENTION_DAYS' | 'DELETION_JOURNAL_DIR' };

// Checks the static journal configuration at startup. It only reads: nothing is
// written or created, no lock is taken and prepareJournalForWrite is not called.
export function checkDeletionJournalConfig(env: NodeJS.ProcessEnv): DeletionJournalConfigResult {
  const journalDir = env.DELETION_JOURNAL_DIR?.trim();
  if (!journalDir) return { ok: true };
  if (parseRetentionDays(env.BACKUP_RETENTION_DAYS) === undefined) {
    return { ok: false, key: 'BACKUP_RETENTION_DAYS' };
  }
  try {
    const stats = statSync(journalDir);
    // Same static condition as loadJournal: without the owner write bit the journal is
    // unavailable, also under root, where accessSync with W_OK alone would pass.
    if (!stats.isDirectory() || (stats.mode & 0o200) === 0) return { ok: false, key: 'DELETION_JOURNAL_DIR' };
    accessSync(journalDir, constants.W_OK);
  } catch {
    return { ok: false, key: 'DELETION_JOURNAL_DIR' };
  }
  return { ok: true };
}
