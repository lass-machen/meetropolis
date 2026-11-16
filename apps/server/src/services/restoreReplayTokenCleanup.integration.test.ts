import crypto from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { CHECKPOINT_FILE, ZERO_HEAD, appendJournalEntry } from './tenantDeletionJournal.js';
import { RESTORE_PENDING_FILE, isRestorePending, type RestorePendingMarker } from './tenantDeletionRestoreMarker.js';
import {
  REPLAY_EXIT,
  runRestoreReplay,
  type OAuthRefreshRevocation,
  type RestoreReplayRunOptions,
} from './tenantDeletionReplayRun.js';

/**
 * Token step at the end of the restore replay (runRestoreReplay) against a REAL PostgreSQL database.
 *
 * The token step deletes every Session row and every unused PasswordReset and EmailVerification row of the
 * whole database, so this file must not run in parallel with other database test files. Each case creates
 * its own user with tokens and checks only those rows and the counters in the output. The output is the list
 * of lines that runRestoreReplay returns; the function itself prints nothing.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('restore replay token step test needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const FAR_FUTURE = new Date('2099-01-01T00:00:00.000Z');
const JOURNAL_UNTIL = '2099-01-01T00:00:00.000Z';
const userIds: string[] = [];
const journalDirs: string[] = [];

interface TokenFixture {
  userId: string;
  /** Values that must never appear in an output line. */
  secrets: string[];
}

interface OAuthCase {
  label: string;
  revocation: OAuthRefreshRevocation;
  exitCode: number;
  markerKept: boolean;
  expectedLine: string;
}

const oauthCases: OAuthCase[] = [
  {
    label: 'transcription module not loaded',
    revocation: { kind: 'module_not_loaded' },
    exitCode: REPLAY_EXIT.done,
    markerKept: false,
    expectedLine: 'oauth refresh tokens: skipped (transcription module not loaded)',
  },
  {
    label: 'transcription module without the revocation export',
    revocation: { kind: 'export_missing' },
    exitCode: REPLAY_EXIT.deleteFailed,
    markerKept: true,
    expectedLine: 'oauth refresh token revocation unavailable',
  },
  {
    label: 'installed transcription module failed to load',
    revocation: { kind: 'module_rejected' },
    exitCode: REPLAY_EXIT.deleteFailed,
    markerKept: true,
    expectedLine: 'the installed transcription module failed to load',
  },
  {
    label: 'revocation available',
    revocation: { kind: 'available', revoke: () => Promise.resolve(3) },
    exitCode: REPLAY_EXIT.done,
    markerKept: false,
    expectedLine: 'oauth refresh tokens revoked: 3',
  },
];

function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** One user with two sessions, and an unused and a used row each for reset and verification. */
async function createTokenFixture(): Promise<TokenFixture> {
  const email = `restore-token-step-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({ data: { email } });
  userIds.push(user.id);
  const sessionHashes = [randomToken(), randomToken()];
  await prisma.session.createMany({
    data: sessionHashes.map((tokenHash) => ({ userId: user.id, tokenHash, expiresAt: FAR_FUTURE })),
  });
  const unusedReset = randomToken();
  const usedReset = randomToken();
  await prisma.passwordReset.createMany({
    data: [
      { userId: user.id, token: unusedReset, expiresAt: FAR_FUTURE },
      { userId: user.id, token: usedReset, expiresAt: FAR_FUTURE, usedAt: new Date() },
    ],
  });
  const unusedVerification = randomToken();
  const usedVerification = randomToken();
  await prisma.emailVerification.createMany({
    data: [
      { userId: user.id, email, token: unusedVerification, expiresAt: FAR_FUTURE },
      { userId: user.id, email, token: usedVerification, expiresAt: FAR_FUTURE, usedAt: new Date() },
    ],
  });
  const secrets = [user.id, ...sessionHashes, unusedReset, usedReset, unusedVerification, usedVerification];
  return { userId: user.id, secrets };
}

/**
 * Operator options without decisions and without tenant deletions. No enterprise admin module is loaded
 * here, so no precondition is open; the operator script reports the same empty list in OSS mode.
 */
function runOptions(journalDir: string, revocation: OAuthRefreshRevocation): RestoreReplayRunOptions {
  return {
    prisma,
    journalDir,
    decisions: new Map(),
    deleteTenant: undefined,
    pendingPreconditions: () => Promise.resolve([]),
    oauthRefreshRevocation: revocation,
  };
}

/** Empty journal with a zero checkpoint, the state of a journal that has no entries. */
async function createJournalDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'restore-token-step-'));
  journalDirs.push(dir);
  const checkpoint = { v: 1, seq: 0, head: ZERO_HEAD, baseSeq: 0, baseHead: ZERO_HEAD };
  await writeFile(path.join(dir, CHECKPOINT_FILE), JSON.stringify(checkpoint), 'utf8');
  return dir;
}

/**
 * Restore marker in the file format the restore script writes. A null copy time makes the replay
 * consider every commit of the journal.
 */
async function writeRestoreMarker(journalDir: string, journalSeq: number): Promise<void> {
  const marker: RestorePendingMarker = { v: 1, createdAt: new Date().toISOString(), copyCreatedAt: null, journalSeq };
  await writeFile(path.join(journalDir, RESTORE_PENDING_FILE), JSON.stringify(marker), 'utf8');
}

/** Open intent with no decision and no database row, as left by a deletion whose commit never got recorded. */
async function appendOpenIntent(journalDir: string, key: string, tenantRef: string): Promise<void> {
  await appendJournalEntry(journalDir, {
    type: 'intent',
    key,
    tenantRef,
    at: new Date().toISOString(),
    journalUntil: JOURNAL_UNTIL,
  });
}

/** Value of a counter line such as "sessions deleted: 2"; fails when the output has no such line. */
function counterOf(lines: string[], label: string): number {
  const count = lines.find((entry) => entry.includes(`${label}: `))?.match(/(\d+)$/)?.[1];
  if (count === undefined) throw new Error(`output has no counter line for "${label}"`);
  return Number(count);
}

/** No output line carries a user id or a token value of the fixture. */
function expectNoSecrets(lines: string[], fixture: TokenFixture): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    for (const secret of fixture.secrets) expect(line).not.toContain(secret);
  }
}

/** Own sessions and unused reset and verification rows are gone; the used rows remain. */
async function expectOwnTokensCleared(fixture: TokenFixture): Promise<void> {
  const { userId } = fixture;
  expect(await prisma.session.count({ where: { userId } })).toBe(0);
  expect(await prisma.passwordReset.count({ where: { userId, usedAt: null } })).toBe(0);
  expect(await prisma.emailVerification.count({ where: { userId, usedAt: null } })).toBe(0);
  expect(await prisma.passwordReset.count({ where: { userId, usedAt: { not: null } } })).toBe(1);
  expect(await prisma.emailVerification.count({ where: { userId, usedAt: { not: null } } })).toBe(1);
}

/** Blocked run: both sessions and the unused reset and verification rows remain. */
async function expectOwnTokensKept(fixture: TokenFixture): Promise<void> {
  const { userId } = fixture;
  expect(await prisma.session.count({ where: { userId } })).toBe(2);
  expect(await prisma.passwordReset.count({ where: { userId, usedAt: null } })).toBe(1);
  expect(await prisma.emailVerification.count({ where: { userId, usedAt: null } })).toBe(1);
}

describe('restore replay token step (real database)', () => {
  it('clears own sessions and unused tokens, keeps used tokens, and removes the marker', async () => {
    const fixture = await createTokenFixture();
    const journalDir = await createJournalDir();
    await writeRestoreMarker(journalDir, 0);

    const result = await runRestoreReplay(runOptions(journalDir, { kind: 'module_not_loaded' }));

    expect(result.exitCode).toBe(REPLAY_EXIT.done);
    expect(counterOf(result.lines, 'sessions deleted')).toBeGreaterThanOrEqual(2);
    expect(counterOf(result.lines, 'password reset tokens deleted')).toBeGreaterThanOrEqual(1);
    expect(counterOf(result.lines, 'email verification tokens deleted')).toBeGreaterThanOrEqual(1);
    expect(result.lines).toContain('restore replay: marker removed');
    expect(await isRestorePending(journalDir)).toBe(false);
    await expectOwnTokensCleared(fixture);
    // Runs alone after all other database test files: no session and no unused token row is left.
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.passwordReset.count({ where: { usedAt: null } })).toBe(0);
    expect(await prisma.emailVerification.count({ where: { usedAt: null } })).toBe(0);
    expectNoSecrets(result.lines, fixture);
  });

  it('keeps own tokens and the marker while an open intent without a decision blocks the replay', async () => {
    const fixture = await createTokenFixture();
    const journalDir = await createJournalDir();
    const key = crypto.randomUUID();
    await appendOpenIntent(journalDir, key, crypto.randomUUID());
    await writeRestoreMarker(journalDir, 1);

    const result = await runRestoreReplay(runOptions(journalDir, { kind: 'module_not_loaded' }));

    expect(result.exitCode).toBe(REPLAY_EXIT.undecided);
    expect(result.lines.some((line) => line.includes(`key=${key}`))).toBe(true);
    expect(result.lines.some((line) => line.includes('sessions deleted'))).toBe(false);
    expect(await isRestorePending(journalDir)).toBe(true);
    await expectOwnTokensKept(fixture);
    expectNoSecrets(result.lines, fixture);
  });

  it.each(oauthCases)('OAuth refresh step: $label', async (scenario) => {
    const fixture = await createTokenFixture();
    const journalDir = await createJournalDir();
    await writeRestoreMarker(journalDir, 0);

    const result = await runRestoreReplay(runOptions(journalDir, scenario.revocation));

    expect(result.exitCode).toBe(scenario.exitCode);
    expect(result.lines.some((line) => line.includes(scenario.expectedLine))).toBe(true);
    expect(await isRestorePending(journalDir)).toBe(scenario.markerKept);
    expectNoSecrets(result.lines, fixture);
  });
});

afterAll(async () => {
  try {
    const ids = userIds.splice(0);
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordReset.deleteMany({ where: { userId: { in: ids } } });
    await prisma.emailVerification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  } finally {
    for (const dir of journalDirs.splice(0)) await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
