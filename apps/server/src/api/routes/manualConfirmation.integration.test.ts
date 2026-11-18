import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAuthRoutes } from './auth.js';
import { registerMiscRoutes } from './misc.js';
import { registerAdminAccountConfirmationRoutes } from './admin.accountConfirmation.js';
import { errorHandler } from '../errorHandler.js';
import { validateTenantSessionFresh } from '../utils/sessionAuth.js';
import { hashInviteCode } from '../utils/inviteCode.js';

const fixture = createHttpFixture();
const app = fixture.app();
registerAuthRoutes(app, fixture.prisma);
registerMiscRoutes(app, fixture.prisma);
registerAdminAccountConfirmationRoutes(app, fixture.prisma);
app.use(errorHandler);

const originalManual = process.env.MANUAL_ACCOUNT_CONFIRMATION;
const originalBase = process.env.PUBLIC_BASE_URL;

// The cases run "without a mail provider" no matter which mail settings the caller
// exports: no SMTP sender and no Resend key, so no delivering module resolves.
const mailProviderEnvKeys = ['SMTP_HOST', 'SMTP_FROM', 'RESEND_API_KEY', 'RESEND_FROM'] as const;

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
  for (const key of mailProviderEnvKeys) vi.stubEnv(key, undefined);
});

afterEach(() => {
  if (originalManual === undefined) delete process.env.MANUAL_ACCOUNT_CONFIRMATION;
  else process.env.MANUAL_ACCOUNT_CONFIRMATION = originalManual;
});

afterAll(async () => {
  if (originalManual === undefined) delete process.env.MANUAL_ACCOUNT_CONFIRMATION;
  else process.env.MANUAL_ACCOUNT_CONFIRMATION = originalManual;
  if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBase;
  vi.unstubAllEnvs();
  await fixture.close();
});

function setManualConfirmation(enabled: boolean): void {
  if (enabled) process.env.MANUAL_ACCOUNT_CONFIRMATION = 'true';
  else delete process.env.MANUAL_ACCOUNT_CONFIRMATION;
}

function sessionCookie(result: { headers: Record<string, unknown> }): string {
  const cookies = result.headers['set-cookie'];
  const cookie = Array.isArray(cookies)
    ? cookies.find((value: string) => value.startsWith('auth_token='))?.split(';')[0]
    : null;
  if (!cookie) throw new Error('The request did not establish a session cookie.');
  return cookie;
}

async function superAdmin() {
  let internal = await fixture.prisma.tenant.findUnique({ where: { slug: 'internal' } });
  if (!internal) {
    internal = await fixture.prisma.tenant.create({ data: { slug: 'internal', name: 'Internal' } });
    fixture.tenantIds.push(internal.id);
  }
  return fixture.caller(internal, 'owner');
}

async function confirmAsSuperAdmin(targetUserId: string) {
  const admin = await superAdmin();
  return request(app)
    .post(`/admin/users/${targetUserId}/confirm-email`)
    .set('X-Tenant', 'internal')
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
}

async function pendingRegistration(role: 'admin' | 'member' = 'admin') {
  setManualConfirmation(true);
  const own = await fixture.tenant();
  const email = `fixture-account-${crypto.randomUUID()}@example.test`;
  fixture.userEmails.push(email);
  const rawCode = crypto.randomBytes(12).toString('hex');
  const invite = await fixture.prisma.invite.create({
    data: {
      tenantId: own.tenant.id,
      email,
      code: hashInviteCode(rawCode),
      role,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const password = crypto.randomBytes(20).toString('hex');
  const result = await request(app)
    .post('/auth/register')
    .set('X-Tenant', own.tenant.slug)
    .send({ code: rawCode, email, password });
  const user = await fixture.prisma.user.findUniqueOrThrow({ where: { email } });
  fixture.userIds.push(user.id);
  return { ...own, invite, result, user, password, cookie: sessionCookie(result) };
}

async function pendingProof(userId: string) {
  return fixture.prisma.emailVerification.findFirstOrThrow({
    where: { userId, purpose: 'invite_admin', usedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

describe('manual account confirmation without a mail provider', () => {
  it('case 1: registration with an invitation waits for an administrator and grants nothing yet', async () => {
    const value = await pendingRegistration();
    expect(value.result.status).toBe(409);
    expect(value.result.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(value.result.body.delivery).toBe('admin');
    const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.invite.id } })).usedAt).toBeNull();
    const proof = await pendingProof(value.user.id);
    expect(proof.readyAt).toBeNull();
    expect(proof.inviteId).toBe(value.invite.id);
    expect(proof.expiresAt.getTime() - proof.createdAt.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(JSON.stringify(value.result.body)).not.toContain(proof.token);
  });

  it('case 2: a waiting account is denied tenant routes, world access and reports admin pending', async () => {
    const value = await pendingRegistration('member');
    const users = await request(app).get('/users').set('X-Tenant', value.tenant.slug).set('Cookie', value.cookie);
    expect(users.status).toBe(403);
    const full = await fixture.session(value.user.id, value.tenant.id);
    expect((await validateTenantSessionFresh(fixture.prisma, full.token, value.tenant.id)).status).toBe('forbidden');
    const status = await request(app).get('/auth/verify/status').set('Cookie', value.cookie);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', status: 'admin_pending' });
  });

  it('case 3: a super administrator confirmation verifies, grants the invitation role and allows login', async () => {
    const value = await pendingRegistration('admin');
    const result = await confirmAsSuperAdmin(value.user.id);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ userId: value.user.id, verified: true });
    const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } });
    expect(user.emailVerifiedAt).not.toBeNull();
    const membership = await fixture.prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: value.tenant.id, userId: value.user.id } },
    });
    expect(membership.role).toBe('admin');
    expect(membership.inviteVerificationRequired).toBe(false);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.invite.id } })).usedAt).not.toBeNull();
    const proof = await fixture.prisma.emailVerification.findFirstOrThrow({
      where: { userId: value.user.id, purpose: 'invite_admin' },
    });
    expect(proof.usedAt).not.toBeNull();
    const login = await request(app)
      .post('/auth/login')
      .set('X-Tenant', value.tenant.slug)
      .send({ email: value.user.email, password: value.password });
    expect(login.status).toBe(200);
    const me = await request(app)
      .get('/auth/me')
      .set('X-Tenant', value.tenant.slug)
      .set('Cookie', sessionCookie(login));
    expect(me.status).toBe(200);
  });

  it('case 4: an existing unverified account waits on invitation acceptance, then joins unmarked', async () => {
    setManualConfirmation(true);
    const home = await fixture.tenant();
    const caller = await fixture.caller(home.tenant);
    const account = await fixture.prisma.user.update({
      where: { id: caller.id },
      data: { emailVerifiedAt: null },
    });
    const target = await fixture.tenant();
    const rawCode = crypto.randomBytes(12).toString('hex');
    await fixture.prisma.invite.create({
      data: {
        tenantId: target.tenant.id,
        email: account.email,
        code: hashInviteCode(rawCode),
        role: 'admin',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const accepted = await request(app)
      .post('/invites/accept')
      .set('X-Tenant', target.tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ code: rawCode });
    expect(accepted.status).toBe(409);
    expect(accepted.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(accepted.body.delivery).toBe('admin');
    expect(await fixture.prisma.membership.count({ where: { userId: caller.id, tenantId: target.tenant.id } })).toBe(0);
    expect((await confirmAsSuperAdmin(caller.id)).status).toBe(200);
    const membership = await fixture.prisma.membership.findUniqueOrThrow({
      where: { tenantId_userId: { tenantId: target.tenant.id, userId: caller.id } },
    });
    expect(membership.role).toBe('admin');
    expect(membership.inviteVerificationRequired).toBe(false);
  });

  it('case 5: tenant roles, guests, verification-only and anonymous callers cannot confirm', async () => {
    const value = await pendingRegistration('member');
    const actors = [
      await fixture.caller(value.tenant, 'admin'),
      await fixture.caller(value.tenant, 'member'),
      await fixture.caller(value.tenant, 'guest'),
    ];
    for (const actor of actors) {
      const result = await request(app)
        .post(`/admin/users/${value.user.id}/confirm-email`)
        .set('X-Tenant', value.tenant.slug)
        .set('Authorization', `Bearer ${actor.session}`)
        .send({});
      expect(result.status).toBe(403);
      expect(result.body).toEqual({ error: 'forbidden' });
    }
    const restricted = await request(app)
      .post(`/admin/users/${value.user.id}/confirm-email`)
      .set('X-Tenant', value.tenant.slug)
      .set('Cookie', value.cookie)
      .send({});
    expect([401, 403]).toContain(restricted.status);
    const anonymous = await request(app)
      .post(`/admin/users/${value.user.id}/confirm-email`)
      .set('X-Tenant', value.tenant.slug)
      .send({});
    expect([401, 403]).toContain(anonymous.status);
    const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
    expect((await pendingProof(value.user.id)).usedAt).toBeNull();
  });

  it('case 6: already verified and missing intent answer 409, unknown and invalid ids 404', async () => {
    setManualConfirmation(true);
    const { tenant } = await fixture.tenant();
    const verified = await fixture.caller(tenant);
    const already = await confirmAsSuperAdmin(verified.id);
    expect(already.status).toBe(409);
    expect(already.body.code).toBe('ALREADY_VERIFIED');
    const unverified = await fixture.caller(tenant);
    await fixture.prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: null } });
    const missing = await confirmAsSuperAdmin(unverified.id);
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe('NO_PENDING_CONFIRMATION');
    const unknown = await confirmAsSuperAdmin(crypto.randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'user_not_found' });
    const invalid = await confirmAsSuperAdmin('not-a-user-id');
    expect(invalid.status).toBe(404);
    expect(invalid.body).toEqual({ error: 'user_not_found' });
    expect(
      (await fixture.prisma.user.findUniqueOrThrow({ where: { id: verified.id } })).emailVerifiedAt,
    ).not.toBeNull();
    expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: unverified.id } })).emailVerifiedAt).toBeNull();
  });

  it('case 7: the pending list is super-admin only and exposes no token or hash', async () => {
    const value = await pendingRegistration('member');
    const proof = await pendingProof(value.user.id);
    const admin = await superAdmin();
    const list = await request(app)
      .get('/admin/pending-confirmations')
      .set('X-Tenant', 'internal')
      .set('Authorization', `Bearer ${admin.session}`);
    expect(list.status).toBe(200);
    const entry = (list.body.pending as Array<Record<string, unknown>>).find((item) => item.userId === value.user.id);
    expect(entry).toMatchObject({
      userId: value.user.id,
      email: value.user.email,
      tenantId: value.tenant.id,
      tenantName: value.tenant.name,
      role: 'member',
    });
    expect(entry?.requestedAt).toBeTruthy();
    expect(entry?.expiresAt).toBeTruthy();
    expect(entry).not.toHaveProperty('token');
    expect(JSON.stringify(list.body)).not.toContain(proof.token);
    const tenantAdmin = await fixture.caller(value.tenant, 'admin');
    const denied = await request(app)
      .get('/admin/pending-confirmations')
      .set('X-Tenant', value.tenant.slug)
      .set('Authorization', `Bearer ${tenantAdmin.session}`);
    expect(denied.status).toBe(403);
    expect(denied.body).toEqual({ error: 'forbidden' });
  });

  it('case 8: five concurrent confirmations grant the role exactly once', async () => {
    const value = await pendingRegistration('admin');
    const admin = await superAdmin();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/admin/users/${value.user.id}/confirm-email`)
          .set('X-Tenant', 'internal')
          .set('Authorization', `Bearer ${admin.session}`)
          .send({}),
      ),
    );
    expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
    expect(responses.filter((res) => res.status === 409)).toHaveLength(4);
    const members = await fixture.prisma.membership.findMany({
      where: { userId: value.user.id, tenantId: value.tenant.id },
    });
    expect(members.map((member) => member.role)).toEqual(['admin']);
    expect(
      await fixture.prisma.emailVerification.count({
        where: { userId: value.user.id, purpose: 'invite_admin', usedAt: { not: null } },
      }),
    ).toBe(1);
  }, 60_000);

  it('case 9: deleting the account removes the waiting confirmation intent', async () => {
    const value = await pendingRegistration('member');
    const full = await fixture.session(value.user.id, value.tenant.id);
    const deleted = await request(app)
      .delete('/users/me')
      .set('X-Tenant', value.tenant.slug)
      .set('Authorization', `Bearer ${full.token}`)
      .send({});
    expect(deleted.status).toBe(200);
    expect(await fixture.prisma.user.count({ where: { id: value.user.id } })).toBe(0);
    expect(await fixture.prisma.emailVerification.count({ where: { userId: value.user.id } })).toBe(0);
  });

  it('case 10: with the switch off, registration, acceptance and verification request stay 503', async () => {
    setManualConfirmation(false);
    const { tenant } = await fixture.tenant();
    const email = `fixture-account-${crypto.randomUUID()}@example.test`;
    fixture.userEmails.push(email);
    const rawCode = crypto.randomBytes(12).toString('hex');
    await fixture.prisma.invite.create({
      data: {
        tenantId: tenant.id,
        email,
        code: hashInviteCode(rawCode),
        role: 'member',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const registered = await request(app)
      .post('/auth/register')
      .set('X-Tenant', tenant.slug)
      .send({ code: rawCode, email, password: crypto.randomBytes(20).toString('hex') });
    expect(registered.status).toBe(503);
    expect(registered.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect(await fixture.prisma.user.findUnique({ where: { email } })).toBeNull();
    const caller = await fixture.caller(tenant);
    const account = await fixture.prisma.user.update({
      where: { id: caller.id },
      data: { emailVerifiedAt: null },
    });
    const rawAcceptCode = crypto.randomBytes(12).toString('hex');
    await fixture.prisma.invite.create({
      data: {
        tenantId: tenant.id,
        email: account.email,
        code: hashInviteCode(rawAcceptCode),
        role: 'member',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const accepted = await request(app)
      .post('/invites/accept')
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ code: rawAcceptCode });
    expect(accepted.status).toBe(503);
    expect(accepted.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    const verifyRequest = await request(app)
      .post('/auth/verify/request')
      .set('Authorization', `Bearer ${caller.session}`)
      .send({});
    expect(verifyRequest.status).toBe(503);
    expect(verifyRequest.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
  });

  it('case 12: with the switch off, email change stays 503 and forgot-password stays silent', async () => {
    setManualConfirmation(false);
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant, 'member', crypto.randomBytes(20).toString('hex'));
    const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    const changed = await request(app)
      .patch('/me')
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ email: `fixture-account-${crypto.randomUUID()}@example.test` });
    expect(changed.status).toBe(503);
    expect(changed.body.code).toBe('EMAIL_DELIVERY_UNAVAILABLE');
    expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })).email).toBe(before.email);
    const forgot = await request(app).post('/auth/forgot').set('X-Tenant', tenant.slug).send({ email: before.email });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual({ ok: true });
    expect(await fixture.prisma.passwordReset.count({ where: { userId: caller.id } })).toBe(0);
  });

  it('case 13: a waiting account whose invitation expired is not listed and cannot be confirmed', async () => {
    const value = await pendingRegistration('member');
    const proof = await pendingProof(value.user.id);
    await fixture.prisma.invite.update({
      where: { id: value.invite.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    const admin = await superAdmin();
    const list = await request(app)
      .get('/admin/pending-confirmations')
      .set('X-Tenant', 'internal')
      .set('Authorization', `Bearer ${admin.session}`);
    expect(list.status).toBe(200);
    expect((list.body.pending as Array<Record<string, unknown>>).some((item) => item.userId === value.user.id)).toBe(
      false,
    );
    const confirmed = await confirmAsSuperAdmin(value.user.id);
    expect(confirmed.status).toBe(409);
    expect(confirmed.body).toEqual({ code: 'NO_PENDING_CONFIRMATION' });
    const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.invite.id } })).usedAt).toBeNull();
    expect((await fixture.prisma.emailVerification.findUniqueOrThrow({ where: { id: proof.id } })).usedAt).toBeNull();
  });
});
