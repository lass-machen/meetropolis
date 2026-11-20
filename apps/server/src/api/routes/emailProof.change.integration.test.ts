import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

const setup = createEmailProofFixture();
const { fixture, app, email, tokenFromMail } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

it('notifies the old address and consumes the new-address proof atomically once', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  const next = email();
  const changed = await request(app)
    .patch('/me')
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${caller.session}`)
    .send({ email: next });
  expect(changed.status).toBe(202);
  const token = await tokenFromMail(next);
  await (await setup.mail.connect()).waitForMail({ to: before.email, subject: 'Email change requested' });
  expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })).email === before.email).toBe(true);
  const results = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/auth/verify').send({ token })));
  expect(results.filter((res) => res.status === 200)).toHaveLength(1);
  expect(results.filter((res) => res.status === 400)).toHaveLength(4);
  const after = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  expect(after.email === next).toBe(true);
  expect(!!after.emailVerifiedAt).toBe(true);
}, 60_000);
