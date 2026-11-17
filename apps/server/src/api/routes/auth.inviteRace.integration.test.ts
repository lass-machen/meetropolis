import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { setAuthResolution } from '../utils/authState.js';
import { handleAuthInvite } from './auth.signin.js';

vi.mock('../../logger.js', () => ({
  logger: {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  },
}));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () => Promise.resolve({ isMultiTenantEnabled: () => true }),
}));

if (!process.env.DATABASE_URL) throw new Error('auth.inviteRace.integration.test.ts needs DATABASE_URL');

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];
const publicBaseKeys = ['PUBLIC_BASE_URL', 'PUBLIC_BASE_URL_ALLOW_LOOPBACK'] as const;
type PublicBaseKey = (typeof publicBaseKeys)[number];
let originalPublicBase: Record<PublicBaseKey, string | undefined>;

interface Fixture {
  app: express.Application;
  tenantId: string;
  ownerId: string;
}

function makeApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.headers['x-user'];
    setAuthResolution(req, {
      auth: typeof userId === 'string' ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const tenantId = req.headers['x-tenant'];
    if (typeof tenantId === 'string') req.tenant = { id: tenantId, slug: tenantId, name: tenantId } as never;
    next();
  });
  app.post('/auth/invite', (req, res) => handleAuthInvite(prisma, req, res));
  return app;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { slug: `invite-race-${suffix}`, name: `Race ${suffix}` } });
  tenantIds.push(tenant.id);
  const owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.test` } });
  userIds.push(owner.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'owner' } });
  return { app: makeApp(), tenantId: tenant.id, ownerId: owner.id };
}

function inviteRequest(fixture: Fixture, email: string) {
  return request(fixture.app)
    .post('/auth/invite')
    .set('x-user', fixture.ownerId)
    .set('x-tenant', fixture.tenantId)
    .send({ email, role: 'member' });
}

beforeAll(() => {
  originalPublicBase = Object.fromEntries(publicBaseKeys.map((key) => [key, process.env[key]])) as Record<
    PublicBaseKey,
    string | undefined
  >;
  process.env.PUBLIC_BASE_URL = 'http://localhost:42000';
  process.env.PUBLIC_BASE_URL_ALLOW_LOOPBACK = 'true';
});

afterEach(async () => {
  const currentTenantIds = tenantIds.splice(0);
  const currentUserIds = userIds.splice(0);
  if (currentTenantIds.length) await prisma.invite.deleteMany({ where: { tenantId: { in: currentTenantIds } } });
  if (currentTenantIds.length || currentUserIds.length) {
    await prisma.membership.deleteMany({
      where: {
        OR: [
          ...(currentTenantIds.length ? [{ tenantId: { in: currentTenantIds } }] : []),
          ...(currentUserIds.length ? [{ userId: { in: currentUserIds } }] : []),
        ],
      },
    });
  }
  if (currentUserIds.length) await prisma.user.deleteMany({ where: { id: { in: currentUserIds } } });
  if (currentTenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: currentTenantIds } } });
});

afterAll(async () => {
  await prisma.$disconnect();
  publicBaseKeys.forEach((key) =>
    originalPublicBase[key] === undefined ? delete process.env[key] : (process.env[key] = originalPublicBase[key]),
  );
});

describe('open invite creation races', () => {
  it('creates exactly one open invite for two concurrent requests for the same address', async () => {
    const fixture = await createFixture();
    const email = `race-${crypto.randomUUID()}@example.test`;

    const [first, second] = await Promise.all([inviteRequest(fixture, email), inviteRequest(fixture, email)]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await prisma.invite.count({ where: { tenantId: fixture.tenantId, email, usedAt: null } })).toBe(1);
  });

  it('rejects a second open invite for the same tenant and email with P2002', async () => {
    const fixture = await createFixture();
    const email = `direct-${crypto.randomUUID()}@example.test`;
    await prisma.invite.create({
      data: {
        code: crypto.randomUUID().replaceAll('-', ''),
        email,
        createdBy: fixture.ownerId,
        tenantId: fixture.tenantId,
      },
    });

    await expect(
      prisma.invite.create({
        data: {
          code: crypto.randomUUID().replaceAll('-', ''),
          email,
          createdBy: fixture.ownerId,
          tenantId: fixture.tenantId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
