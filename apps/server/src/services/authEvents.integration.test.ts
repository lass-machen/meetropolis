import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../db.js';
import {
  AUTH_EVENT_RETENTION_DAYS,
  authEventEmailHmac,
  purgeExpiredAuthEvents,
  recordAuthEvent,
} from './authEvents.js';

/**
 * Auth events against a REAL PostgreSQL database: recording sets the login
 * times of user and membership, the retention pass keeps only the last 30
 * days, and a failed attempt without a user stores the email digest only.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('authEvents.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

async function createTenant(): Promise<string> {
  const slug = `authevent-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(email: string): Promise<string> {
  const user = await prisma.user.create({ data: { email } });
  userIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { userId: null } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('auth events (real database)', () => {
  it('records a login and sets the user and membership login times', async () => {
    expect(AUTH_EVENT_RETENTION_DAYS).toBe(30);
    const tenantId = await createTenant();
    const email = `login-${crypto.randomUUID()}@example.test`;
    const userId = await createUser(email);
    await prisma.membership.create({ data: { userId, tenantId, role: 'member' } });

    await recordAuthEvent(prisma, { type: 'login', success: true, userId, tenantId });

    const events = await prisma.authEvent.findMany({ where: { userId } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'login', success: true, tenantId, emailHmac: null });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lastLoginAt).toBeInstanceOf(Date);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId, userId } },
    });
    expect(membership.lastLoginAt).toBeInstanceOf(Date);
    expect(membership.lastLoginAt?.getTime()).toBe(user.lastLoginAt?.getTime());
  });

  it('purges only entries older than 30 days', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    const fresh = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    await prisma.authEvent.create({ data: { type: 'login', success: true, createdAt: old } });
    await prisma.authEvent.create({ data: { type: 'login', success: true, createdAt: fresh } });

    const count = await purgeExpiredAuthEvents(prisma, now);

    expect(count).toBe(1);
    expect(await prisma.authEvent.count({ where: { createdAt: old } })).toBe(0);
    expect(await prisma.authEvent.count({ where: { createdAt: fresh } })).toBe(1);
  });

  it('stores the email digest only for a failed attempt without a user', async () => {
    const email = `Unknown-${crypto.randomUUID()}@Example.test`;

    await recordAuthEvent(prisma, { type: 'login', success: false, email });

    const events = await prisma.authEvent.findMany({
      where: { emailHmac: authEventEmailHmac(email) },
    });
    expect(events).toHaveLength(1);
    expect(events[0].userId).toBeNull();
    expect(JSON.stringify(events[0])).not.toContain('@');
  });
});
