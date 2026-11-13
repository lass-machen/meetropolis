import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

const setup = createEmailProofFixture();
const { fixture, app, registration } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

it('preserves the password and existing role on registration retry', async () => {
  const value = await registration();
  const before = value.user.passwordHash;
  const retry = await request(app)
    .post('/auth/register')
    .set('X-Tenant', value.tenant.slug)
    .send({ code: value.invite.code, email: value.user.email, password: crypto.randomBytes(24).toString('hex') });
  expect(retry.status).toBe(409);
  expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).passwordHash === before).toBe(
    true,
  );
  expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
});
