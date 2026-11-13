import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';
import { registerUserRoutes } from './users.js';
import { registerPresenceRoutes } from './presence.js';
import { registerTmjImportRoute } from './tmj.import.js';
import { getJwtSecret, getTenantFromReq, requireAuth } from '../utils/authHelpers.js';
import { hashSessionToken, validateSessionToken } from '../utils/sessionAuth.js';

const setup = createEmailProofFixture();
const { fixture, app } = setup;
registerUserRoutes(app, fixture.prisma, requireAuth, getTenantFromReq);
registerPresenceRoutes(app, fixture.prisma, requireAuth, getTenantFromReq);
registerTmjImportRoute(app, fixture.prisma);
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

async function restrictedSession(expired = false) {
  const own = await fixture.tenant();
  const password = crypto.randomBytes(20).toString('hex');
  const user = await fixture.caller(own.tenant, 'member', password);
  const account = await fixture.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  const now = Math.floor(Date.now() / 1000);
  const issuedAt = expired ? now - 901 : now;
  const token = jwt.sign(
    {
      sub: user.id,
      tid: own.tenant.id,
      jti: crypto.randomUUID(),
      scope: 'email_verification',
      iat: issuedAt,
      exp: issuedAt + 900,
    },
    getJwtSecret(),
  );
  // Keep the row live so rejection proves JWT expiry rather than row expiry.
  await fixture.prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 900_000) },
  });
  return { ...own, user: account, token, cookie: `auth_token=${token}`, password };
}

it('issues a signed verification-only registration session with a fifteen-minute lifetime', async () => {
  const { tenant } = await fixture.tenant();
  const email = setup.email();
  fixture.userEmails.push(email);
  const invite = await fixture.prisma.invite.create({
    data: {
      tenantId: tenant.id,
      email,
      code: crypto.randomBytes(12).toString('hex'),
      role: 'member',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const result = await request(app)
    .post('/auth/register')
    .set('X-Tenant', tenant.slug)
    .send({ code: invite.code, email, password: crypto.randomBytes(20).toString('hex') });
  const cookies = result.headers['set-cookie'];
  const cookie = Array.isArray(cookies)
    ? cookies.find((value: string) => value.startsWith('auth_token='))?.split(';')[0]
    : null;
  if (!cookie) throw new Error('Registration did not establish a session.');
  const token = cookie.slice('auth_token='.length);
  const payload = jwt.verify(token, getJwtSecret());
  expect(typeof payload).toBe('object');
  if (typeof payload === 'string') throw new Error('Expected a signed session payload.');
  expect(payload.scope).toBe('email_verification');
  expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(900);
  const row = await fixture.prisma.session.findUniqueOrThrow({ where: { tokenHash: hashSessionToken(token) } });
  expect(Math.abs(row.expiresAt.getTime() - (payload.exp ?? 0) * 1000)).toBeLessThan(1100);
  expect(result.status).toBe(409);
  const accepted = await request(app).post('/invites/accept').set('Cookie', cookie).send({ code: invite.code });
  expect(accepted.status).toBe(409);
  expect(accepted.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
  expect(await fixture.prisma.membership.count({ where: { userId: row.userId } })).toBe(0);
  expect((await request(app).post('/auth/logout').set('Cookie', cookie).send({})).status).toBe(200);
  expect(await fixture.prisma.session.findUnique({ where: { id: row.id } })).toBeNull();
});

it('denies private resources and world authentication before and after proof until a fresh login', async () => {
  const value = await restrictedSession();
  for (const [method, path] of [
    ['get', `/users/${value.user.id}`],
    ['patch', '/me'],
    ['get', '/users'],
    ['delete', '/users/me'],
    ['get', '/auth/sessions'],
    ['post', '/auth/change'],
    ['post', '/auth/position'],
    ['get', '/presence/recent'],
    ['post', `/maps/${value.map.id}/import-tmj`],
  ] as const) {
    const result = await request(app)
      [method](path)
      .set('X-Tenant', value.tenant.slug)
      .set('Cookie', value.cookie)
      .set('Content-Type', 'application/json')
      .send(method === 'get' ? undefined : {});
    expect([401, 403].includes(result.status)).toBe(true);
  }
  expect(await validateSessionToken(fixture.prisma, value.token)).toBeNull();
  const resend = await request(app).post('/auth/verify/request').set('Cookie', value.cookie).send({});
  expect(resend.status).toBe(200);
  const proof = await setup.tokenFromMail(value.user.email);
  expect((await request(app).post('/auth/verify').send({ token: proof })).status).toBe(200);
  expect((await request(app).get(`/users/${value.user.id}`).set('Cookie', value.cookie)).status).toBe(403);
  expect(await validateSessionToken(fixture.prisma, value.token)).toBeNull();
  expect((await request(app).get('/auth/verify/status').set('Cookie', value.cookie)).body).toEqual({
    code: 'ACCOUNT_LOGIN_REQUIRED',
    status: 'login_required',
  });
  const login = await request(app)
    .post('/auth/login')
    .set('X-Tenant', value.tenant.slug)
    .send({ email: value.user.email, password: value.password });
  expect(login.status).toBe(200);
  const cookies = login.headers['set-cookie'];
  const fullCookie = Array.isArray(cookies)
    ? cookies.find((value: string) => value.startsWith('auth_token='))?.split(';')[0]
    : null;
  if (!fullCookie) throw new Error('The confirmed login did not establish a session.');
  expect(
    (await request(app).get(`/users/${value.user.id}`).set('X-Tenant', value.tenant.slug).set('Cookie', fullCookie))
      .status,
  ).toBe(200);
});

it('returns only status and code to a verification-only pending session', async () => {
  const value = await restrictedSession();
  const result = await request(app).get('/auth/verify/status').set('Cookie', value.cookie);
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', status: 'unavailable' });
});

it('rejects an expired fifteen-minute verification session even while its database row remains live', async () => {
  const value = await restrictedSession(true);
  const result = await request(app).get('/auth/verify/status').set('Cookie', value.cookie);
  expect(result.status).toBe(401);
  expect(await validateSessionToken(fixture.prisma, value.token)).toBeNull();
});
