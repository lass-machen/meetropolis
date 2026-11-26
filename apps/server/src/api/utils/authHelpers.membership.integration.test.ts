/**
 * requireMembership with both rules in force: the membership gate (unconfirmed
 * invite, ended access) and the access end in the result, which the LiveKit
 * token lifetime reads (health.ts). Real PostgreSQL through db.js, no mocks.
 */

import crypto from 'crypto';
import type express from 'express';
import { afterAll, describe, expect, it } from 'vitest';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { requireMembership } from './authHelpers.js';

if (!process.env.DATABASE_URL) {
  throw new Error('authHelpers.membership.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

interface MembershipSeed {
  role: Role;
  expiresAt?: Date | null;
  inviteVerificationRequired?: boolean;
}

async function seedMembership(seed: MembershipSeed) {
  const slug = `membership-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  const user = await prisma.user.create({ data: { email: `${slug}@example.test`, emailVerifiedAt: new Date() } });
  userIds.push(user.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: user.id, ...seed } });
  // requireMembership reads only req.tenant, which the tenant middleware sets in production.
  return { req: { tenant } as unknown as express.Request, userId: user.id };
}

afterAll(async () => {
  await prisma.membership.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('requireMembership', () => {
  it('returns the role and no access end for a confirmed permanent member', async () => {
    const { req, userId } = await seedMembership({ role: 'member' });
    await expect(requireMembership(req, userId, prisma)).resolves.toEqual({ role: 'member', expiresAt: null });
  });

  it('returns the access end of a guest whose access is still running', async () => {
    const end = new Date(Date.now() + 3_600_000);
    const { req, userId } = await seedMembership({ role: 'guest', expiresAt: end });
    await expect(requireMembership(req, userId, prisma)).resolves.toEqual({ role: 'guest', expiresAt: end });
  });

  it('refuses a guest whose access has ended', async () => {
    const { req, userId } = await seedMembership({ role: 'guest', expiresAt: new Date(Date.now() - 1_000) });
    await expect(requireMembership(req, userId, prisma)).resolves.toBeNull();
  });

  it('refuses a membership that still waits for the invite confirmation, even with a running access end', async () => {
    const { req, userId } = await seedMembership({
      role: 'guest',
      expiresAt: new Date(Date.now() + 3_600_000),
      inviteVerificationRequired: true,
    });
    await expect(requireMembership(req, userId, prisma)).resolves.toBeNull();
  });

  it('refuses a request without a resolved tenant', async () => {
    const { userId } = await seedMembership({ role: 'member' });
    await expect(requireMembership({} as express.Request, userId, prisma)).resolves.toBeNull();
  });
});
