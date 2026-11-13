import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { getApiTokenPepper, getJwtSecret, getTenantFromReq } from '../utils/authHelpers.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { createTenantAccessMiddleware } from './tenantAccess.js';

/**
 * The central tenant guard against a REAL PostgreSQL database, for the
 * multi-tenant resolution paths the OSS single-tenant stack cannot exercise:
 * a client-chosen tenant (X-Tenant) and API-token callers.
 *
 * The first middleware stands in for the enterprise resolution of an explicit
 * X-Tenant signal (tenancy.ts resolveTenantBySlug); everything after it is the
 * production code: session middleware, tenant guard, getTenantFromReq.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tenantAccess.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let app: express.Express;
let tenantA: string;
let tenantB: string;

async function createTenant(slug = `qacc-${crypto.randomUUID()}`): Promise<string> {
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createUser(
  memberships: Array<{ tenantId: string; role: Role; expiresAt?: Date }>,
): Promise<{ id: string; session: string }> {
  const user = await prisma.user.create({ data: { email: `qacc-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  for (const m of memberships) await prisma.membership.create({ data: { userId: user.id, ...m } });
  const session = jwt.sign({ sub: user.id, tid: memberships[0]?.tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(session), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, session };
}

async function createApiToken(userId: string): Promise<string> {
  const raw = `mt_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto
    .createHash('sha256')
    .update(getApiTokenPepper() + raw)
    .digest('hex');
  await prisma.apiToken.create({ data: { userId, hash, name: 'qacc' } });
  return raw;
}

/** The tenant id the route handler sees for a request naming `tenantId`, or null. */
async function resolvedTenant(tenantId: string, bearer?: string): Promise<string | null> {
  const req = request(app).get('/probe').set('x-tenant', tenantId);
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  const res = await req.expect(200);
  return res.body.tenantId;
}

beforeAll(async () => {
  tenantA = await createTenant();
  tenantB = await createTenant();
  app = express();
  app.use(async (req, _res, next) => {
    const id = req.headers['x-tenant'];
    const tenant = typeof id === 'string' ? await prisma.tenant.findUnique({ where: { id } }) : null;
    if (tenant) req.tenant = tenant;
    next();
  });
  app.use(createSessionAuthMiddleware(prisma));
  app.use(createTenantAccessMiddleware(prisma));
  const probe: express.RequestHandler = (req, res) => {
    res.json({ tenantId: getTenantFromReq(req)?.id ?? null });
  };
  app.get('/probe', probe);
  // Same path as the enterprise tenant sign-up (first own tenant at onboarding).
  app.post('/public/tenants', probe);
});

afterAll(async () => {
  await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('central tenant guard (real database)', () => {
  it('keeps the tenant for its members', async () => {
    const member = await createUser([{ tenantId: tenantB, role: 'member' }]);
    expect(await resolvedTenant(tenantB, member.session)).toBe(tenantB);
  });

  it('drops a foreign tenant named via X-Tenant by a member of another tenant', async () => {
    const outsider = await createUser([{ tenantId: tenantA, role: 'owner' }]);
    expect(await resolvedTenant(tenantB, outsider.session)).toBeNull();
  });

  it('drops the tenant for an expired guest', async () => {
    const guest = await createUser([{ tenantId: tenantB, role: 'guest', expiresAt: new Date(Date.now() - 60_000) }]);
    expect(await resolvedTenant(tenantB, guest.session)).toBeNull();
  });

  it('applies the same rule to API-token callers', async () => {
    const outsider = await createUser([{ tenantId: tenantA, role: 'admin' }]);
    const member = await createUser([{ tenantId: tenantB, role: 'admin' }]);
    expect(await resolvedTenant(tenantB, await createApiToken(outsider.id))).toBeNull();
    expect(await resolvedTenant(tenantB, await createApiToken(member.id))).toBe(tenantB);
  });

  it('keeps the tenant for operators (owners of the internal tenant)', async () => {
    const existing = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    // Reuse a seeded internal tenant; otherwise create one (removed in afterAll).
    const internalId = existing?.id ?? (await createTenant('internal'));
    const operator = await createUser([{ tenantId: internalId, role: 'owner' }]);
    expect(await resolvedTenant(tenantB, operator.session)).toBe(tenantB);
  });

  it('keeps the tenant for the tenant sign-up of a signed-in user without any membership', async () => {
    const newcomer = await createUser([]);
    const res = await request(app)
      .post('/public/tenants')
      .set('x-tenant', tenantB)
      .set('Authorization', `Bearer ${newcomer.session}`)
      .expect(200);
    expect(res.body.tenantId).toBe(tenantB);
  });

  it('leaves anonymous requests untouched (login and registration need the tenant)', async () => {
    expect(await resolvedTenant(tenantB)).toBe(tenantB);
  });
});
