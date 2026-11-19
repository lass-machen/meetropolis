import crypto from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerMiscRoutes } from './misc.js';
import { registerAuthRoutes } from './auth.js';
import { createMailFixture } from '../../../test/fixtures/mailFixture.js';

const fixture = createHttpFixture();
const app = fixture.app();
registerMiscRoutes(app, fixture.prisma);
registerAuthRoutes(app, fixture.prisma);
// The email proof needs actual mail delivery; set it up here like the other mail tests
// instead of relying on the SMTP settings of the caller.
const mail = createMailFixture();
const originalBase = process.env.PUBLIC_BASE_URL;
beforeAll(async () => {
  await mail.connect();
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
});
afterAll(async () => {
  if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBase;
  await fixture.close();
  await mail.close();
});

it('prevents tenant administrators from overwriting another account email address', async () => {
  const { tenant } = await fixture.tenant();
  const admin = await fixture.caller(tenant, 'admin');
  const target = await fixture.caller(tenant);
  const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  const result = await request(app)
    .patch(`/users/${target.id}`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({ email: `fixture-account-${crypto.randomUUID()}@example.test` });
  expect(result.status).toBe(403);
  const after = await fixture.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  expect(after.email === before.email).toBe(true);
  expect(after.emailVerifiedAt?.getTime()).toBe(before.emailVerifiedAt?.getTime());
});

for (const route of ['me', 'users/self']) {
  it(`PATCH /${route} preserves the active email address until confirmation`, async () => {
    const { tenant } = await fixture.tenant();
    const caller = await fixture.caller(tenant);
    const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    const email = `fixture-account-${crypto.randomUUID()}@example.test`;
    const path = route === 'me' ? '/me' : `/users/${caller.id}`;
    const result = await request(app)
      .patch(path)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ email });
    const after = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    expect(after.email === before.email).toBe(true);
    expect(after.emailVerifiedAt?.getTime()).toBe(before.emailVerifiedAt?.getTime());
    expect(result.status).toBe(202);
    expect(result.body.emailChangePending).toBe(true);
  });
}

it('does not confirm a different account address with an old confirmation link', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  const raw = crypto.randomBytes(32).toString('hex');
  await fixture.prisma.emailVerification.create({
    data: {
      userId: caller.id,
      email: before.email,
      sourceEmail: before.email,
      purpose: 'verify',
      readyAt: new Date(),
      token: crypto.createHash('sha256').update(raw).digest('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  await fixture.prisma.user.update({
    where: { id: caller.id },
    data: {
      email: `fixture-account-${crypto.randomUUID()}@example.test`,
      emailVerifiedAt: null,
    },
  });
  const result = await request(app).post('/auth/verify').send({ token: raw });
  expect(result.status).toBe(400);
  expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })).emailVerifiedAt).toBeNull();
});
