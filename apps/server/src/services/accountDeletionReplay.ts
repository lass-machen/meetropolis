import type { PrismaClient } from '../generated/prisma/index.js';
import { JournalUnavailableError } from './tenantDeletionJournal.js';
import {
  append,
  coveredByLaterDeletion,
  hasDatabaseRow,
  isAccountEntry,
  loadKeys,
  type AccountJournalEntry,
  type JournalKeys,
} from './tenantDeletionReplay.js';

/**
 * Account part of the restore replay, run after the tenant part.
 *
 * An account key that was committed or completed, whose user still exists in the restored database
 * is deleted again through the given callback, by user id only. The tenants the
 * user owns are read before each deletion and reported at the end when no owner
 * is left. Old account keys are closed once the account is gone, no database row
 * exists for the key and a later deletion covers it. Logs never carry user ids.
 */

export interface AccountReplayOptions {
  prisma: PrismaClient;
  journalDir: string;
  /** Creation time of the restored copy; commits at or after it are replayed. */
  since: Date;
  /** Deletes one account by user id through the managed account deletion path. */
  deleteAccount: (userId: string) => Promise<void>;
}

export interface AccountReplayResult {
  /** User ids of accounts deleted by this run. */
  replayedAccounts: string[];
  /** Journal keys of accounts closed with a completed entry by this run. */
  closedAccounts: string[];
  /** Tenants that had a deleted account as owner and have no owner left. */
  ownerlessTenants: string[];
}

/** Whether a user with this id exists in the database. */
export async function accountExists(prisma: PrismaClient, userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  return user !== null;
}

/** Tenants in which the user is an owner; read before the account is deleted. */
async function ownedTenantIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId, role: 'owner' },
    select: { tenantId: true },
  });
  return memberships.map((membership) => membership.tenantId);
}

/**
 * Account keys to replay: no abort, and a commit or, without a commit, a completed entry. The time
 * boundary is the time of the commit, or of the completed entry when no commit exists.
 */
function accountCandidates(keys: JournalKeys, since: Date): AccountJournalEntry[] {
  const sinceMs = since.getTime();
  const candidates: AccountJournalEntry[] = [];
  for (const state of keys.values()) {
    const entry = state.commit ?? state.completed;
    if (!entry || state.abort || !isAccountEntry(entry)) continue;
    if (Date.parse(entry.at) >= sinceMs) candidates.push(entry);
  }
  return candidates.sort((a, b) => a.seq - b.seq);
}

/** Deletes each candidate account once, if it exists, and collects the tenants it owned. */
async function deleteRestoredAccounts(
  opts: AccountReplayOptions,
  candidates: AccountJournalEntry[],
  owned: Set<string>,
): Promise<string[]> {
  const replayed: string[] = [];
  const seen = new Set<string>();
  for (const commit of candidates) {
    if (seen.has(commit.accountRef)) continue;
    seen.add(commit.accountRef);
    if (!(await accountExists(opts.prisma, commit.accountRef))) continue;
    for (const tenantId of await ownedTenantIds(opts.prisma, commit.accountRef)) owned.add(tenantId);
    await opts.deleteAccount(commit.accountRef);
    replayed.push(commit.accountRef);
  }
  return replayed;
}

/** The given tenants that have no owner membership left. */
async function ownerlessAmong(prisma: PrismaClient, tenantIds: Set<string>): Promise<string[]> {
  const ownerless: string[] = [];
  for (const tenantId of tenantIds) {
    const owners = await prisma.membership.count({ where: { tenantId, role: 'owner' } });
    if (owners === 0) ownerless.push(tenantId);
  }
  return ownerless;
}

/** Closes old account keys once the account is gone, no database row exists and a later deletion covers them. */
async function closeAccountKeys(opts: AccountReplayOptions, keys: JournalKeys): Promise<string[]> {
  const closed: string[] = [];
  for (const commit of accountCandidates(keys, opts.since)) {
    if (keys.get(commit.key)?.completed) continue;
    if (await accountExists(opts.prisma, commit.accountRef)) continue;
    if (await hasDatabaseRow(opts.prisma, commit.key)) continue;
    if (!coveredByLaterDeletion(keys, commit)) continue;
    await append(opts.journalDir, 'completed', commit);
    closed.push(commit.key);
  }
  return closed;
}

/**
 * Replays committed account deletions. `keys` is the journal state after the tenant part; the closing
 * step reads the journal again, because the deletions append entries of their own.
 */
export async function replayAccountDeletions(
  opts: AccountReplayOptions,
  keys: JournalKeys,
): Promise<AccountReplayResult> {
  const candidates = accountCandidates(keys, opts.since);
  const owned = new Set<string>();
  const replayedAccounts = await deleteRestoredAccounts(opts, candidates, owned);
  const current = await loadKeys(opts.journalDir);
  if (!current) throw new JournalUnavailableError();
  const closedAccounts = await closeAccountKeys(opts, current);
  const ownerlessTenants = await ownerlessAmong(opts.prisma, owned);
  return { replayedAccounts, closedAccounts, ownerlessTenants };
}
