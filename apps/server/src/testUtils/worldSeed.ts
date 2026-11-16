import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { PrismaClient, Role } from '../generated/prisma/index.js';
import { getJwtSecret } from '../api/utils/authHelpers.js';
import { hashSessionToken, revokeSessionsForUser } from '../api/utils/sessionAuth.js';

/**
 * Shared seeding helpers for database-backed integration tests. They bundle
 * the fixture pattern the world lifecycle tests repeat: direct
 * `prisma.*.create` rows, a JWT shaped like the login flow mints it
 * (`{ sub, tid, jti }` signed with the server secret) and a `Session` row
 * holding `hashSessionToken(token)`.
 */

export interface SeededMember {
  userId: string;
  email: string;
  sessionId: string;
  token: string;
}

export interface SeedMemberOptions {
  role?: Role;
  expiresAt?: Date | null;
  userId?: string;
  email?: string;
  /**
   * Plain-text password. Stored hashed with `bcrypt.hash`, the same function
   * `src/api/routes/auth.signin.ts` hashes and verifies against at login
   * (same cost factor), so a seeded account can log in through the real
   * `/auth/login` route.
   */
  password?: string;
}

/** bcrypt cost factor, kept in step with the login route named above. */
const SEED_BCRYPT_COST = 10;

function randomEmail(): string {
  return `seed-${crypto.randomUUID()}@example.test`;
}

function randomSlug(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** Create a tenant with a random unique `t-`-prefixed slug. */
export async function seedTenant(
  prisma: PrismaClient,
  opts?: { slug?: string },
): Promise<{ id: string; slug: string }> {
  const slug = opts?.slug ?? randomSlug('t');
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  return { id: tenant.id, slug: tenant.slug };
}

/** Mint a session JWT for `userId` scoped to `tenantId` and persist its row. */
export async function issueSession(
  prisma: PrismaClient,
  userId: string,
  tenantId: string,
): Promise<{ sessionId: string; token: string }> {
  const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    select: { id: true },
  });
  return { sessionId: session.id, token };
}

/** Create a user with a membership in `tenantId` and a live session. */
export async function seedMember(
  prisma: PrismaClient,
  tenantId: string,
  opts?: SeedMemberOptions,
): Promise<SeededMember> {
  const email = opts?.email ?? randomEmail();
  const passwordHash = opts?.password !== undefined ? await bcrypt.hash(opts.password, SEED_BCRYPT_COST) : undefined;
  const user = await prisma.user.create({
    data: {
      ...(opts?.userId !== undefined ? { id: opts.userId } : {}),
      email,
      ...(passwordHash !== undefined ? { passwordHash } : {}),
    },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      tenantId,
      role: opts?.role ?? 'member',
      ...(opts?.expiresAt !== undefined ? { expiresAt: opts.expiresAt } : {}),
    },
  });
  const { sessionId, token } = await issueSession(prisma, user.id, tenantId);
  return { userId: user.id, email, sessionId, token };
}

/**
 * Delete `tenantIds` with their memberships plus the users and sessions left
 * without any membership. Users who still belong to another tenant keep their
 * rows and sessions, so one test's cleanup cannot orphan a neighbour tenant's
 * fixtures. Order follows the existing integration tests: sessions,
 * memberships, users, tenants.
 */
export async function cleanupTenants(prisma: PrismaClient, tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const members = await prisma.membership.findMany({
    where: { tenantId: { in: tenantIds } },
    select: { userId: true },
  });
  const memberIds = [...new Set(members.map((member) => member.userId))];
  await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  const survivors = await prisma.membership.findMany({
    where: { userId: { in: memberIds } },
    select: { userId: true },
  });
  const survivorIds = new Set(survivors.map((member) => member.userId));
  const orphanedIds = memberIds.filter((id) => !survivorIds.has(id));
  if (orphanedIds.length > 0) {
    for (const userId of orphanedIds) await revokeSessionsForUser(prisma, userId);
    await prisma.user.deleteMany({ where: { id: { in: orphanedIds } } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
}
