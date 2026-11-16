import type { PrismaClient } from '../generated/prisma/index.js';
import { revokeAllSessions } from '../api/utils/sessionAuth.js';
import {
  clearRestorePending,
  readRestorePending,
  RestorePendingUnreadableError,
  type RestorePendingMarker,
} from './tenantDeletionRestoreMarker.js';
import {
  replayCommittedDeletions,
  ReplayDecisionError,
  type ReplayCommittedDeletionsResult,
  type ReplayDecision,
  type UndecidedReplayIntent,
} from './tenantDeletionReplay.js';

/**
 * Operator run of the restore replay, without process or console access so
 * that it can be tested against a real database.
 *
 * The restore marker supplies the replay boundary: commits at or after the
 * creation time of the restored copy are replayed, and open intents up to the
 * recorded journal sequence belong to the restored timeline. Without a value
 * the whole journal is replayed, which is safe because tenants are deleted by
 * id only. The marker is removed only after a complete replay and only when
 * the admin module reports no open precondition, so the first server start
 * after a restore runs with its preconditions met. Before the marker is removed, the token
 * step drops sessions and unused reset and verification tokens and revokes OAuth refresh tokens.
 *
 * Output lines carry journal keys, tenant ids, intent times and counters,
 * never names, slugs, mail addresses or error texts.
 */

export const REPLAY_EXIT = {
  done: 0,
  deleteFailed: 1,
  undecided: 2,
  invalid: 3,
  preconditions: 4,
} as const;

/** OAuth refresh token revocation of the token step; the kind states why no revocation can run. */
export type OAuthRefreshRevocation =
  | { kind: 'module_not_loaded' }
  | { kind: 'export_missing' }
  | { kind: 'module_rejected' }
  | { kind: 'available'; revoke: (now: Date) => Promise<number> };

export interface RestoreReplayRunOptions {
  prisma: PrismaClient;
  journalDir: string;
  decisions: ReadonlyMap<string, ReplayDecision>;
  /** Deletes one tenant through the managed path; undefined when no such path is loaded. */
  deleteTenant: ((tenantId: string) => Promise<void>) | undefined;
  /** Deletes one account by user id through the managed account path. */
  deleteAccount?: (userId: string) => Promise<void>;
  /** Codes of preconditions the admin module still reports as open. */
  pendingPreconditions: () => Promise<string[]>;
  /** OAuth refresh token step; absent means the step reports the transcription module as not loaded. */
  oauthRefreshRevocation?: OAuthRefreshRevocation;
}

export interface RestoreReplayRunResult {
  exitCode: number;
  lines: string[];
}

export class ReplayDeletePathMissingError extends Error {
  readonly code = 'replay_delete_path_missing';

  constructor() {
    super('no managed tenant deletion path loaded');
    this.name = 'ReplayDeletePathMissingError';
  }
}

/** A failure of the account deletion callback itself; only the code of the original error is reported. */
class AccountDeleteFailedError extends Error {
  constructor(readonly original: unknown) {
    super('account deletion failed');
    this.name = 'AccountDeleteFailedError';
  }
}

class OAuthRevocationUnavailableError extends Error {
  readonly code = 'oauth_revocation_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'OAuthRevocationUnavailableError';
  }
}

const PREFIX = 'restore replay:';

function done(exitCode: number, lines: string[]): RestoreReplayRunResult {
  return { exitCode, lines };
}

function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'unexpected';
}

/** Probes the tables the replay and the token step read; an older copy may predate the image schema. */
async function schemaReady(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.tenant.findFirst({ select: { id: true } });
    await prisma.deletionJournal.findFirst({ select: { idempotencyKey: true, dbDeletedAt: true } });
    await prisma.user.findFirst({ select: { id: true } });
    await prisma.session.findFirst({ select: { id: true } });
    await prisma.passwordReset.findFirst({ select: { id: true } });
    await prisma.emailVerification.findFirst({ select: { id: true } });
    return true;
  } catch {
    return false;
  }
}

/** Account intents show no account id in the console; the key is enough for --decide. */
function describe(intent: UndecidedReplayIntent): string {
  if (intent.accountRef !== undefined) {
    const accountExists = intent.accountExists ? 'yes' : 'no';
    return `  key=${intent.key} scope=account at=${intent.at} exists=${accountExists}`;
  }
  const exists = intent.tenantExists ? 'yes' : 'no';
  return `  key=${intent.key} tenant=${intent.tenantRef} at=${intent.at} exists=${exists}`;
}

function missingDeletePath(): Promise<void> {
  return Promise.reject(new ReplayDeletePathMissingError());
}

async function readMarker(journalDir: string): Promise<RestorePendingMarker | null | 'unreadable'> {
  try {
    return await readRestorePending(journalDir);
  } catch (error) {
    if (error instanceof RestorePendingUnreadableError) return 'unreadable';
    throw error;
  }
}

/** Runs the account callback and marks its failures, so that the replay names the step that failed. */
function reportingAccountDelete(deleteAccount: (userId: string) => Promise<void>): (userId: string) => Promise<void> {
  return async (userId) => {
    try {
      await deleteAccount(userId);
    } catch (error) {
      throw new AccountDeleteFailedError(error);
    }
  };
}

async function replay(
  opts: RestoreReplayRunOptions,
  marker: RestorePendingMarker | null,
): Promise<ReplayCommittedDeletionsResult | RestoreReplayRunResult> {
  try {
    return await replayCommittedDeletions({
      prisma: opts.prisma,
      journalDir: opts.journalDir,
      since: new Date((marker?.copyCreatedAt ?? 0) * 1000),
      deleteTenant: opts.deleteTenant ?? missingDeletePath,
      deleteAccount: opts.deleteAccount ? reportingAccountDelete(opts.deleteAccount) : undefined,
      restoredJournalSeq: marker?.journalSeq ?? null,
      decisions: opts.decisions,
    });
  } catch (error) {
    if (error instanceof ReplayDecisionError) {
      return done(REPLAY_EXIT.invalid, [`${PREFIX} a decision does not match an open intent`]);
    }
    if (error instanceof ReplayDeletePathMissingError) {
      return done(REPLAY_EXIT.invalid, [`${PREFIX} tenants to delete but no managed deletion path loaded`]);
    }
    if (error instanceof AccountDeleteFailedError) {
      const code = errorCode(error.original);
      return done(REPLAY_EXIT.deleteFailed, [`${PREFIX} account deletion failed (${code}); marker kept`]);
    }
    return done(REPLAY_EXIT.deleteFailed, [`${PREFIX} tenant deletion failed (${errorCode(error)}); marker kept`]);
  }
}

/** Summary of the replay in counters only. */
function summaryLine(result: ReplayCommittedDeletionsResult): string {
  const tenants = `replayed ${result.replayed.length} tenants, closed ${result.closed.length} journal keys`;
  const accounts = `replayed ${result.replayedAccounts.length} accounts`;
  const accountKeys = `closed ${result.closedAccounts.length} account keys`;
  return `${PREFIX} ${tenants}, ${accounts}, ${accountKeys}`;
}

/** One line per tenant without an owner after a replayed account deletion. */
function ownerlessLines(tenantIds: string[]): string[] {
  return tenantIds.map((tenantId) => `  tenant=${tenantId} owner=none`);
}

/** Drops all sessions and the unused reset and verification tokens, then runs the OAuth refresh step. */
async function dropTokens(opts: RestoreReplayRunOptions): Promise<string[]> {
  const sessionCount = await revokeAllSessions(opts.prisma);
  const resets = await opts.prisma.passwordReset.deleteMany({ where: { usedAt: null } });
  const verifications = await opts.prisma.emailVerification.deleteMany({ where: { usedAt: null } });
  return [
    `${PREFIX} sessions deleted: ${sessionCount}`,
    `${PREFIX} password reset tokens deleted: ${resets.count}`,
    `${PREFIX} email verification tokens deleted: ${verifications.count}`,
    ...(await revokeOAuthRefreshTokens(opts.oauthRefreshRevocation)),
  ];
}

/** Revokes OAuth refresh tokens through the loaded module; only the count and the skip note are returned. */
async function revokeOAuthRefreshTokens(revocation: OAuthRefreshRevocation | undefined): Promise<string[]> {
  if (revocation === undefined || revocation.kind === 'module_not_loaded') {
    return [`${PREFIX} oauth refresh tokens: skipped (transcription module not loaded)`];
  }
  if (revocation.kind === 'export_missing') {
    throw new OAuthRevocationUnavailableError(
      'oauth refresh token revocation unavailable: the loaded transcription module is too old',
    );
  }
  if (revocation.kind === 'module_rejected') {
    throw new OAuthRevocationUnavailableError(
      'oauth refresh token revocation unavailable: the installed transcription module failed to load',
    );
  }
  const n = await revocation.revoke(new Date());
  return [`${PREFIX} oauth refresh tokens revoked: ${n}`];
}

/** Token step before the marker is removed; any failure exits 1 and keeps the marker. */
async function tokenStep(opts: RestoreReplayRunOptions): Promise<string[] | RestoreReplayRunResult> {
  try {
    return await dropTokens(opts);
  } catch (error) {
    if (error instanceof OAuthRevocationUnavailableError) {
      return done(REPLAY_EXIT.deleteFailed, [`${PREFIX} ${error.message}; marker kept`]);
    }
    return done(REPLAY_EXIT.deleteFailed, [`${PREFIX} token cleanup failed (${errorCode(error)}); marker kept`]);
  }
}

/** Runs the replay once and reports the outcome; never exits the process. */
export async function runRestoreReplay(opts: RestoreReplayRunOptions): Promise<RestoreReplayRunResult> {
  const marker = await readMarker(opts.journalDir);
  if (marker === 'unreadable') return done(REPLAY_EXIT.invalid, [`${PREFIX} restore marker unreadable`]);
  if (!(await schemaReady(opts.prisma))) {
    const hint = 'run the migration step (docker compose run --rm ee-migrate) first';
    return done(REPLAY_EXIT.invalid, [`${PREFIX} database unreachable or schema not current; ${hint}; marker kept`]);
  }
  const result = await replay(opts, marker);
  if ('exitCode' in result) return result;
  if (result.blocked === 'journal_invalid')
    return done(REPLAY_EXIT.invalid, [`${PREFIX} journal invalid or unavailable`]);
  if (result.blocked === 'undecided_intent') {
    const head = `${PREFIX} ${result.undecided.length} open intents need --decide <key>=delete|keep`;
    return done(REPLAY_EXIT.undecided, [head, ...result.undecided.map(describe)]);
  }
  const replayLines = [summaryLine(result), ...ownerlessLines(result.ownerlessTenants)];
  if (marker === null) return done(REPLAY_EXIT.done, [...replayLines, `${PREFIX} no restore marker present`]);
  const open = await opts.pendingPreconditions();
  if (open.length > 0) {
    const reason = `${PREFIX} preconditions open: ${open.join(', ')}; marker kept`;
    return done(REPLAY_EXIT.preconditions, [...replayLines, reason]);
  }
  const tokens = await tokenStep(opts);
  if ('exitCode' in tokens) return done(tokens.exitCode, [...replayLines, ...tokens.lines]);
  await clearRestorePending(opts.journalDir);
  return done(REPLAY_EXIT.done, [...replayLines, ...tokens, `${PREFIX} marker removed`]);
}
