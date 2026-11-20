import type { PrismaClient } from '../generated/prisma/index.js';
import {
  appendJournalEntry,
  journalRefs,
  loadJournal,
  type JournalEntry,
  type JournalEntryType,
} from './tenantDeletionJournal.js';
import { accountExists, replayAccountDeletions, type AccountReplayResult } from './accountDeletionReplay.js';

/**
 * Restore replay for tenant deletions.
 *
 * After an older database copy has been restored, tenants deleted after the
 * copy was taken exist again. The deletion journal lives outside the
 * database and still records those deletions. The replay deletes such
 * tenants again, strictly by tenant id and never by slug, and closes the old
 * journal keys once the tenant is gone and a newer deletion covers it.
 *
 * Account deletions follow the same rules through accountDeletionReplay.ts,
 * but only with a deletion callback for accounts. Without one, open account
 * intents still block the replay, and account entries are never written to.
 *
 * Open intents of the restored timeline may have committed before the
 * restore; a missing database row proves nothing here. They block the replay
 * until an operator decides each key. Nothing is deleted while the journal is
 * invalid or such an intent is open.
 */

export type ReplayDecision = 'delete' | 'keep';

export interface UndecidedReplayIntent {
  key: string;
  tenantRef: string;
  at: string;
  /** False for account intents, which name no tenant. */
  tenantExists: boolean;
  /** Account of an account intent; tenantRef is empty then. */
  accountRef?: string;
  /** Whether that account exists in the restored database; account intents only. */
  accountExists?: boolean;
}

export interface ReplayCommittedDeletionsOptions {
  prisma: PrismaClient;
  journalDir: string;
  /** Creation time of the restored copy; commits at or after it are replayed. */
  since: Date;
  /** Deletes one tenant by id through the managed deletion path. */
  deleteTenant: (tenantId: string) => Promise<void>;
  /** Deletes one account by user id. Without it, account entries are never written, replayed or decided. */
  deleteAccount?: (userId: string) => Promise<void>;
  /** Last journal sequence before the restore; later open intents stem from the replay itself. */
  restoredJournalSeq?: number | null;
  /** Operator decisions for open intents, by journal key. */
  decisions?: ReadonlyMap<string, ReplayDecision>;
}

export interface ReplayCommittedDeletionsResult {
  blocked: null | 'undecided_intent' | 'journal_invalid';
  /** Tenant ids deleted by this run. */
  replayed: string[];
  /** Open intents that block the replay. */
  undecided: UndecidedReplayIntent[];
  /** Tenant journal keys closed with a completed entry by this run. */
  closed: string[];
  /** User ids of accounts deleted by this run; empty without deleteAccount. */
  replayedAccounts: string[];
  /** Account journal keys closed with a completed entry by this run. */
  closedAccounts: string[];
  /** Tenants that lost their last owner through an account deleted by this run. */
  ownerlessTenants: string[];
}

export class ReplayDecisionError extends Error {
  readonly code = 'replay_decision_invalid';

  constructor() {
    super('replay decision does not match an open intent');
    this.name = 'ReplayDecisionError';
  }
}

interface KeyState {
  intent?: JournalEntry;
  commit?: JournalEntry;
  abort?: JournalEntry;
  completed?: JournalEntry;
}

export type JournalKeys = Map<string, KeyState>;

/** Journal entry of an account: it names the account by accountRef and no tenant. */
export type AccountJournalEntry = JournalEntry & { accountRef: string };

export function isAccountEntry(entry: JournalEntry): entry is AccountJournalEntry {
  return entry.accountRef !== undefined;
}

export async function loadKeys(journalDir: string): Promise<JournalKeys | null> {
  const journal = await loadJournal(journalDir);
  if (!journal) return null;
  const keys: JournalKeys = new Map();
  for (const entry of journal.entries) {
    const state = keys.get(entry.key) ?? {};
    state[entry.type] ??= entry;
    keys.set(entry.key, state);
  }
  return keys;
}

function isOpen(state: KeyState): boolean {
  return state.intent !== undefined && !state.commit && !state.abort && !state.completed;
}

function openIntents(keys: JournalKeys): JournalEntry[] {
  const open: JournalEntry[] = [];
  for (const state of keys.values()) {
    if (isOpen(state) && state.intent) open.push(state.intent);
  }
  return open.sort((a, b) => a.seq - b.seq);
}

/** Appends an outcome for an entry; the references are copied so that account entries keep their accountRef. */
export async function append(journalDir: string, type: JournalEntryType, entry: JournalEntry): Promise<void> {
  await appendJournalEntry(journalDir, { type, key: entry.key, ...journalRefs(entry), at: new Date().toISOString() });
}

async function tenantExists(prisma: PrismaClient, tenantId: string): Promise<boolean> {
  if (tenantId === '') return false;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  return tenant !== null;
}

export async function hasDatabaseRow(prisma: PrismaClient, key: string): Promise<boolean> {
  const row = await prisma.deletionJournal.findFirst({
    where: { idempotencyKey: key },
    select: { idempotencyKey: true },
  });
  return row !== null;
}

/** Open intents whose transaction committed in the restored database; account intents only with deleteAccount. */
async function commitDatabaseBacked(
  prisma: PrismaClient,
  journalDir: string,
  keys: JournalKeys,
  withAccounts: boolean,
): Promise<void> {
  for (const intent of openIntents(keys)) {
    if (isAccountEntry(intent) && !withAccounts) continue;
    const row = await prisma.deletionJournal.findFirst({
      where: { idempotencyKey: intent.key },
      select: { dbDeletedAt: true },
    });
    if (row?.dbDeletedAt) await append(journalDir, 'commit', intent);
  }
}

function decisionAction(
  state: KeyState | undefined,
  decision: ReplayDecision,
  withAccounts: boolean,
): 'apply' | 'skip' | 'invalid' {
  if (!state?.intent) return 'invalid';
  if (isAccountEntry(state.intent) && !withAccounts) return 'invalid';
  if (isOpen(state)) return 'apply';
  if (decision === 'delete' && state.commit && !state.abort) return 'skip';
  if (decision === 'keep' && state.abort && !state.commit) return 'skip';
  return 'invalid';
}

async function applyDecisions(opts: ReplayCommittedDeletionsOptions, keys: JournalKeys): Promise<void> {
  const pending: Array<[KeyState, ReplayDecision]> = [];
  for (const [key, decision] of opts.decisions ?? []) {
    const state = keys.get(key);
    const action = decisionAction(state, decision, opts.deleteAccount !== undefined);
    if (action === 'invalid' || !state) throw new ReplayDecisionError();
    if (action === 'apply') pending.push([state, decision]);
  }
  for (const [state, decision] of pending) {
    if (state.intent) await append(opts.journalDir, decision === 'delete' ? 'commit' : 'abort', state.intent);
  }
}

async function describeIntents(prisma: PrismaClient, intents: JournalEntry[]): Promise<UndecidedReplayIntent[]> {
  const described: UndecidedReplayIntent[] = [];
  for (const intent of intents) {
    if (isAccountEntry(intent)) {
      const userExists = await accountExists(prisma, intent.accountRef);
      described.push({
        key: intent.key,
        tenantRef: intent.tenantRef,
        accountRef: intent.accountRef,
        at: intent.at,
        tenantExists: false,
        accountExists: userExists,
      });
    } else {
      const exists = await tenantExists(prisma, intent.tenantRef);
      described.push({ key: intent.key, tenantRef: intent.tenantRef, at: intent.at, tenantExists: exists });
    }
  }
  return described;
}

function replayCandidates(keys: JournalKeys, since: Date): JournalEntry[] {
  const sinceMs = since.getTime();
  const commits: JournalEntry[] = [];
  for (const state of keys.values()) {
    const commit = state.commit;
    if (commit && !state.abort && commit.tenantRef !== '' && Date.parse(commit.at) >= sinceMs) commits.push(commit);
  }
  return commits.sort((a, b) => a.seq - b.seq);
}

async function deleteRestoredTenants(
  opts: ReplayCommittedDeletionsOptions,
  candidates: JournalEntry[],
): Promise<string[]> {
  const replayed: string[] = [];
  const seen = new Set<string>();
  for (const commit of candidates) {
    if (seen.has(commit.tenantRef)) continue;
    seen.add(commit.tenantRef);
    if (!(await tenantExists(opts.prisma, commit.tenantRef))) continue;
    await opts.deleteTenant(commit.tenantRef);
    replayed.push(commit.tenantRef);
  }
  return replayed;
}

/** Whether two entries name the same tenant and the same account. */
function sameReference(a: JournalEntry, b: JournalEntry): boolean {
  return a.tenantRef === b.tenantRef && a.accountRef === b.accountRef;
}

/** True when a later deletion of the same tenant or account is committed, or none was attempted. */
export function coveredByLaterDeletion(keys: JournalKeys, commit: JournalEntry): boolean {
  let laterIntent = false;
  for (const state of keys.values()) {
    const intent = state.intent;
    if (!intent || !sameReference(intent, commit) || intent.seq <= commit.seq) continue;
    if (state.commit) return true;
    laterIntent = true;
  }
  return !laterIntent;
}

async function closeReplayedKeys(opts: ReplayCommittedDeletionsOptions, keys: JournalKeys): Promise<string[]> {
  const closed: string[] = [];
  for (const commit of replayCandidates(keys, opts.since)) {
    if (keys.get(commit.key)?.completed) continue;
    if (await tenantExists(opts.prisma, commit.tenantRef)) continue;
    if (await hasDatabaseRow(opts.prisma, commit.key)) continue;
    if (!coveredByLaterDeletion(keys, commit)) continue;
    await append(opts.journalDir, 'completed', commit);
    closed.push(commit.key);
  }
  return closed;
}

function blockedResult(
  blocked: 'undecided_intent' | 'journal_invalid',
  replayed: string[] = [],
): ReplayCommittedDeletionsResult {
  return {
    blocked,
    replayed,
    undecided: [],
    closed: [],
    replayedAccounts: [],
    closedAccounts: [],
    ownerlessTenants: [],
  };
}

/** Account part of the replay; it runs only with a deletion callback for accounts. */
async function replayAccounts(opts: ReplayCommittedDeletionsOptions, keys: JournalKeys): Promise<AccountReplayResult> {
  if (opts.deleteAccount === undefined) return { replayedAccounts: [], closedAccounts: [], ownerlessTenants: [] };
  return replayAccountDeletions(
    { prisma: opts.prisma, journalDir: opts.journalDir, since: opts.since, deleteAccount: opts.deleteAccount },
    keys,
  );
}

/**
 * Re-applies tenant and account deletions recorded in the journal after a database
 * restore. Safe to run again: deleted tenants and accounts are skipped, closed keys stay
 * closed, and decisions that are already recorded are not written twice.
 */
export async function replayCommittedDeletions(
  opts: ReplayCommittedDeletionsOptions,
): Promise<ReplayCommittedDeletionsResult> {
  const withAccounts = opts.deleteAccount !== undefined;
  const initial = await loadKeys(opts.journalDir);
  if (!initial) return blockedResult('journal_invalid');
  await commitDatabaseBacked(opts.prisma, opts.journalDir, initial, withAccounts);
  const decided = await loadKeys(opts.journalDir);
  if (!decided) return blockedResult('journal_invalid');
  await applyDecisions(opts, decided);
  const keys = await loadKeys(opts.journalDir);
  if (!keys) return blockedResult('journal_invalid');
  const limit = opts.restoredJournalSeq ?? Number.POSITIVE_INFINITY;
  const blocking = openIntents(keys).filter((intent) => intent.seq <= limit);
  if (blocking.length > 0) {
    return { ...blockedResult('undecided_intent'), undecided: await describeIntents(opts.prisma, blocking) };
  }
  const replayed = await deleteRestoredTenants(opts, replayCandidates(keys, opts.since));
  const after = await loadKeys(opts.journalDir);
  if (!after) return blockedResult('journal_invalid', replayed);
  const closed = await closeReplayedKeys(opts, after);
  return { blocked: null, replayed, undecided: [], closed, ...(await replayAccounts(opts, after)) };
}
