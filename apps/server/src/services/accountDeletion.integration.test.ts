import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import { deleteAccount, deleteTenantWithMembers, removeMemberFromTenant } from './accountDeletion.js';

/**
 * Two admins of different tenants remove the same user's last two
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
  const slug = `case-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function dropSlowDeleteTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS slow_membership_delete ON "Membership"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS slow_membership_delete()');
}

afterAll(async () => {
  await dropSlowDeleteTrigger();
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('parallel removal of the last memberships (real database)', () => {
  it('deletes the account when two tenants remove the user at the same time', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const user = await prisma.user.create({ data: { email: `case-${crypto.randomUUID()}@example.test` } });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantA, role: 'member' } });
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenantB, role: 'member' } });

    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION slow_membership_delete() RETURNS trigger AS $$
      BEGIN
        IF OLD."userId" = '${user.id}' THEN PERFORM pg_sleep(1); END IF;
        RETURN OLD;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE CONSTRAINT TRIGGER slow_membership_delete AFTER DELETE ON "Membership" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION slow_membership_delete()',
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

describe('account deletion removes the auth events (real database)', () => {
  it('deletes the auth events of the deleted account and keeps foreign rows', async () => {
    const tenantId = await createTenant();
    const user = await prisma.user.create({ data: { email: `authdel-${crypto.randomUUID()}@example.test` } });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId, role: 'member' } });
    const foreign = await prisma.user.create({ data: { email: `authdel-${crypto.randomUUID()}@example.test` } });
    userIds.push(foreign.id);

    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: user.id, tenantId } });
    await prisma.authEvent.create({ data: { type: 'logout', success: true, userId: user.id, tenantId } });
    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: foreign.id, tenantId } });

    await deleteAccount(prisma, user.id);

    expect(await prisma.authEvent.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(await prisma.authEvent.count({ where: { userId: foreign.id } })).toBe(1);
  });
});

describe('tenant deletion removes the tenant auth events (real database)', () => {
  it('drops rows of the tenant and of the orphaned account, keeps the other-tenant row', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const orphan = await prisma.user.create({ data: { email: `orphan-${crypto.randomUUID()}@example.test` } });
    userIds.push(orphan.id);
    const multi = await prisma.user.create({ data: { email: `multi-${crypto.randomUUID()}@example.test` } });
    userIds.push(multi.id);
    await prisma.membership.create({ data: { userId: orphan.id, tenantId: tenantA, role: 'member' } });
    await prisma.membership.create({ data: { userId: multi.id, tenantId: tenantA, role: 'member' } });
    await prisma.membership.create({ data: { userId: multi.id, tenantId: tenantB, role: 'member' } });

    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: orphan.id, tenantId: tenantA } });
    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: multi.id, tenantId: tenantA } });
    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: multi.id, tenantId: tenantB } });

    const result = await deleteTenantWithMembers(prisma, tenantA);

    expect(result.deletedAccounts).toBe(1);
    expect(await prisma.authEvent.count({ where: { tenantId: tenantA } })).toBe(0);
    expect(await prisma.authEvent.count({ where: { userId: orphan.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: orphan.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: multi.id } })).toBe(1);
    const kept = await prisma.authEvent.findMany({ where: { userId: multi.id } });
    expect(kept).toHaveLength(1);
    expect(kept[0]?.tenantId).toBe(tenantB);
  });
});
