import crypto from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../db.js';
import { setAuthResolution } from '../utils/authState.js';
import { hashInviteCode } from '../utils/inviteCode.js';
import { handleAuthInvite } from './auth.signin.js';
import { registerInviteRoutes } from './invites.js';

if (!process.env.DATABASE_URL) throw new Error('invites.codeHash.integration.test.ts needs DATABASE_URL');

const prisma = createPrismaClient();
const tenantIds: string[] = [];
const userIds: string[] = [];

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
  registerInviteRoutes(app, prisma);
  return app;
}

async function createFixture(): Promise<Fixture> {
  const suffix = crypto.randomUUID();
  const tenant = await prisma.tenant.create({ data: { slug: `codehash-${suffix}`, name: `CodeHash ${suffix}` } });
  tenantIds.push(tenant.id);
  const owner = await prisma.user.create({ data: { email: `owner-${suffix}@example.test` } });
  userIds.push(owner.id);
  await prisma.membership.create({ data: { tenantId: tenant.id, userId: owner.id, role: 'owner' } });
  return { app: makeApp(), tenantId: tenant.id, ownerId: owner.id };
}

async function createVerifiedUser(email: string): Promise<string> {
  const user = await prisma.user.create({ data: { email, emailVerifiedAt: new Date() } });
  userIds.push(user.id);
  return user.id;
}

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
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
  if (currentUserIds.length) {
    await prisma.authEvent.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.emailVerification.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: currentUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: currentUserIds } } });
  }
  if (currentTenantIds.length) await prisma.tenant.deleteMany({ where: { id: { in: currentTenantIds } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('invite code hashing', () => {
  it('stores the hash, redeems the raw code, and rejects the stored hash as a code', async () => {
    const fixture = await createFixture();
    const email = `invitee-${crypto.randomUUID()}@example.test`;

    const created = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId)
      .send({ email, role: 'member' });
    expect(created.status).toBe(200);
    const rawCode = created.body.code as string;
    expect(rawCode).toMatch(/^[0-9a-f]{24}$/);
    expect(created.body.inviteUrl).toContain(`?invite=${rawCode}`);

    const row = await prisma.invite.findFirstOrThrow({ where: { tenantId: fixture.tenantId, email } });
    expect(row.code).toBe(hashInviteCode(rawCode));
    expect(row.code).not.toBe(rawCode);

    const previewRaw = await request(fixture.app).post('/public/invites/preview').send({ code: rawCode });
    expect(previewRaw.status).toBe(200);
    const previewHash = await request(fixture.app).post('/public/invites/preview').send({ code: row.code });
    expect(previewHash.status).toBe(404);

    const inviteeId = await createVerifiedUser(email);
    const acceptHash = await request(fixture.app)
      .post('/invites/accept')
      .set('x-user', inviteeId)
      .send({ code: row.code });
    expect(acceptHash.status).toBe(404);
    const acceptRaw = await request(fixture.app)
      .post('/invites/accept')
      .set('x-user', inviteeId)
      .send({ code: rawCode });
    expect(acceptRaw.status).toBe(200);
  });

  it('resend rotates the code: the old link stops working and the new one works', async () => {
    const fixture = await createFixture();
    const email = `invitee-${crypto.randomUUID()}@example.test`;

    const created = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId)
      .send({ email, role: 'member' });
    expect(created.status).toBe(200);
    const oldRaw = created.body.code as string;
    const row = await prisma.invite.findFirstOrThrow({ where: { tenantId: fixture.tenantId, email } });

    const resent = await request(fixture.app)
      .post(`/invites/${row.id}/resend`)
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId);
    expect(resent.status).toBe(200);
    const newRaw = resent.body.code as string;
    expect(newRaw).not.toBe(oldRaw);
    expect(resent.body.inviteUrl).toContain(`?invite=${newRaw}`);

    const stored = await prisma.invite.findUniqueOrThrow({ where: { id: row.id } });
    expect(stored.code).toBe(hashInviteCode(newRaw));

    const previewOld = await request(fixture.app).post('/public/invites/preview').send({ code: oldRaw });
    expect(previewOld.status).toBe(404);
    const previewNew = await request(fixture.app).post('/public/invites/preview').send({ code: newRaw });
    expect(previewNew.status).toBe(200);
  });

  it('lists invites without a url field', async () => {
    const fixture = await createFixture();
    const email = `invitee-${crypto.randomUUID()}@example.test`;
    const created = await request(fixture.app)
      .post('/auth/invite')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId)
      .send({ email, role: 'member' });
    expect(created.status).toBe(200);

    const list = await request(fixture.app)
      .get('/invites')
      .set('x-user', fixture.ownerId)
      .set('x-tenant', fixture.tenantId);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).not.toHaveProperty('url');
    expect(JSON.stringify(list.body)).not.toContain(created.body.code as string);
  });
});
