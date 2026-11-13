/**
 * Integration tests for the seed program's production admin-credential policy
 * and default-account cleanup. Spawns the same tsx seed program the product
 * uses. The database URL comes only from the process environment.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getApiTokenPepper, getJwtSecret } from '../api/utils/authHelpers.js';
import { claimPasswordResetToken, issuePasswordResetToken } from '../api/utils/passwordResetTokens.js';
import { hashSessionToken, validateSessionToken } from '../api/utils/sessionAuth.js';
import { clearSessionCache } from '../api/utils/sessionCache.js';
import { createPrismaClient } from '../db.js';
import type { PrismaClient } from '../generated/prisma/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(HERE, '..', '..');
const TEMPLATE_PATH = path.resolve(SERVER_DIR, '..', '..', '.env.example');
const PRODUCTION = 'production';
const DEVELOPMENT = 'development';
const SEED_TIMEOUT_MS = 180_000;
const CONFIGURED_EMAIL = 'configured-admin@seed-admin.test';
const CONTROL_EMAIL = 'control-account@seed-admin.test';
const STRONG_PASSWORD = 'synthetic-valid-admin-password';
const OTHER_STRONG_PASSWORD = 'synthetic-other-admin-password';

process.env.JWT_SECRET = 'synthetic-jwt-secret-for-seed-admin-tests';
process.env.API_TOKEN_PEPPER = 'synthetic-api-token-pepper-for-seed-admin-tests';

let prisma: PrismaClient;
let tsxBin: string;

interface SeedResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface UserSnap {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
}

describe('seed admin credentials', { timeout: 240_000 }, () => {
  beforeAll(() => {
    requiredDatabaseUrl();
    prisma = createPrismaClient();
    tsxBin = resolveTsx();
  });

  afterEach(async () => {
    clearSessionCache();
    await wipeEmail(CONFIGURED_EMAIL);
    await wipeEmail(CONTROL_EMAIL);
    await wipeEmail(templateAdminEmail());
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('production_seed_rejects_missing_email', async () => {
    await expectRejectedWithoutWrites(
      { NODE_ENV: PRODUCTION, SEED_ADMIN_PASSWORD: STRONG_PASSWORD },
      'SEED_ADMIN_EMAIL',
    );
  });

  it('production_seed_rejects_empty_email', async () => {
    for (const value of ['', '   ']) {
      await expectRejectedWithoutWrites(
        { NODE_ENV: PRODUCTION, SEED_ADMIN_EMAIL: value, SEED_ADMIN_PASSWORD: STRONG_PASSWORD },
        'SEED_ADMIN_EMAIL',
      );
    }
  });

  it('production_seed_rejects_missing_password', async () => {
    await expectRejectedWithoutWrites(
      { NODE_ENV: PRODUCTION, SEED_ADMIN_EMAIL: CONFIGURED_EMAIL },
      'SEED_ADMIN_PASSWORD',
    );
  });

  it('production_seed_rejects_empty_password', async () => {
    for (const value of ['', '   ']) {
      await expectRejectedWithoutWrites(
        { NODE_ENV: PRODUCTION, SEED_ADMIN_EMAIL: CONFIGURED_EMAIL, SEED_ADMIN_PASSWORD: value },
        'SEED_ADMIN_PASSWORD',
      );
    }
  });

  it('production_seed_rejects_default_password', async () => {
    await expectRejectedWithoutWrites(
      {
        NODE_ENV: PRODUCTION,
        SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
        SEED_ADMIN_PASSWORD: templateAdminPassword(),
      },
      'SEED_ADMIN_PASSWORD',
    );
  });

  it('existing_nondefault_admin_hash_is_preserved', async () => {
    const user = await createPasswordUser(CONFIGURED_EMAIL, STRONG_PASSWORD);
    const hashBefore = await currentHash(user.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: OTHER_STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const hashAfter = await currentHash(user.id);
    expect(hashBefore === hashAfter).toBe(true);
    expect(await passwordMatches(user.id, STRONG_PASSWORD)).toBe(true);
    expect(await passwordMatches(user.id, OTHER_STRONG_PASSWORD)).toBe(false);
  });

  it('configured_default_hash_is_migrated_only_once', { timeout: 400_000 }, async () => {
    const user = await createPasswordUser(CONFIGURED_EMAIL, templateAdminPassword());
    const first = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(first.status).toBe(0);
    const hashAfterFirstSeed = await currentHash(user.id);
    const second = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(second.status).toBe(0);
    const hashAfterSecondSeed = await currentHash(user.id);
    expect(hashAfterFirstSeed === hashAfterSecondSeed).toBe(true);
    expect(await passwordMatches(user.id, STRONG_PASSWORD)).toBe(true);
    expect(await passwordMatches(user.id, templateAdminPassword())).toBe(false);
  });

  it('legacy_default_owner_is_disabled_when_email_differs', async () => {
    const legacy = await createPasswordUser(templateAdminEmail(), templateAdminPassword());
    await grantInternalRole(legacy.id, 'owner');
    const idBefore = legacy.id;
    const emailBefore = legacy.email;
    const rolesBefore = await membershipRoles(legacy.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const after = await prisma.user.findUnique({
      where: { id: idBefore },
      select: { id: true, email: true },
    });
    expect(after !== null && after.id === idBefore && after.email === emailBefore).toBe(true);
    const rolesAfter = await membershipRoles(idBefore);
    expect(rolesBefore.join('|') === rolesAfter.join('|')).toBe(true);
    expect(await passwordMatches(idBefore, templateAdminPassword())).toBe(false);
    expect(await passwordMatches(idBefore, STRONG_PASSWORD)).toBe(false);
  });

  it('default_account_session_is_revoked_configured', async () => {
    await expectDefaultAccountSecretRevoked('configured', 'session');
  });

  it('default_account_session_is_revoked_legacy', async () => {
    await expectDefaultAccountSecretRevoked('legacy', 'session');
  });

  it('default_account_api_token_is_revoked_configured', async () => {
    await expectDefaultAccountSecretRevoked('configured', 'api_token');
  });

  it('default_account_api_token_is_revoked_legacy', async () => {
    await expectDefaultAccountSecretRevoked('legacy', 'api_token');
  });

  it('default_account_reset_token_is_revoked_configured', async () => {
    await expectDefaultAccountSecretRevoked('configured', 'reset_token');
  });

  it('default_account_reset_token_is_revoked_legacy', async () => {
    await expectDefaultAccountSecretRevoked('legacy', 'reset_token');
  });

  it('seed_diagnostics_contain_no_sensitive_values', async () => {
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    const invites = await prisma.invite.findMany({ select: { code: true } });
    const users = await prisma.user.findMany({ select: { email: true, passwordHash: true } });
    const leaked = outputContainsAny(output, [
      CONFIGURED_EMAIL,
      CONTROL_EMAIL,
      templateAdminEmail(),
      templateAdminPassword(),
      STRONG_PASSWORD,
      OTHER_STRONG_PASSWORD,
      ...users.map((row) => row.email),
      ...users.map((row) => row.passwordHash),
      ...invites.map((row) => row.code),
    ]);
    expect(leaked).toBe(false);
  });

  it('production_seed_accepts_valid_new_admin', async () => {
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const user = await prisma.user.findUnique({ where: { email: CONFIGURED_EMAIL }, select: { id: true } });
    const userId = user?.id ?? '';
    expect(userId.length > 0).toBe(true);
    expect(await passwordMatches(userId, STRONG_PASSWORD)).toBe(true);
    expect(await passwordMatches(userId, templateAdminPassword())).toBe(false);
  });

  it('production_seed_accepts_explicit_default_email', async () => {
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: templateAdminEmail(),
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const user = await prisma.user.findUnique({
      where: { email: templateAdminEmail() },
      select: { id: true },
    });
    const userId = user?.id ?? '';
    expect(userId.length > 0).toBe(true);
    expect(await passwordMatches(userId, STRONG_PASSWORD)).toBe(true);
  });

  it('development_seed_keeps_fallbacks', async () => {
    const result = runSeed({ NODE_ENV: DEVELOPMENT });
    expect(result.status).toBe(0);
    const user = await prisma.user.findUnique({
      where: { email: templateAdminEmail() },
      select: { id: true },
    });
    const userId = user?.id ?? '';
    expect(userId.length > 0).toBe(true);
    expect(await passwordMatches(userId, templateAdminPassword())).toBe(true);
  });

  it('development_seed_rerun_keeps_fallback_admin_session', { timeout: 400_000 }, async () => {
    await wipeEmail(templateAdminEmail());
    expect(runSeed({ NODE_ENV: DEVELOPMENT }).status).toBe(0);
    const user = await prisma.user.findUnique({
      where: { email: templateAdminEmail() },
      select: { id: true },
    });
    const userId = user?.id ?? '';
    expect(userId.length > 0).toBe(true);
    const token = await issueLiveSession(userId);
    expect(runSeed({ NODE_ENV: DEVELOPMENT }).status).toBe(0);
    expect(await sessionIsValid(token)).toBe(true);
    expect(await passwordMatches(userId, templateAdminPassword())).toBe(true);
  });

  it('legacy_account_with_nondefault_hash_is_untouched', async () => {
    const legacy = await createPasswordUser(templateAdminEmail(), STRONG_PASSWORD);
    await grantInternalRole(legacy.id, 'owner');
    const hashBefore = await currentHash(legacy.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: OTHER_STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const hashAfter = await currentHash(legacy.id);
    expect(hashBefore === hashAfter).toBe(true);
    expect(await passwordMatches(legacy.id, STRONG_PASSWORD)).toBe(true);
  });

  it('legacy_account_without_internal_owner_role_is_untouched', async () => {
    const legacy = await createPasswordUser(templateAdminEmail(), templateAdminPassword());
    await grantInternalRole(legacy.id, 'member');
    const hashBefore = await currentHash(legacy.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    const hashAfter = await currentHash(legacy.id);
    expect(hashBefore === hashAfter).toBe(true);
    expect(await passwordMatches(legacy.id, templateAdminPassword())).toBe(true);
  });

  it('nondefault_account_session_stays_valid', async () => {
    const control = await createPasswordUser(CONTROL_EMAIL, STRONG_PASSWORD);
    const token = await issueLiveSession(control.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: OTHER_STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    expect(await sessionIsValid(token)).toBe(true);
  });

  it('nondefault_account_api_token_stays_valid', async () => {
    const control = await createPasswordUser(CONTROL_EMAIL, STRONG_PASSWORD);
    const raw = await issueApiToken(control.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: OTHER_STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    expect(await apiTokenIsValid(raw)).toBe(true);
  });

  it('nondefault_account_reset_token_stays_valid', async () => {
    const control = await createPasswordUser(CONTROL_EMAIL, STRONG_PASSWORD);
    const raw = await issueResetToken(control.id);
    const result = runSeed({
      NODE_ENV: PRODUCTION,
      SEED_ADMIN_EMAIL: CONFIGURED_EMAIL,
      SEED_ADMIN_PASSWORD: OTHER_STRONG_PASSWORD,
    });
    expect(result.status).toBe(0);
    expect(await resetTokenIsValid(raw)).toBe(true);
  });
});

function readTemplateValue(key: string): string {
  const text = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match !== null && match[1] === key) {
      return match[2];
    }
  }
  throw new Error(`template entry missing for key: ${key}`);
}

function templateAdminEmail(): string {
  return readTemplateValue('SEED_ADMIN_EMAIL');
}

function templateAdminPassword(): string {
  return readTemplateValue('SEED_ADMIN_PASSWORD');
}

function requiredDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  return url;
}

function resolveTsx(): string {
  const names = process.platform === 'win32' ? ['tsx.cmd', 'tsx'] : ['tsx'];
  const dirs = [
    path.resolve(SERVER_DIR, 'node_modules', '.bin'),
    path.resolve(SERVER_DIR, '..', '..', 'node_modules', '.bin'),
  ];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  throw new Error('tsx executable is missing');
}

function baseSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    DATABASE_URL: requiredDatabaseUrl(),
    NODE_OPTIONS: '--no-warnings',
  };
  if (process.env.HOME) {
    env.HOME = process.env.HOME;
  }
  if (process.env.TMPDIR) {
    env.TMPDIR = process.env.TMPDIR;
  }
  return env;
}

function runSeed(overrides: Record<string, string | undefined>): SeedResult {
  const env = baseSpawnEnv();
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  const result = spawnSync(tsxBin, ['prisma/seed.ts'], {
    cwd: SERVER_DIR,
    env,
    encoding: 'utf8',
    timeout: SEED_TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function expectRejected(result: SeedResult, key: string): void {
  expect(result.status).toBe(1);
  expect(result.stderr.trim().split('\n')).toEqual([key]);
  expect(result.stdout).toBe('');
}

async function expectRejectedWithoutWrites(
  overrides: Record<string, string | undefined>,
  key: string,
): Promise<void> {
  const before = await snapshotUsers();
  const result = runSeed(overrides);
  expectRejected(result, key);
  const after = await snapshotUsers();
  expect(usersUnchanged(before, after)).toBe(true);
}

async function snapshotUsers(): Promise<UserSnap[]> {
  return prisma.user.findMany({
    select: { id: true, email: true, name: true, passwordHash: true },
    orderBy: { id: 'asc' },
  });
}

function usersUnchanged(before: UserSnap[], after: UserSnap[]): boolean {
  if (before.length !== after.length) {
    return false;
  }
  return before.every((row, index) => {
    const next = after[index];
    return (
      next !== undefined &&
      next.id === row.id &&
      next.email === row.email &&
      next.name === row.name &&
      next.passwordHash === row.passwordHash
    );
  });
}

async function createPasswordUser(email: string, password: string): Promise<{ id: string; email: string }> {
  return prisma.user.create({
    data: {
      email,
      name: 'Fixture Admin',
      passwordHash: await bcrypt.hash(password, 10),
      emailVerifiedAt: new Date(),
    },
    select: { id: true, email: true },
  });
}

async function grantInternalRole(userId: string, role: 'owner' | 'member'): Promise<void> {
  const internal = await prisma.tenant.upsert({
    where: { slug: 'internal' },
    create: {
      slug: 'internal',
      name: 'Internal',
      concurrentLimit: 999999,
      bypassLimits: true,
      isInternal: true,
      publicRegistrationEnabled: true,
    },
    update: {},
    select: { id: true },
  });
  await prisma.membership.upsert({
    where: { tenantId_userId: { tenantId: internal.id, userId } },
    update: { role },
    create: { tenantId: internal.id, userId, role },
  });
}

async function currentHash(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return user?.passwordHash ?? null;
}

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const hash = await currentHash(userId);
  if (!hash) {
    return false;
  }
  return bcrypt.compare(password, hash);
}

async function membershipRoles(userId: string): Promise<string[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    select: { tenantId: true, role: true },
    orderBy: { tenantId: 'asc' },
  });
  return rows.map((row) => `${row.tenantId}:${row.role}`);
}

async function issueLiveSession(userId: string): Promise<string> {
  const token = jwt.sign(
    { sub: userId, tid: 'seed-admin-test-tenant', jti: crypto.randomUUID() },
    getJwtSecret(),
    { expiresIn: '30d' },
  );
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

async function sessionIsValid(token: string): Promise<boolean> {
  clearSessionCache();
  const auth = await validateSessionToken(prisma, token);
  return auth !== null;
}

async function issueApiToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(getApiTokenPepper() + raw).digest('hex');
  await prisma.apiToken.create({ data: { userId, name: 'seed-admin-test', hash } });
  return raw;
}

async function apiTokenIsValid(raw: string): Promise<boolean> {
  const hash = crypto.createHash('sha256').update(getApiTokenPepper() + raw).digest('hex');
  const found = await prisma.apiToken.findUnique({ where: { hash } });
  return found !== null;
}

async function issueResetToken(userId: string): Promise<string> {
  const issued = await issuePasswordResetToken(prisma, userId);
  return issued.token;
}

async function resetTokenIsValid(raw: string): Promise<boolean> {
  const claimed = await claimPasswordResetToken(prisma, raw);
  return claimed !== null;
}

async function expectDefaultAccountSecretRevoked(
  kind: 'configured' | 'legacy',
  secret: 'session' | 'api_token' | 'reset_token',
): Promise<void> {
  const victim = await createPasswordUser(templateAdminEmail(), templateAdminPassword());
  if (kind === 'legacy') {
    await grantInternalRole(victim.id, 'owner');
  }
  const sessionToken = secret === 'session' ? await issueLiveSession(victim.id) : null;
  const apiToken = secret === 'api_token' ? await issueApiToken(victim.id) : null;
  const resetToken = secret === 'reset_token' ? await issueResetToken(victim.id) : null;
  const seedEmail = kind === 'configured' ? templateAdminEmail() : CONFIGURED_EMAIL;
  const result = runSeed({
    NODE_ENV: PRODUCTION,
    SEED_ADMIN_EMAIL: seedEmail,
    SEED_ADMIN_PASSWORD: STRONG_PASSWORD,
  });
  expect(result.status).toBe(0);
  if (sessionToken) {
    expect(await sessionIsValid(sessionToken)).toBe(false);
  }
  if (apiToken) {
    expect(await apiTokenIsValid(apiToken)).toBe(false);
  }
  if (resetToken) {
    expect(await resetTokenIsValid(resetToken)).toBe(false);
  }
}

function outputContainsAny(output: string, values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === 'string' && value.length > 0 && output.includes(value));
}

async function wipeEmail(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.apiToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordReset.deleteMany({ where: { userId: user.id } });
    await prisma.emailVerification.deleteMany({ where: { userId: user.id } });
    await prisma.presence.deleteMany({ where: { userId: user.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.invite.deleteMany({ where: { createdBy: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.invite.deleteMany({ where: { email } });
}
