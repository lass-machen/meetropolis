import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { registerMiscRoutes } from './misc.js';
import { setAuthResolution } from '../utils/authState.js';

/**
 * Role changes against a REAL PostgreSQL database: demoting an owner must
 * never leave the tenant without an owner, even when two owners demote
 * each other at the same time.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('users.role.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const rawUser = req.headers['x-user'];
    const userId = typeof rawUser === 'string' ? rawUser : null;
    setAuthResolution(req, {
      auth: userId ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const rawTenant = req.headers['x-tenant'];
    if (typeof rawTenant === 'string') req.tenant = { id: rawTenant, slug: rawTenant, name: rawTenant } as never;
    next();
  });
  registerMiscRoutes(app, prisma);
  return app;
}

async function createTenant(): Promise<string> {
  const slug = `case-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(tenantId: string, role: Role): Promise<string> {
  const user = await prisma.user.create({ data: { email: `case-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId, role } });
  return user.id;
}

function changeRole(app: express.Express, callerId: string, tenantId: string, targetId: string, role: string) {
  return request(app).patch(`/users/${targetId}/role`).set('x-user', callerId).set('x-tenant', tenantId).send({ role });
}

async function roleOf(userId: string, tenantId: string): Promise<Role | undefined> {
  const membership = await prisma.membership.findFirst({ where: { userId, tenantId } });
  return membership?.role;
}

afterEach(async () => {
  const ids = userIds.splice(0);
  const tenants = tenantIds.splice(0);
  await prisma.authEvent.deleteMany({ where: { userId: { in: ids } } });
  await prisma.authEvent.deleteMany({ where: { tenantId: { in: tenants } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenants } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PATCH /users/:id/role — owner demotion (real database)', () => {
  it('lets an owner demote another owner while one owner remains', async () => {
    const tenant = await createTenant();
    const ownerA = await createUser(tenant, 'owner');
    const ownerB = await createUser(tenant, 'owner');

    const res = await changeRole(makeApp(), ownerA, tenant, ownerB, 'member');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, role: 'member' });
    expect(await roleOf(ownerB, tenant)).toBe('member');
    expect(await roleOf(ownerA, tenant)).toBe('owner');
  });

  it('rejects one of two owners demoting each other concurrently so an owner remains', async () => {
    const tenant = await createTenant();
    const ownerA = await createUser(tenant, 'owner');
    const ownerB = await createUser(tenant, 'owner');
    const app = makeApp();

    const [resA, resB] = await Promise.all([
      changeRole(app, ownerA, tenant, ownerB, 'member'),
      changeRole(app, ownerB, tenant, ownerA, 'member'),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 400]);
    const rejected = resA.status === 400 ? resA : resB;
    expect(rejected.body).toEqual({ error: 'cannot_demote_last_owner' });
    expect(await prisma.membership.count({ where: { tenantId: tenant, role: 'owner' } })).toBe(1);
  });

  it('refuses an admin changing an owner role', async () => {
    const tenant = await createTenant();
    const admin = await createUser(tenant, 'admin');
    const owner = await createUser(tenant, 'owner');

    const res = await changeRole(makeApp(), admin, tenant, owner, 'member');

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'forbidden - only owners can change owner roles' });
    expect(await roleOf(owner, tenant)).toBe('owner');
  });
});
