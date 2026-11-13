import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

// Real platform-operator contract, including its retained raw-token response.
const setup = createEmailProofFixture();
const { fixture, app } = setup;
afterAll(() => setup.close());
async function resetFixture() {
  const { tenant } = await fixture.tenant();
  const operator = await fixture.caller(tenant);
  let internal = await fixture.prisma.tenant.findUnique({ where: { slug: 'internal' } });
  if (!internal) {
    internal = await fixture.prisma.tenant.create({ data: { slug: 'internal', name: 'Internal test tenant' } });
    fixture.tenantIds.push(internal.id);
  }
  await fixture.prisma.membership.create({ data: { userId: operator.id, tenantId: internal.id, role: 'owner' } });
  const target = await fixture.caller(tenant, 'member', crypto.randomBytes(20).toString('hex'));
  const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  const result = await request(app)
    .post(`/admin/users/${target.id}/reset-token`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${operator.session}`)
    .send({});
  expect(result.status).toBe(200);
  if (typeof result.body.token !== 'string') throw new Error('Platform-operator reset returned no token.');
  return { target, user, token: result.body.token as string };
}

it('accepts the platform-operator token through the real reset handler', async () => {
  const value = await resetFixture();
  const result = await request(app)
    .post('/auth/reset')
    .send({ token: value.token, email: value.user.email, password: crypto.randomBytes(20).toString('hex') });
  expect(result.status).toBe(200);
  expect(await fixture.prisma.session.count({ where: { userId: value.target.id } })).toBe(0);
});

it('stores only the digest of a platform-operator reset token', async () => {
  const value = await resetFixture();
  const rows = await fixture.prisma.passwordReset.findMany({ where: { userId: value.target.id } });
  expect(rows).toHaveLength(1);
  expect(rows[0].token === value.token).toBe(false);
});

it('rejects replay of a consumed platform-operator reset token', async () => {
  const value = await resetFixture();
  expect(
    (
      await request(app)
        .post('/auth/reset')
        .send({ token: value.token, password: crypto.randomBytes(20).toString('hex') })
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post('/auth/reset')
        .send({ token: value.token, password: crypto.randomBytes(20).toString('hex') })
    ).status,
  ).toBe(400);
});
