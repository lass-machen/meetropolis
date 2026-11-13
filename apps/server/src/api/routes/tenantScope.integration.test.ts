import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role, Tenant } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { resolveTenantBySlug } from '../../tenancy.js';
import { createTenantAccessMiddleware } from '../middleware/tenantAccess.js';
import { getApiTokenPepper, getJwtSecret, getTenantFromReq, requireAuth } from '../utils/authHelpers.js';
import { invalidateSessionsForUser } from '../utils/sessionCache.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { handleAuthPosition } from './auth.profile.js';
import { registerNpcRoutes } from './npcs.js';
import { registerPresenceRoutes } from './presence.js';

if (!process.env.DATABASE_URL) {
  throw new Error('tenantScope.integration.test.ts requires an isolated migrated DATABASE_URL');
}
const databaseUrl = new URL(process.env.DATABASE_URL);
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '35440') {
  throw new Error('This test requires the local test database on port 35440');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
type Caller = { id: string; session: string; apiToken: string };
let app: express.Express;
let tenantA: Tenant;
let tenantB: Tenant;
let memberA: Caller;
let memberB: Caller;
let npcId: string;
let roomA: string;

async function createTenant(): Promise<Tenant> {
  const slug = `scope-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  const map = await prisma.map.create({ data: { tenantId: tenant.id, name: 'office', meta: {} } });
  await prisma.room.create({ data: { tenantId: tenant.id, mapId: map.id, name: `scope-${tenant.id}` } });
  return tenant;
}

async function createCaller(tenant: Tenant, role: Role = 'member', expiresAt?: Date): Promise<Caller> {
  const user = await prisma.user.create({ data: { email: `scope-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role, expiresAt } });
  const session = jwt.sign({ sub: user.id, tid: tenant.id, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(session), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const apiToken = `mt_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto
    .createHash('sha256')
    .update(getApiTokenPepper() + apiToken)
    .digest('hex');
  await prisma.apiToken.create({ data: { userId: user.id, hash, name: 'scope-fixture' } });
  return { id: user.id, session, apiToken };
}

function expectDenied(res: request.Response): void {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'tenant_required' });
}

beforeAll(async () => {
  tenantA = await createTenant();
  tenantB = await createTenant();
  roomA = `scope-${tenantA.id}`;
  memberA = await createCaller(tenantA);
  memberB = await createCaller(tenantB);
  const npc = await prisma.npc.create({
    data: { tenantId: tenantB.id, identity: `scope-${crypto.randomUUID()}`, name: 'Scope fixture' },
  });
  npcId = npc.id;
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    void resolveTenantBySlug(prisma, req)
      .then((tenant) => {
        req.tenant = tenant ?? undefined;
        req.tenantId = tenant?.id;
        next();
      })
      .catch((error: unknown) => next(error));
  });
  app.use(createSessionAuthMiddleware(prisma));
  app.use(createTenantAccessMiddleware(prisma));
  registerPresenceRoutes(app, prisma, requireAuth, getTenantFromReq);
  registerNpcRoutes(app, prisma);
  app.post('/auth/position', (req, res) => handleAuthPosition(prisma, req, res));
});

afterAll(async () => {
  for (const userId of userIds) invalidateSessionsForUser(userId);
  try {
    await prisma.presence.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.npc.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.room.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.map.deleteMany({ where: { tenantId: { in: tenantIds } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  } finally {
    await prisma.$disconnect();
  }
});

describe('tenant route authorization through the real resolver and database', () => {
  it('serves presence only for the resolved tenant of an active member', async () => {
    const own = await request(app)
      .get('/presence/recent')
      .set('x-tenant', tenantA.slug)
      .set('Authorization', `Bearer ${memberA.session}`);
    expect(own.status).toBe(200);
    expect(own.body).toContainEqual(expect.objectContaining({ userId: memberA.id }));
    expect(own.body).not.toContainEqual(expect.objectContaining({ userId: memberB.id }));
    expectDenied(
      await request(app)
        .get('/presence/recent')
        .set('x-tenant', tenantB.slug)
        .set('Authorization', `Bearer ${memberA.session}`),
    );
  });

  it('resolves query tenant before the session tenant and header before query', async () => {
    expectDenied(
      await request(app)
        .get('/presence/recent')
        .query({ tenant: tenantB.slug })
        .set('Authorization', `Bearer ${memberA.session}`),
    );
    const own = await request(app)
      .get('/presence/recent')
      .query({ tenant: tenantB.slug })
      .set('x-tenant', tenantA.slug)
      .set('Authorization', `Bearer ${memberA.session}`);
    expect(own.status).toBe(200);
    expect(own.body).toContainEqual(expect.objectContaining({ userId: memberA.id }));
  });

  it('writes presence only in the proven tenant and preserves it after foreign writes', async () => {
    const position = { roomId: roomA, x: 12, y: 24, direction: 'down' };
    const own = await request(app)
      .post('/auth/position')
      .set('x-tenant', tenantA.slug)
      .set('Authorization', `Bearer ${memberA.session}`)
      .send(position);
    expect(own.status).toBe(200);
    const before = await prisma.presence.findMany({ where: { userId: memberA.id } });
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ tenantId: tenantA.id, x: 12, y: 24 });
    expectDenied(
      await request(app)
        .post('/auth/position')
        .set('x-tenant', tenantB.slug)
        .set('Authorization', `Bearer ${memberA.session}`)
        .send({ ...position, x: 99 }),
    );
    expect(await prisma.presence.findMany({ where: { userId: memberA.id } })).toEqual(before);
  });

  it('refuses the actual NPC command route to foreign session and API-token callers', async () => {
    const before = await prisma.npc.findUniqueOrThrow({ where: { id: npcId } });
    for (const token of [memberA.session, memberA.apiToken]) {
      expectDenied(
        await request(app)
          .post(`/npcs/${npcId}/command`)
          .set('x-tenant', tenantB.slug)
          .set('Authorization', `Bearer ${token}`)
          .send({ action: 'stop_movement' }),
      );
    }
    expect(await prisma.npc.findUniqueOrThrow({ where: { id: npcId } })).toEqual(before);
  });

  it('allows the same command for its active member without an external NPC service', async () => {
    expect(global.activeWorldRooms?.size ?? 0).toBe(0);
    const result = await request(app)
      .post(`/npcs/${npcId}/command`)
      .set('x-tenant', tenantB.slug)
      .set('Authorization', `Bearer ${memberB.session}`)
      .send({ action: 'stop_movement' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, delivered: 0 });
  });

  it('refuses expired guests and memberships removed after session creation', async () => {
    const expired = await createCaller(tenantA, 'guest', new Date(Date.now() - 60_000));
    const removed = await createCaller(tenantA);
    await prisma.membership.delete({ where: { tenantId_userId: { tenantId: tenantA.id, userId: removed.id } } });
    for (const caller of [expired, removed]) {
      expectDenied(
        await request(app)
          .get('/presence/recent')
          .set('x-tenant', tenantA.slug)
          .set('Authorization', `Bearer ${caller.session}`),
      );
      expectDenied(
        await request(app)
          .post('/auth/position')
          .set('x-tenant', tenantA.slug)
          .set('Authorization', `Bearer ${caller.session}`)
          .send({ x: 1, y: 1, direction: 'down' }),
      );
      expect(await prisma.presence.count({ where: { userId: caller.id } })).toBe(0);
    }
  });
});
