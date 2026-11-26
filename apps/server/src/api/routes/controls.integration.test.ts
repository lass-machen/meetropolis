import crypto from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { Role, Tenant } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { resolveTenantBySlug } from '../../tenancy.js';
import { guestExpiryMiddleware } from '../middleware/guestExpiry.js';
import { createTenantAccessMiddleware } from '../middleware/tenantAccess.js';
import { getJwtSecret, requireApiToken, requireAuth } from '../utils/authHelpers.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { registerControlRoutes } from './controls.js';

if (!process.env.DATABASE_URL) {
  throw new Error('controls.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let app: express.Express;
let appBrokenGuard: express.Express;
let appNoTenant: express.Express;
let brokenPrisma: PrismaClient;
let tenantA: Tenant;
let tenantB: Tenant;
let sendCalls: Array<{ sessionId: string; event: string; data: unknown }>;

async function createTenant(): Promise<Tenant> {
  const slug = `controls-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant;
}

async function createUser(
  memberships: Array<{ tenantId: string; role: Role; expiresAt?: Date }>,
): Promise<{ id: string; session: string }> {
  const user = await prisma.user.create({ data: { email: `controls-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  for (const membership of memberships) {
    await prisma.membership.create({ data: { userId: user.id, ...membership } });
  }

  const tenantId = memberships[0]?.tenantId;
  if (!tenantId) throw new Error('controls integration users require a primary tenant');
  const session = jwt.sign({ sub: user.id, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(session), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, session };
}

function setWorldRoom(callerId: string, targetId: string, tenantKey: string): void {
  const players = new Map([
    ['caller-session', { identity: callerId }],
    ['target-session', { identity: targetId }],
  ]);
  const playerTenantKey = new Map([
    ['caller-session', tenantKey],
    ['target-session', tenantKey],
  ]);
  const clients = ['caller-session', 'target-session'].map((sessionId) => ({
    sessionId,
    send: (event: string, data: unknown) => sendCalls.push({ sessionId, event, data }),
  }));
  const room = { state: { players }, playerTenantKey, clients };
  Object.defineProperty(globalThis, 'gameServer', { configurable: true, writable: true, value: {} });
  Object.defineProperty(globalThis, 'activeWorldRooms', {
    configurable: true,
    writable: true,
    value: new Set([room]),
  });
}

function targetedRequest(targetId: string, session: string, tenantSlug: string) {
  return request(app)
    .post(`/controls/for/${targetId}`)
    .set('x-tenant', tenantSlug)
    .set('Authorization', `Bearer ${session}`)
    .send({ mic: false });
}

function targetedRequestOn(appInstance: express.Express, targetId: string, session: string, tenantSlug?: string) {
  const pending = request(appInstance).post(`/controls/for/${targetId}`).set('Authorization', `Bearer ${session}`);
  if (tenantSlug) pending.set('x-tenant', tenantSlug);
  return pending.send({ mic: false });
}

async function resolveRealTenant(req: express.Request): Promise<void> {
  const tenant = await resolveTenantBySlug(prisma, req);
  req.tenant = tenant ?? undefined;
  req.tenantId = tenant?.id;
}

function resolveNoTenant(req: express.Request): Promise<void> {
  // This mirrors resolveTenantBySlug returning null: in production an unknown
  // explicit slug resolves to no tenant (see tenancy.ts resolveExplicitSlug),
  // so the request legitimately carries no tenant context at all.
  req.tenant = undefined;
  req.tenantId = undefined;
  return Promise.resolve();
}

function buildControlApp(
  guardPrisma: PrismaClient,
  resolveTenant: (req: express.Request) => Promise<void>,
): express.Express {
  const controlApp = express();
  controlApp.use(express.json());
  controlApp.use((req, _res, next) => {
    void resolveTenant(req)
      .then(() => next())
      .catch((error: unknown) => next(error));
  });
  controlApp.use(createSessionAuthMiddleware(prisma));
  controlApp.use(createTenantAccessMiddleware(guardPrisma));
  controlApp.use(guestExpiryMiddleware);
  registerControlRoutes(controlApp, requireAuth, (req) => requireApiToken(req, prisma));
  return controlApp;
}

beforeAll(async () => {
  tenantA = await createTenant();
  tenantB = await createTenant();

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
  app.use(guestExpiryMiddleware);
  registerControlRoutes(app, requireAuth, (req) => requireApiToken(req, prisma));

  brokenPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: 'postgresql://s1http:s1http@127.0.0.1:1/unreachable' }),
  });
  appBrokenGuard = buildControlApp(brokenPrisma, resolveRealTenant);
  appNoTenant = buildControlApp(prisma, resolveNoTenant);
});

beforeEach(() => {
  sendCalls = [];
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'gameServer');
  Reflect.deleteProperty(globalThis, 'activeWorldRooms');
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await brokenPrisma.$disconnect();
  await prisma.$disconnect();
});

describe('POST /controls/for/:identity with a verified request tenant (real database)', () => {
  it('allows an active member of tenant A to control the target seated under A', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequest(target.id, caller.session, tenantA.slug);

    expect(res.status).toBe(200);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({
      sessionId: 'target-session',
      event: 'remote_controls_for',
      data: { forIdentity: target.id, from: caller.id, payload: { mic: false } },
    });
  });

  it('refuses a caller whose tenant A membership was removed after session creation', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    await prisma.membership.delete({ where: { tenantId_userId: { tenantId: tenantA.id, userId: caller.id } } });
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequest(target.id, caller.session, tenantA.slug);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_member_of_tenant' });
    expect(sendCalls).toHaveLength(0);
  });

  it('expires a guest session before targeted controls can be delivered', async () => {
    const caller = await createUser([
      { tenantId: tenantA.id, role: 'guest', expiresAt: new Date(Date.now() - 60_000) },
    ]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    setWorldRoom(caller.id, target.id, tenantA.id);

    const expired = await targetedRequest(target.id, caller.session, tenantA.slug);
    expect(expired.status).toBe(403);
    expect(expired.body).toEqual({ error: 'guest_expired' });
    expect(sendCalls).toHaveLength(0);

    const replay = await targetedRequest(target.id, caller.session, tenantA.slug);
    expect(replay.status).toBe(401);
    expect(sendCalls).toHaveLength(0);
  });

  it('does not use tenant A seats when the request was verified against tenant B', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    await prisma.membership.delete({ where: { tenantId_userId: { tenantId: tenantA.id, userId: caller.id } } });
    await prisma.membership.create({ data: { tenantId: tenantB.id, userId: caller.id, role: 'member' } });
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequest(target.id, caller.session, tenantB.slug);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'caller_tenant_unknown' });
    expect(sendCalls).toHaveLength(0);
  });

  it('serves a session-token tenant without an X-Tenant header, like the web client', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequestOn(app, target.id, caller.session);

    expect(res.status).toBe(200);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({
      sessionId: 'target-session',
      event: 'remote_controls_for',
      data: { forIdentity: target.id, from: caller.id, payload: { mic: false } },
    });
  });

  it('refuses a session-token tenant whose membership was removed after session creation', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    await prisma.membership.delete({ where: { tenantId_userId: { tenantId: tenantA.id, userId: caller.id } } });
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequestOn(app, target.id, caller.session);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_member_of_tenant' });
    expect(sendCalls).toHaveLength(0);
  });

  it('fails closed when the guard cannot reach the database', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequestOn(appBrokenGuard, target.id, caller.session, tenantA.slug);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not_member_of_tenant' });
    expect(sendCalls).toHaveLength(0);
  });

  it('requires a tenant when none could be resolved', async () => {
    const caller = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    const target = await createUser([{ tenantId: tenantA.id, role: 'member' }]);
    setWorldRoom(caller.id, target.id, tenantA.id);

    const res = await targetedRequestOn(appNoTenant, target.id, caller.session);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'tenant_required' });
    expect(sendCalls).toHaveLength(0);
  });
});
