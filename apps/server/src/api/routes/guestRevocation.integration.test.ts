import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { registerGuestRoutes } from './guests.js';
import { setAuthResolution } from '../utils/authState.js';
import { getJwtSecret } from '../utils/authHelpers.js';
import { hashSessionToken, validateSessionToken } from '../utils/sessionAuth.js';
import { getCachedSession } from '../utils/sessionCache.js';

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ version: 1, isMultiTenantEnabled: () => true }),
}));

/**
 * Q-ACC-19a: revoking a guest's last membership must delete the account.
 *
 * The revoke path in guests.ts deletes guest tokens, sessions and the
 * membership, but never the user row itself — unlike the shared removal
 * logic the member-removal routes use. These tests run against a real
 * PostgreSQL database and assert the user row along with the sessions.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('guestRevocation.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const tenantsById = new Map<string, { id: string; slug: string; name: string }>();

/** Same x-user/x-tenant shim as userDeletion.integration.test.ts, backed by the real client. */
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
    if (typeof rawTenant === 'string') {
      const tenant = tenantsById.get(rawTenant);
      if (tenant) req.tenant = tenant as never;
    }
    next();
  });
  registerGuestRoutes(app, prisma);
  return app;
}

async function createTenant(): Promise<{ id: string; slug: string }> {
  const slug = `qacc-guest-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  tenantsById.set(tenant.id, { id: tenant.id, slug: tenant.slug, name: tenant.name });
  return { id: tenant.id, slug: tenant.slug };
}

async function createUser(memberships: Array<{ tenantId: string; role: Role }>): Promise<string> {
  const user = await prisma.user.create({ data: { email: `qacc-guest-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  for (const m of memberships) {
    await prisma.membership.create({ data: { userId: user.id, tenantId: m.tenantId, role: m.role } });
  }
  return user.id;
}

/** A real login footprint: a signed session token with its Session row, without email verification. */
async function addLoginFootprint(userId: string, tenantId: string): Promise<string> {
  const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  return token;
}

afterEach(async () => {
  const ids = userIds.splice(0);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds.splice(0) } } });
  for (const id of [...tenantsById.keys()]) {
    if (!tenantIds.includes(id)) tenantsById.delete(id);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Q-ACC-19a DELETE /guests/:membershipId — revoking the last membership deletes the account', () => {
  it('deletes user and sessions when the revoked guest membership was the last one', async () => {
    const tenant = await createTenant();
    const owner = await createUser([{ tenantId: tenant.id, role: 'owner' }]);
    const guest = await createUser([{ tenantId: tenant.id, role: 'guest' }]);
    const guestToken = await addLoginFootprint(guest, tenant.id);
    const ownerToken = await addLoginFootprint(owner, tenant.id);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: tenant.id, userId: guest } },
    });
    await expect(validateSessionToken(prisma, guestToken)).resolves.not.toBeNull();

    const res = await request(makeApp())
      .delete(`/guests/${membership.id}`)
      .set('x-user', owner)
      .set('x-tenant', tenant.id);

    expect(res.status).toBe(200);
    expect(await prisma.membership.count({ where: { userId: guest } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: guest } })).toBe(0);
    expect(await prisma.user.count({ where: { id: guest } })).toBe(0);
    expect(getCachedSession(hashSessionToken(guestToken))).toBeNull();
    await expect(validateSessionToken(prisma, guestToken)).resolves.toBeNull();
    await expect(validateSessionToken(prisma, ownerToken)).resolves.not.toBeNull();
  });

  it('keeps the account when the guest still belongs to another tenant', async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const ownerA = await createUser([{ tenantId: tenantA.id, role: 'owner' }]);
    const guest = await createUser([
      { tenantId: tenantA.id, role: 'guest' },
      { tenantId: tenantB.id, role: 'member' },
    ]);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: tenantA.id, userId: guest } },
    });

    const res = await request(makeApp())
      .delete(`/guests/${membership.id}`)
      .set('x-user', ownerA)
      .set('x-tenant', tenantA.id);

    expect(res.status).toBe(200);
    expect(await prisma.user.count({ where: { id: guest } })).toBe(1);
    expect(await prisma.membership.count({ where: { userId: guest, tenantId: tenantB.id } })).toBe(1);
  });
});
