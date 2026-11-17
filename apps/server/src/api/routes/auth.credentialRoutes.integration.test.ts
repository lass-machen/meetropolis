import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../generated/prisma/index.js';
import type { Tenant } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { logger } from '../../logger.js';
import { resolveTenantBySlug } from '../../tenancy.js';
import { guestExpiryMiddleware } from '../middleware/guestExpiry.js';
import { createTenantAccessMiddleware } from '../middleware/tenantAccess.js';
import { getJwtSecret } from '../utils/authHelpers.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import { issuePasswordResetToken } from '../utils/passwordResetTokens.js';
import { registerAuthRoutes } from './auth.js';

if (!process.env.DATABASE_URL) {
  throw new Error('auth.credentialRoutes.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
let app: express.Express;
let appBrokenGuard: express.Express;
let brokenPrisma: PrismaClient;
let tenantA: Tenant;
let tenantB: Tenant;
let userX: { id: string; session: string };
let userY: { id: string; email: string; name: string };
const password = 'valid-password-123';

async function createTenant(): Promise<Tenant> {
  const slug = `credential-${crypto.randomUUID()}`;
  const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
  tenantIds.push(tenant.id);
  return tenant;
}

async function createSession(userId: string, tenantId: string): Promise<string> {
  const token = jwt.sign({ sub: userId, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), { expiresIn: '1h' });
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return token;
}

function expectLoginForY(res: request.Response): void {
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ id: userY.id, email: userY.email, name: userY.name });

  const payload = jwt.verify(res.body.token, getJwtSecret());
  if (typeof payload !== 'object' || payload === null)
    throw new Error('login response token must contain a JWT object');
  expect(payload.sub).toBe(userY.id);
  expect(payload.tid).toBe(tenantB.id);
}

function login(path: string) {
  return loginOn(app, path);
}

function loginOn(appInstance: express.Express, path: string) {
  return request(appInstance)
    .post(path)
    .set('x-tenant', tenantB.slug)
    .set('Authorization', `Bearer ${userX.session}`)
    .send({ email: userY.email, password });
}

function denialWarnCalls(warnSpy: ReturnType<typeof vi.spyOn>) {
  return warnSpy.mock.calls.filter(
    ([first]: [unknown]) =>
      typeof first === 'object' && first !== null && (first as { event?: string }).event === 'tenant.access_denied',
  );
}

beforeAll(async () => {
  tenantA = await createTenant();
  tenantB = await createTenant();

  const x = await prisma.user.create({
    data: { email: `credential-x-${crypto.randomUUID()}@example.test`, name: 'User X' },
  });
  userIds.push(x.id);
  await prisma.membership.create({ data: { tenantId: tenantA.id, userId: x.id, role: 'member' } });
  userX = { id: x.id, session: await createSession(x.id, tenantA.id) };

  const y = await prisma.user.create({
    data: {
      email: `credential-y-${crypto.randomUUID()}@example.test`,
      name: 'User Y',
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  userIds.push(y.id);
  await prisma.membership.create({ data: { tenantId: tenantB.id, userId: y.id, role: 'member' } });
  userY = { id: y.id, email: y.email, name: y.name ?? '' };

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
  registerAuthRoutes(app, prisma);
  app.use(guestExpiryMiddleware);

  brokenPrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: 'postgresql://s1http:s1http@127.0.0.1:1/unreachable' }),
  });
  appBrokenGuard = express();
  appBrokenGuard.use(express.json());
  appBrokenGuard.use((req, _res, next) => {
    void resolveTenantBySlug(prisma, req)
      .then((tenant) => {
        req.tenant = tenant ?? undefined;
        req.tenantId = tenant?.id;
        next();
      })
      .catch((error: unknown) => next(error));
  });
  appBrokenGuard.use(createSessionAuthMiddleware(prisma));
  appBrokenGuard.use(createTenantAccessMiddleware(brokenPrisma));
  registerAuthRoutes(appBrokenGuard, prisma);
  appBrokenGuard.use(guestExpiryMiddleware);
});

afterAll(async () => {
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordReset.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await brokenPrisma.$disconnect();
  await prisma.$disconnect();
});

describe('credential login routes with a foreign session (real database)', () => {
  it('logs User Y into tenant B on the exact lower-case route', async () => {
    expectLoginForY(await login('/auth/login'));
  });

  it('logs User Y into tenant B with a trailing slash', async () => {
    expectLoginForY(await login('/auth/login/'));
  });

  it('logs User Y into tenant B with upper-case path segments', async () => {
    expectLoginForY(await login('/AUTH/LOGIN'));
  });

  it('logs User Y into tenant B even when the guard cannot reach the database', async () => {
    expectLoginForY(await loginOn(appBrokenGuard, '/auth/login'));
  });

  it('logs no tenant denial on credential routes', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    try {
      warnSpy.mockClear();
      expectLoginForY(await login('/auth/login'));
      expectLoginForY(await login('/auth/login/'));
      expectLoginForY(await login('/AUTH/LOGIN'));
      expect(denialWarnCalls(warnSpy)).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('records a password_reset auth event when a reset token is redeemed', async () => {
    const email = `credential-reset-${crypto.randomUUID()}@example.test`;
    const account = await prisma.user.create({
      data: { email, name: 'Reset User', passwordHash: await bcrypt.hash(password, 10) },
    });
    userIds.push(account.id);
    const { token } = await issuePasswordResetToken(prisma, account.id);

    const res = await request(app).post('/auth/reset').send({ token, password: 'reset-new-password-1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const events = await prisma.authEvent.findMany({ where: { userId: account.id } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'password_reset', success: true, tenantId: null });
  });

  it('logs exactly one tenant denial when a foreign session reads /auth/me', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    try {
      warnSpy.mockClear();
      const res = await request(app)
        .get('/auth/me')
        .set('x-tenant', tenantB.slug)
        .set('Authorization', `Bearer ${userX.session}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'not_member_of_tenant' });
      expect(denialWarnCalls(warnSpy)).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
