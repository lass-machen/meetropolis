import crypto from 'crypto';
import express from 'express';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tenant } from '../../generated/prisma/index.js';
import { createPrismaClient } from '../../db.js';
import { resolveTenantBySlug } from '../../tenancy.js';
import { guestExpiryMiddleware } from '../middleware/guestExpiry.js';
import { createTenantAccessMiddleware } from '../middleware/tenantAccess.js';
import { createSessionAuthMiddleware } from '../utils/sessionAuth.js';
import { registerAuthRoutes } from './auth.js';

if (!process.env.DATABASE_URL) {
  throw new Error('auth.signin.authEvents.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const eventIds: string[] = [];
let app: express.Express;
let tenant: Tenant;
let user: { id: string; email: string };
const password = 'valid-password-123';

async function latestEventFor(userId: string | null, type: string) {
  const row = await prisma.authEvent.findFirst({
    where: { userId, type },
    orderBy: { createdAt: 'desc' },
  });
  if (row) eventIds.push(row.id);
  return row;
}

beforeAll(async () => {
  tenant = await prisma.tenant.create({
    data: { slug: `signin-events-${crypto.randomUUID()}`, name: 'Signin Events' },
  });
  tenantIds.push(tenant.id);

  const created = await prisma.user.create({
    data: {
      email: `signin-events-${crypto.randomUUID()}@example.test`,
      name: 'Signin Events',
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
  userIds.push(created.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: created.id, role: 'member' } });
  user = { id: created.id, email: created.email };

  app = express();
  // Same order as the server entry: cookies are parsed before the session middleware reads them.
  app.use(cookieParser());
  app.use(express.json());
  app.use((req, _res, next) => {
    void resolveTenantBySlug(prisma, req)
      .then((resolved) => {
        req.tenant = resolved ?? undefined;
        req.tenantId = resolved?.id;
        next();
      })
      .catch((error: unknown) => next(error));
  });
  app.use(createSessionAuthMiddleware(prisma));
  app.use(createTenantAccessMiddleware(prisma));
  registerAuthRoutes(app, prisma);
  app.use(guestExpiryMiddleware);
});

afterAll(async () => {
  await prisma.authEvent.deleteMany({ where: { id: { in: eventIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('auth signin/logout event recording (real database)', () => {
  it('stores a failed login event with the user id for a wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('x-tenant', tenant.slug)
      .send({ email: user.email, password: 'wrong-password-123' });

    expect(res.status).toBe(401);
    const row = await latestEventFor(user.id, 'login');
    expect(row).toMatchObject({ type: 'login', success: false, userId: user.id, tenantId: null });
  });

  it('stores a failed login event without a user id for an unknown account', async () => {
    const unknownEmail = `unknown-${crypto.randomUUID()}@example.test`;
    const res = await request(app)
      .post('/auth/login')
      .set('x-tenant', tenant.slug)
      .send({ email: unknownEmail, password: 'valid-password-123' });

    expect(res.status).toBe(401);
    const row = await latestEventFor(null, 'login');
    expect(row).toMatchObject({ type: 'login', success: false, userId: null });
    expect(typeof row?.emailHmac).toBe('string');
    expect(row?.emailHmac).not.toContain('unknown-');
  });

  it('stores nothing for an invalid body', async () => {
    const before = await prisma.authEvent.count();
    const res = await request(app).post('/auth/login').set('x-tenant', tenant.slug).send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(await prisma.authEvent.count()).toBe(before);
  });

  it('stores a successful login event and the login timestamps', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set('x-tenant', tenant.slug)
      .send({ email: user.email, password });

    expect(res.status).toBe(200);
    const row = await latestEventFor(user.id, 'login');
    expect(row).toMatchObject({ type: 'login', success: true, userId: user.id, tenantId: tenant.id });

    const storedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(storedUser?.lastLoginAt).toBeInstanceOf(Date);
    const membership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    });
    expect(membership?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('stores a logout event and still answers 200', async () => {
    const login = await request(app)
      .post('/auth/login')
      .set('x-tenant', tenant.slug)
      .send({ email: user.email, password });
    expect(login.status).toBe(200);
    const cookies: unknown = login.headers['set-cookie'];
    if (!Array.isArray(cookies)) throw new Error('The login did not set any cookie.');

    const logout = await request(app)
      .post('/auth/logout')
      .set('x-tenant', tenant.slug)
      .set('Cookie', cookies as string[]);
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    const row = await latestEventFor(user.id, 'logout');
    expect(row).toMatchObject({ type: 'logout', success: true, userId: user.id, tenantId: tenant.id });
  });
});
