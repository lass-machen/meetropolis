import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { removeMemberFromTenant } from './accountDeletion.js';

/**
 * S1-R7: two admins of different tenants remove the same user's last two
 * memberships at the same time. Each removal has to see the other's result,
 * otherwise both keep the account and it is left without any membership.
 * Runs against a REAL PostgreSQL database; a deferred trigger holds each
 * commit for a second, so both removals count the remaining memberships
 * before either commits.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('accountDeletion.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

async function createTenant(): Promise<string> {
  const slug = `qacc-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function dropSlowDeleteTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS qacc_r7_slow_delete ON "Membership"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS qacc_r7_slow_delete()');
}

afterAll(async () => {
  await dropSlowDeleteTrigger();
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('S1-R7 parallel removal of the last memberships (real database)', () => {
  it('deletes the account when two tenants remove the user at the same time', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const user = await prisma.user.create({ data: { email: `qacc-${crypto.randomUUID()}@example.test` } });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA, role: 'member' } });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantB, role: 'member' } });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION qacc_r7_slow_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD."userId" = '${user.id}' THEN PERFORM pg_sleep(1); END IF;
        RETURN OLD;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER qacc_r7_slow_delete AFTER DELETE ON "Membership" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qacc_r7_slow_delete()',
    );

    try {
      const results = await Promise.all([
        removeMemberFromTenant(prisma, { userId: user.id, tenantId: tenantA }),
        removeMemberFromTenant(prisma, { userId: user.id, tenantId: tenantB }),
      ]);

      expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
      expect(results.filter((result) => result.accountDeleted)).toHaveLength(1);
    } finally {
      await dropSlowDeleteTrigger();
    }
  });
});
