import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

const setup = createEmailProofFixture();
const { fixture, app, email, tokenFromMail } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

it('keeps superseded links invalid through an address round trip', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  const first = email(),
    second = email();
  const patch = (email: string) =>
    request(app)
      .patch('/me')
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ email });
  expect((await patch(first)).status).toBe(202);
  const old = await tokenFromMail(first);
  expect((await patch(second)).status).toBe(202);
  const current = await tokenFromMail(second);
  expect((await request(app).post('/auth/verify').send({ token: old })).status).toBe(400);
  expect((await request(app).post('/auth/verify').send({ token: current })).status).toBe(200);
  // A new intent may target the original address without reviving its old proof.
  expect((await patch(before.email)).status).toBe(202);
  expect((await request(app).post('/auth/verify').send({ token: old })).status).toBe(400);
  expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })).email === second).toBe(true);
}, 60_000);
