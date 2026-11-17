import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';
import { issuePasswordResetToken } from '../utils/passwordResetTokens.js';

// Exercise the real HTTP, database and Mailpit integrations.
const setup = createEmailProofFixture();
const { fixture, app } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());
const password = () => crypto.randomBytes(20).toString('hex');
async function account() {
  const { tenant } = await fixture.tenant();
  const secret = password();
  const caller = await fixture.caller(tenant, 'member', secret);
  const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  return { tenant, caller, user, password: secret };
}
function cookieHeader(raw: string) {
  return `auth_token=${raw}`;
}
function cookieFrom(headers: Record<string, unknown>): string | null {
  const values = headers['set-cookie'];
  const cookie = Array.isArray(values)
    ? values.find((v: unknown) => typeof v === 'string' && v.startsWith('auth_token='))
    : null;
  return typeof cookie === 'string' ? cookie.split(';')[0] : null;
}

it('revokes the cookie through its real session row', async () => {
  const { tenant, caller } = await account();
  expect(
    (await request(app).get('/auth/me').set('X-Tenant', tenant.slug).set('Cookie', cookieHeader(caller.session)))
      .status,
  ).toBe(200);
  expect(
    (await request(app).delete(`/auth/sessions/${caller.sessionId}`).set('Cookie', cookieHeader(caller.session)))
      .status,
  ).toBe(200);
  expect(
    (await request(app).get('/auth/me').set('X-Tenant', tenant.slug).set('Cookie', cookieHeader(caller.session)))
      .status,
  ).toBe(401);
  expect(await fixture.prisma.session.count({ where: { id: caller.sessionId } })).toBe(0);
});

it('removes the stored session on logout', async () => {
  const { tenant, caller } = await account();
  expect((await request(app).post('/auth/logout').set('Cookie', cookieHeader(caller.session))).status).toBe(200);
  expect(
    (await request(app).get('/auth/me').set('X-Tenant', tenant.slug).set('Cookie', cookieHeader(caller.session)))
      .status,
  ).toBe(401);
});

it('revokes other sessions and retains the caller session', async () => {
  const { tenant, caller } = await account();
  const other = await fixture.session(caller.id, tenant.id);
  const result = await request(app).delete('/auth/sessions').set('Cookie', cookieHeader(caller.session));
  expect(result.status).toBe(200);
  expect(result.body.revokedCount).toBe(1);
  expect(
    (await request(app).get('/auth/me').set('X-Tenant', tenant.slug).set('Cookie', cookieHeader(caller.session)))
      .status,
  ).toBe(200);
  expect(
    (await request(app).get('/auth/me').set('X-Tenant', tenant.slug).set('Cookie', cookieHeader(other.token))).status,
  ).toBe(401);
});

it('returns 404 for another user session without changing the database', async () => {
  const own = await account();
  const foreign = await account();
  const result = await request(app)
    .delete(`/auth/sessions/${foreign.caller.sessionId}`)
    .set('Cookie', cookieHeader(own.caller.session));
  expect(result.status).toBe(404);
  expect(await fixture.prisma.session.count({ where: { id: foreign.caller.sessionId } })).toBe(1);
});

it('creates one revocable verification session and no membership before email proof', async () => {
  const value = await setup.registration();
  expect(await fixture.prisma.session.count({ where: { userId: value.user.id } })).toBe(1);
  expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
  expect(value.user.emailVerifiedAt).toBeNull();
  expect((await request(app).post('/auth/verify').send({ token: value.token })).status).toBe(200);
  expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(1);
});

it('issues no cookie after a real session-insert failure and removes the failure fixture', async () => {
  const value = await account();
  const name = `session_insert_fixture_${crypto.randomBytes(8).toString('hex')}`;
  const literal = value.caller.id.replace(/'/g, "''");
  let functionCreated = false;
  let triggerCreated = false;
  try {
    // Trigger a real insert failure only for this fixture account.
    await fixture.prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" = TG_ARGV[0] THEN RAISE EXCEPTION 'Expected fixture session insert failure'; END IF; RETURN NEW; END; $$`,
    );
    functionCreated = true;
    await fixture.prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${name}" BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION "${name}"('${literal}')`,
    );
    triggerCreated = true;
    const before = await fixture.prisma.session.count({ where: { userId: value.caller.id } });
    const result = await request(app)
      .post('/auth/login')
      .set('X-Tenant', value.tenant.slug)
      .send({ email: value.user.email, password: value.password });
    expect(result.status).toBe(500);
    expect(cookieFrom(result.headers)).toBeNull();
    expect(await fixture.prisma.session.count({ where: { userId: value.caller.id } })).toBe(before);
  } finally {
    if (triggerCreated) await fixture.prisma.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "Session"`);
    if (functionCreated) await fixture.prisma.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);
  }
  const remaining = await fixture.prisma.$queryRaw<
    Array<{ count: bigint }>
  >`SELECT count(*) FROM pg_trigger WHERE tgname=${name}`;
  expect(Number(remaining[0]?.count)).toBe(0);
});

it('creates distinct sessions for two rapid logins', async () => {
  const value = await account();
  const login = () =>
    request(app)
      .post('/auth/login')
      .set('X-Tenant', value.tenant.slug)
      .send({ email: value.user.email, password: value.password });
  const [first, second] = await Promise.all([login(), login()]);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  const a = cookieFrom(first.headers),
    b = cookieFrom(second.headers);
  expect(!!a && !!b && a !== b).toBe(true);
  expect(await fixture.prisma.session.count({ where: { userId: value.caller.id } })).toBe(3);
});

it('preserves unmarked unverified legacy memberships and reports their actual status', async () => {
  const value = await account();
  await fixture.prisma.user.update({ where: { id: value.caller.id }, data: { emailVerifiedAt: null } });
  const result = await request(app)
    .get('/auth/me')
    .set('X-Tenant', value.tenant.slug)
    .set('Cookie', cookieHeader(value.caller.session));
  expect(result.status).toBe(200);
  expect(result.body.emailVerified).toBe(false);
});

it('confirms an unmarked legacy address only through its actual mailbox link', async () => {
  const value = await account();
  await fixture.prisma.user.update({ where: { id: value.caller.id }, data: { emailVerifiedAt: null } });
  const result = await request(app).post('/auth/verify/request').set('Cookie', cookieHeader(value.caller.session));
  expect(result.status).toBe(200);
  expect('token' in result.body || 'verifyUrl' in result.body).toBe(false);
  const token = await setup.mail.token(value.user.email);
  expect((await request(app).post('/auth/verify').send({ token })).status).toBe(200);
  expect(!!(await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.caller.id } })).emailVerifiedAt).toBe(
    true,
  );
});

it('delivers the reset link and stores only its digest', async () => {
  const value = await account();
  const result = await request(app).post('/auth/forgot').send({ email: value.user.email });
  expect(result.status).toBe(200);
  expect('token' in result.body || 'resetUrl' in result.body).toBe(false);
  const token = await setup.mail.token(value.user.email, 'reset');
  const stored = await fixture.prisma.passwordReset.findFirstOrThrow({ where: { userId: value.user.id } });
  expect(stored.token === token).toBe(false);
});

it('responds neutrally for an unknown address without creating an account or token', async () => {
  const email = setup.email();
  expect((await request(app).post('/auth/forgot').send({ email })).status).toBe(200);
  expect(await fixture.prisma.user.count({ where: { email } })).toBe(0);
});

it('creates no reset for an account without a password', async () => {
  const value = await account();
  await fixture.prisma.user.update({ where: { id: value.caller.id }, data: { passwordHash: null } });
  expect((await request(app).post('/auth/forgot').send({ email: value.user.email })).status).toBe(200);
  expect(await fixture.prisma.passwordReset.count({ where: { userId: value.user.id } })).toBe(0);
});

it('resets the password once and revokes all stored sessions', async () => {
  const value = await account();
  const { token } = await issuePasswordResetToken(fixture.prisma, value.user.id);
  const next = password();
  expect((await request(app).post('/auth/reset').send({ email: value.user.email, token, password: next })).status).toBe(
    200,
  );
  expect(await fixture.prisma.session.count({ where: { userId: value.user.id } })).toBe(0);
  expect(
    (await request(app).post('/auth/reset').send({ email: value.user.email, token, password: password() })).status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post('/auth/login')
        .set('X-Tenant', value.tenant.slug)
        .send({ email: value.user.email, password: next })
    ).status,
  ).toBe(200);
});

it('rejects expired reset links and mismatched addresses without changing the password', async () => {
  for (const mode of ['expired', 'email']) {
    const value = await account();
    const { token } = await issuePasswordResetToken(
      fixture.prisma,
      value.user.id,
      mode === 'expired' ? -1000 : undefined,
    );
    const result = await request(app)
      .post('/auth/reset')
      .send({ email: mode === 'email' ? setup.email() : value.user.email, token, password: password() });
    expect(result.status).toBe(400);
    expect(
      (await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).passwordHash ===
        value.user.passwordHash,
    ).toBe(true);
  }
});

it('invalidates the previous reset link when issuing another one', async () => {
  const value = await account();
  const first = await issuePasswordResetToken(fixture.prisma, value.user.id);
  await issuePasswordResetToken(fixture.prisma, value.user.id);
  expect((await request(app).post('/auth/reset').send({ token: first.token, password: password() })).status).toBe(400);
});

it('retains only the current session and invalidates pending reset links on password change', async () => {
  const value = await account();
  const other = await fixture.session(value.user.id, value.tenant.id);
  const reset = await issuePasswordResetToken(fixture.prisma, value.user.id);
  const result = await request(app)
    .post('/auth/change')
    .set('Cookie', cookieHeader(value.caller.session))
    .send({ currentPassword: value.password, newPassword: password() });
  expect(result.status).toBe(200);
  expect(await fixture.prisma.session.count({ where: { userId: value.user.id } })).toBe(1);
  expect(await fixture.prisma.session.count({ where: { id: value.caller.sessionId } })).toBe(1);
  expect(await fixture.prisma.session.count({ where: { id: other.id } })).toBe(0);
  expect((await request(app).post('/auth/reset').send({ token: reset.token, password: password() })).status).toBe(400);
});

for (const mode of ['no_provider', 'closed_smtp']) {
  it(`responds neutrally in ${mode} regardless of reset delivery failure`, async () => {
    const result = await promisify(execFile)(
      process.execPath,
      ['--import', 'tsx', 'test/fixtures/forgotDeliveryProbe.ts', mode],
      { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test' }, timeout: 45_000, maxBuffer: 256_000 },
    );
    const line = result.stdout.split('\n').find((line) => line.startsWith('PASSWORD_RESET_DELIVERY_RESULT:'));
    if (!line) throw new Error('The reset delivery probe returned no result evidence.');
    const body: unknown = JSON.parse(line.slice('PASSWORD_RESET_DELIVERY_RESULT:'.length));
    expect(
      !!body &&
        typeof body === 'object' &&
        'status' in body &&
        body.status === 200 &&
        'secret' in body &&
        body.secret === false,
    ).toBe(true);
    if (mode === 'closed_smtp') {
      const received = result.stdout.indexOf('PASSWORD_RESET_DELIVERY_RESULT:');
      const failed = result.stdout.indexOf('email.smtp.send_failed');
      expect(received >= 0 && failed > received).toBe(true);
    }
  }, 50_000);
}
