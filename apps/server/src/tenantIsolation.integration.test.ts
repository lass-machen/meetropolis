import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from './generated/prisma/index.js';
import { createPrismaClient } from './db.js';
import { registerApi } from './api.js';
import { tenantMiddleware } from './tenancy.js';
import { getJwtSecret } from './api/utils/authHelpers.js';
import { inviteExpiry } from './api/utils/inviteLifecycle.js';
import { hashSessionToken } from './api/utils/sessionAuth.js';

/**
 * Tenant isolation through the real HTTP stack (tenantMiddleware, session
 * middleware, registerApi) against a REAL PostgreSQL database.
 *
 * A signed-in caller without a membership in the request's tenant (for example
 * a member that was removed while a session was still open) must not read or
 * change that tenant's data. The OSS build runs single-tenant, so every request
 * resolves to DEFAULT_TENANT_SLUG; the enterprise build resolves the tenant
 * from X-Tenant or the session claim, and the same rule applies.
 */

if (!process.env.DATABASE_URL) {
  throw new Error('tenantIsolation.integration.test.ts needs DATABASE_URL pointing at a migrated test database');
}

const TENANT_SLUG = `qacc-iso-${crypto.randomUUID()}`;
process.env.DEFAULT_TENANT_SLUG = TENANT_SLUG;

const prisma = createPrismaClient();
const userIds: string[] = [];
const additionalTenantIds: string[] = [];
let app: express.Express;
let tenantId: string;
let mapId: string;
let inviteCode: string;
let inviteId: string;
let memberId: string;
let memberToken: string;
let adminToken: string;
let outsiderToken: string;

async function createUser(role: Role | null): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({ data: { email: `qacc-${crypto.randomUUID()}@example.test` } });
  userIds.push(user.id);
  if (role) await prisma.membership.create({ data: { userId: user.id, tenantId, role } });
  const token = jwt.sign({ sub: user.id, tid: tenantId, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { id: user.id, token };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  tenantId = (await prisma.tenant.create({ data: { slug: TENANT_SLUG, name: TENANT_SLUG } })).id;
  const member = await createUser('member');
  memberId = member.id;
  memberToken = member.token;
  adminToken = (await createUser('admin')).token;
  // Signed in, valid session, but no membership: e.g. removed from the tenant.
  outsiderToken = (await createUser(null)).token;
  mapId = (await prisma.map.create({ data: { tenantId, name: 'Office', meta: {} } })).id;
  inviteCode = crypto.randomBytes(12).toString('hex');
  inviteId = (
    await prisma.invite.create({ data: { code: inviteCode, email: 'invitee@example.test', tenantId, role: 'admin' } })
  ).id;

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(tenantMiddleware as unknown as express.RequestHandler);
  await registerApi(app);
});

afterAll(async () => {
  const cleanupTenantIds = [tenantId, ...additionalTenantIds];
  await prisma.presence.deleteMany({ where: { tenantId } });
  await prisma.emailVerification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.invite.deleteMany({ where: { tenantId: { in: cleanupTenantIds } } });
  // A presence write auto-creates the default room, which references the map.
  await prisma.room.deleteMany({ where: { tenantId } });
  await prisma.map.deleteMany({ where: { tenantId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.tenant.deleteMany({ where: { id: { in: cleanupTenantIds } } });
  await prisma.$disconnect();
});

describe('tenant data requires a membership (real stack)', () => {
  it('serves the member roster to a member', async () => {
    const res = await request(app).get('/presence/recent').set(as(memberToken));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(memberId);
  });

  it('refuses the member roster to a signed-in non-member', async () => {
    const res = await request(app).get('/presence/recent').set(as(outsiderToken));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tenant_required');
  });

  it('refuses a member profile to a signed-in non-member', async () => {
    expect((await request(app).get(`/users/${memberId}`).set(as(memberToken))).status).toBe(200);
    const res = await request(app).get(`/users/${memberId}`).set(as(outsiderToken));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tenant_required');
  });

  it('refuses listing and revoking invites to a signed-in non-member', async () => {
    expect((await request(app).get('/invites').set(as(adminToken))).status).toBe(200);
    const list = await request(app).get('/invites').set(as(outsiderToken));
    expect(list.status).toBe(400);
    const revoke = await request(app).delete(`/invites/${inviteId}`).set(as(outsiderToken));
    expect(revoke.status).toBe(400);
    expect(await prisma.invite.count({ where: { code: inviteCode } })).toBe(1);
  });

  it('refuses map export and import to a signed-in non-member', async () => {
    const exported = await request(app).get(`/maps/${mapId}/export-tmj`).set(as(outsiderToken));
    expect(exported.status).toBe(400);
    expect(exported.body.error).toBe('tenant_required');
    const imported = await request(app).post(`/maps/${mapId}/import-tmj`).set(as(outsiderToken));
    expect(imported.body.error).toBe('tenant_required');
  });

  it('refuses writing presence into the tenant to a signed-in non-member', async () => {
    const res = await request(app)
      .post('/auth/position')
      .set(as(outsiderToken))
      .send({ x: 1, y: 1, direction: 'down' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tenant_required');
    expect(await prisma.presence.count({ where: { tenantId } })).toBe(0);
  });

  it('refuses the NPC list to a signed-in non-member', async () => {
    expect((await request(app).get('/npcs').set(as(memberToken))).status).toBe(200);
    const res = await request(app).get('/npcs').set(as(outsiderToken));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('tenant_required');
  });

  it('keeps answering /auth/me for a signed-in non-member with not_member_of_tenant', async () => {
    const res = await request(app).get('/auth/me').set(as(outsiderToken));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_member_of_tenant');
  });
});

describe('flows that must keep working without a membership (real stack)', () => {
  it('serves /public/config to a signed-in non-member', async () => {
    const res = await request(app).get('/public/config').set(as(outsiderToken));
    expect(res.status).toBe(200);
  });

  it('lets a member log in while the browser still carries a non-member session', async () => {
    const email = `login-${crypto.randomUUID()}@example.test`;
    const password = 'Qacc-Login-Password-1';
    const user = await prisma.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 4) } });
    userIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, tenantId, role: 'member' } });
    const res = await request(app).post('/auth/login').set(as(outsiderToken)).send({ email, password });
    expect(res.status).toBe(200);
  });

  it('lets a signed-in non-member start an invite registration without a membership before email proof', async () => {
    const code = crypto.randomBytes(12).toString('hex');
    const email = `invitee-${crypto.randomUUID()}@example.test`;
    await prisma.invite.create({ data: { code, email, tenantId, role: 'member', expiresAt: inviteExpiry() } });
    const res = await request(app)
      .post('/auth/register')
      .set(as(outsiderToken))
      .send({ code, email, password: 'Qacc-Test-Password-1' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(res.body.delivery).toBe('sent');
    expect(res.body).not.toHaveProperty('token');
    const created = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    expect(created).not.toBeNull();
    if (created) userIds.push(created.id);
    expect(await prisma.membership.count({ where: { tenantId, user: { email } } })).toBe(0);
  });

  it('lets a member accept a bound invite when X-Tenant selects another tenant', async () => {
    const tenantB = await prisma.tenant.create({
      data: { slug: `qacc-invite-target-${crypto.randomUUID()}`, name: 'Invite Target' },
    });
    additionalTenantIds.push(tenantB.id);
    const member = await prisma.user.findUniqueOrThrow({ where: { id: memberId }, select: { email: true } });
    const code = crypto.randomBytes(12).toString('hex');
    const invite = await prisma.invite.create({
      data: { code, email: member.email, tenantId: tenantB.id, role: 'member' },
    });
    await prisma.$executeRaw`
      UPDATE "Invite" SET "expiresAt" = now() + interval '7 days' WHERE "id" = ${invite.id}
    `;
    await prisma.user.update({ where: { id: memberId }, data: { emailVerifiedAt: new Date() } });

    const response = await request(app)
      .post('/invites/accept')
      .set(as(memberToken))
      .set('X-Tenant', tenantB.slug)
      .send({ code });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: memberId, email: member.email, alreadyMember: false });
    expect(
      await prisma.membership.findUnique({
        where: { tenantId_userId: { tenantId: tenantB.id, userId: memberId } },
      }),
    ).toMatchObject({ role: 'member' });
  });
});
