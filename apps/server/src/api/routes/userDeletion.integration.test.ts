import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { registerMiscRoutes } from './misc.js';
import { setAuthResolution } from '../utils/authState.js';
import { getJwtSecret } from '../utils/authHelpers.js';
import { hashSessionToken, validateSessionToken } from '../utils/sessionAuth.js';

/**
 * Regression tests for member removal and account deletion (Q-ACC-1..3)
 * against a REAL PostgreSQL database with all migrations applied.
 *
 * No Prisma double on purpose: the defect lived in foreign-key rules
 * (`Session` and `EmailVerification` reference `User` with ON DELETE RESTRICT)
 * that only a real database enforces. The old code deleted every membership,
 * swallowed the errors and then failed on `user.delete`, so the admin saw an
 * error while the user had already vanished from every tenant.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('userDeletion.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

/** Same harness as misc.users.test.ts, but backed by the real client. */
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
  const slug = `qacc-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(memberships: Array<{ tenantId: string; role: Role }>): Promise<string> {
  const user = await prisma.user.create({ data: { email: `qacc-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  for (const m of memberships) {
    await prisma.membership.create({ data: { userId: user.id, tenantId: m.tenantId, role: m.role } });
  }
  return user.id;
}

/** A real login footprint: a signed session token with its Session row, plus a pending email verification. */
async function addLoginFootprint(userId: string, tenantId: string): Promise<string> {
  const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.emailVerification.create({
    data: {
      userId,
      token: crypto.randomUUID(),
      email: `pending-${crypto.randomUUID()}@example.test`,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return token;
}

async function rowCounts(userId: string) {
  const [users, memberships, sessions, verifications] = await Promise.all([
    prisma.user.count({ where: { id: userId } }),
    prisma.membership.count({ where: { userId } }),
    prisma.session.count({ where: { userId } }),
    prisma.emailVerification.count({ where: { userId } }),
  ]);
  return { users, memberships, sessions, verifications };
}

afterEach(async () => {
  const ids = userIds.splice(0);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.emailVerification.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('DELETE /users/:id — member removal (real database)', () => {
  it('removes a single-tenant member with sessions and a pending verification completely', async () => {
    const tenant = await createTenant();
    const admin = await createUser([{ tenantId: tenant, role: 'admin' }]);
    const member = await createUser([{ tenantId: tenant, role: 'member' }]);
    const token = await addLoginFootprint(member, tenant);

    const res = await request(makeApp()).delete(`/users/${member}`).set('x-user', admin).set('x-tenant', tenant);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, accountDeleted: true });
    expect(await rowCounts(member)).toEqual({ users: 0, memberships: 0, sessions: 0, verifications: 0 });
    expect(await validateSessionToken(prisma, token)).toBeNull();
  });

  it('removes only the membership in the admin’s tenant when the user belongs to another tenant too', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const admin = await createUser([{ tenantId: tenantA, role: 'admin' }]);
    const member = await createUser([
      { tenantId: tenantA, role: 'member' },
      { tenantId: tenantB, role: 'member' },
    ]);
    const token = await addLoginFootprint(member, tenantA);

    const res = await request(makeApp()).delete(`/users/${member}`).set('x-user', admin).set('x-tenant', tenantA);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, accountDeleted: false });
    expect(await prisma.membership.count({ where: { userId: member, tenantId: tenantA } })).toBe(0);
    expect(await prisma.membership.count({ where: { userId: member, tenantId: tenantB } })).toBe(1);
    expect(await prisma.user.count({ where: { id: member } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: member } })).toBe(0);
    expect(await validateSessionToken(prisma, token)).toBeNull();
  });

  it('refuses an admin removing an owner and changes nothing', async () => {
    const tenant = await createTenant();
    const admin = await createUser([{ tenantId: tenant, role: 'admin' }]);
    const owner = await createUser([{ tenantId: tenant, role: 'owner' }]);
    await addLoginFootprint(owner, tenant);

    const res = await request(makeApp()).delete(`/users/${owner}`).set('x-user', admin).set('x-tenant', tenant);

    expect(res.status).toBe(403);
    expect(await rowCounts(owner)).toEqual({ users: 1, memberships: 1, sessions: 1, verifications: 1 });
  });
});

describe('DELETE /users/me — self-deletion (real database)', () => {
  it('deletes the account with its sessions and pending verification', async () => {
    const tenant = await createTenant();
    await createUser([{ tenantId: tenant, role: 'owner' }]);
    const member = await createUser([{ tenantId: tenant, role: 'member' }]);
    const token = await addLoginFootprint(member, tenant);

    const res = await request(makeApp()).delete('/users/me').set('x-user', member).set('x-tenant', tenant);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(await rowCounts(member)).toEqual({ users: 0, memberships: 0, sessions: 0, verifications: 0 });
    expect(await validateSessionToken(prisma, token)).toBeNull();
  });
});
