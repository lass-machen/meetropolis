import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { registerMiscRoutes } from './misc.js';
import { setAuthResolution } from '../utils/authState.js';
import { createPrismaClient } from '../../db.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

/**
 * Personal data export against a REAL PostgreSQL database: the export
 * contains the user's own auth events (newest first, without foreign rows)
 * and the user's last login time.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('misc.export.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

function makeApp(db: PrismaClient) {
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
  registerMiscRoutes(app, db);
  return app;
}

afterAll(async () => {
  await prisma.authEvent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prisma.$disconnect();
});

describe('GET /users/me/export — auth events (real database)', () => {
  it('exports the own auth events newest first and no foreign rows', async () => {
    const slug = `export-${crypto.randomUUID()}`;
    const tenant = await prisma.tenant.create({ data: { slug, name: slug } });
    tenantIds.push(tenant.id);
    const lastLoginAt = new Date('2026-11-01T12:00:00.000Z');
    const user = await prisma.user.create({
      data: { email: `export-${crypto.randomUUID()}@example.test`, lastLoginAt },
    });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'member' } });
    const foreign = await prisma.user.create({ data: { email: `export-${crypto.randomUUID()}@example.test` } });
    userIds.push(foreign.id);

    const older = new Date('2026-11-10T10:00:00.000Z');
    const newer = new Date('2026-11-11T10:00:00.000Z');
    await prisma.authEvent.create({
      data: { type: 'login', success: true, userId: user.id, tenantId: tenant.id, createdAt: older },
    });
    await prisma.authEvent.create({
      data: {
        type: 'logout',
        success: true,
        userId: user.id,
        tenantId: tenant.id,
        ipAddress: '10.0.0.1',
        userAgent: 'export-test',
        createdAt: newer,
      },
    });
    await prisma.authEvent.create({ data: { type: 'login', success: true, userId: foreign.id, tenantId: tenant.id } });

    const res = await request(makeApp(prisma))
      .get('/users/me/export')
      .set('x-user', user.id)
      .set('x-tenant', tenant.id)
      .expect(200);

    expect(res.body.user.lastLoginAt).toBe(lastLoginAt.toISOString());
    expect(res.body.authEvents).toHaveLength(2);
    expect(res.body.authEvents[0]).toEqual({
      type: 'logout',
      success: true,
      tenantId: tenant.id,
      ipAddress: '10.0.0.1',
      userAgent: 'export-test',
      createdAt: newer.toISOString(),
    });
    expect(res.body.authEvents[1]).toMatchObject({ type: 'login', createdAt: older.toISOString() });
    expect(JSON.stringify(res.body.authEvents)).not.toContain(foreign.id);
  });
});
