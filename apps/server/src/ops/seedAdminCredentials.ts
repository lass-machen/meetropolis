/**
 * Production policy for the seed-admin credential pair, plus the default-hash
 * rotation the seed applies after that policy accepts a run.
 *
 * Mode detection is the shared helper in credentialPolicy.ts. This module only
 * adds the seed-admin rules: a production seed refuses a missing or blank
 * email and a missing, blank, or public-template password, and it never
 * requires LiveKit or tools credentials. Development keeps the historical
 * fallbacks. The helper never prints values, hashes, or identifiers.
 */

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { revokeSessionsForUserInTx } from '../api/utils/sessionAuth.js';
import { invalidateSessionsForUser } from '../api/utils/sessionCache.js';
import type { PrismaClient } from '../generated/prisma/index.js';
import { isProductionEnvironment } from './credentialPolicy.js';

const INTERNAL_TENANT_SLUG = 'internal';
const BCRYPT_ROUNDS = 10;
const FALLBACK_ADMIN_NAME = 'Root Admin';

// Known public seed-admin placeholders. Derived once from the versioned
// template keys SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD so production
// comparison does not re-read the template file at runtime.
const TEMPLATE_SEED_ADMIN_EMAIL = 'admin@meetropolis.local';
const TEMPLATE_SEED_ADMIN_PASSWORD = 'admin123';

export interface SeedAdminCredentials {
  email: string;
  password: string;
  name: string;
}

export function findInvalidSeedAdminKeys(env: Record<string, string | undefined>): string[] {
  if (!isProductionEnvironment(env)) {
    return [];
  }
  const invalid: string[] = [];
  if (!isPresentValue(env.SEED_ADMIN_EMAIL)) {
    invalid.push('SEED_ADMIN_EMAIL');
  }
  if (!isUsableAdminPassword(env.SEED_ADMIN_PASSWORD)) {
    invalid.push('SEED_ADMIN_PASSWORD');
  }
  return invalid;
}

export function enforceSeedAdminCredentials(env: Record<string, string | undefined>): void {
  const invalidKeys = findInvalidSeedAdminKeys(env);
  if (invalidKeys.length === 0) {
    return;
  }
  for (const key of invalidKeys) {
    process.stderr.write(`${key}\n`);
  }
  process.exit(1);
}

export function resolveSeedAdminCredentials(env: Record<string, string | undefined>): SeedAdminCredentials {
  return {
    email: presentOrFallback(env.SEED_ADMIN_EMAIL, TEMPLATE_SEED_ADMIN_EMAIL),
    password: presentOrFallback(env.SEED_ADMIN_PASSWORD, TEMPLATE_SEED_ADMIN_PASSWORD),
    name: presentOrFallback(env.SEED_ADMIN_NAME, FALLBACK_ADMIN_NAME),
  };
}

export async function applySeedAdminCredentials(
  prisma: PrismaClient,
  env: Record<string, string | undefined>,
): Promise<{ id: string; email: string }> {
  const credentials = resolveSeedAdminCredentials(env);
  const admin = await ensureConfiguredAdmin(prisma, credentials);
  await disableLegacyDefaultOwner(prisma, credentials.email);
  return admin;
}

function isPresentValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isUsableAdminPassword(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }
  return trimmed !== TEMPLATE_SEED_ADMIN_PASSWORD;
}

function presentOrFallback(value: string | undefined, fallback: string): string {
  if (value !== undefined && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

async function ensureConfiguredAdmin(
  prisma: PrismaClient,
  credentials: SeedAdminCredentials,
): Promise<{ id: string; email: string }> {
  const existing = await prisma.user.findUnique({
    where: { email: credentials.email },
    select: { id: true, email: true, passwordHash: true },
  });
  if (!existing) {
    const created = await prisma.user.create({
      data: {
        email: credentials.email,
        name: credentials.name,
        passwordHash: await bcrypt.hash(credentials.password, BCRYPT_ROUNDS),
        emailVerifiedAt: new Date(),
      },
      select: { id: true, email: true },
    });
    console.log('Seeded admin user');
    return created;
  }
  if (existing.passwordHash) {
    await rotateDefaultHashIfNeeded(prisma, existing.id, existing.passwordHash, credentials.password);
  }
  return { id: existing.id, email: existing.email };
}

async function disableLegacyDefaultOwner(prisma: PrismaClient, configuredEmail: string): Promise<void> {
  if (configuredEmail === TEMPLATE_SEED_ADMIN_EMAIL) {
    return;
  }
  const legacy = await prisma.user.findUnique({
    where: { email: TEMPLATE_SEED_ADMIN_EMAIL },
    select: { id: true, passwordHash: true },
  });
  if (!legacy?.passwordHash) {
    return;
  }
  const isInternalOwner = await userIsInternalOwner(prisma, legacy.id);
  if (!isInternalOwner) {
    return;
  }
  const stillDefault = await bcrypt.compare(TEMPLATE_SEED_ADMIN_PASSWORD, legacy.passwordHash);
  if (!stillDefault) {
    return;
  }
  const nextHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);
  await applyAtomicCredentialRotation(prisma, legacy.id, legacy.passwordHash, nextHash);
}

async function rotateDefaultHashIfNeeded(
  prisma: PrismaClient,
  userId: string,
  currentHash: string,
  nextPassword: string,
): Promise<void> {
  // A development re-run with the fallback password has nothing to rotate;
  // rotating would only revoke the admin's sessions and tokens.
  if (nextPassword === TEMPLATE_SEED_ADMIN_PASSWORD) {
    return;
  }
  const stillDefault = await bcrypt.compare(TEMPLATE_SEED_ADMIN_PASSWORD, currentHash);
  if (!stillDefault) {
    return;
  }
  const nextHash = await bcrypt.hash(nextPassword, BCRYPT_ROUNDS);
  await applyAtomicCredentialRotation(prisma, userId, currentHash, nextHash);
}

async function userIsInternalOwner(prisma: PrismaClient, userId: string): Promise<boolean> {
  const internal = await prisma.tenant.findUnique({ where: { slug: INTERNAL_TENANT_SLUG } });
  if (!internal) {
    return false;
  }
  const member = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId: internal.id, userId } },
    select: { role: true },
  });
  return member?.role === 'owner';
}

async function applyAtomicCredentialRotation(
  prisma: PrismaClient,
  userId: string,
  expectedHash: string,
  nextHash: string,
): Promise<void> {
  const outcome = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: userId, passwordHash: expectedHash },
      data: { passwordHash: nextHash },
    });
    if (updated.count !== 1) {
      return { rotated: false, sessions: 0, tokens: 0, resets: 0 };
    }
    const sessions = await revokeSessionsForUserInTx(tx, userId);
    const tokens = await tx.apiToken.deleteMany({ where: { userId } });
    const resets = await tx.passwordReset.deleteMany({ where: { userId, usedAt: null } });
    return { rotated: true, sessions, tokens: tokens.count, resets: resets.count };
  });
  if (!outcome.rotated) {
    return;
  }
  // Required after the commit (see revokeSessionsForUserInTx). The seed runs as
  // its own process, so this clears only its own cache; a running server drops
  // the revoked sessions within SESSION_CACHE_TTL_MS.
  invalidateSessionsForUser(userId);
  console.log(
    `Rotated a default admin credential; revoked sessions=${outcome.sessions} ` +
      `apiTokens=${outcome.tokens} resetTokens=${outcome.resets}`,
  );
}
