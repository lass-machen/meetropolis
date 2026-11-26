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

it('grants the permitted role once for five concurrent redemptions of a real mailbox proof', async () => {
  const value = await registration();
  expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
  const session = await fixture.session(value.user.id, value.tenant.id);
  const blocked = await request(app)
    .get('/auth/me')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${session.token}`);
  expect(blocked.status).toBe(409);
  const stored = await fixture.prisma.emailVerification.findFirstOrThrow({
    where: { userId: value.user.id, purpose: 'invite', inviteId: value.invite.id, readyAt: { not: null } },
  });
  expect(stored.token === value.token).toBe(false);
  expect(stored.token === crypto.createHash('sha256').update(value.token).digest('hex')).toBe(true);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => request(app).post('/auth/verify').send({ token: value.token })),
  );
  expect(responses.filter((res) => res.status === 200)).toHaveLength(1);
  expect(responses.filter((res) => res.status === 400)).toHaveLength(4);
  const members = await fixture.prisma.membership.findMany({
    where: { userId: value.user.id, tenantId: value.tenant.id },
  });
  expect(members.map((m) => m.role)).toEqual(['admin']);
  expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.invite.id } })).usedAt !== null).toBe(
    true,
  );
  const me = await request(app)
    .get('/auth/me')
    .set('X-Tenant', value.tenant.slug)
    .set('Authorization', `Bearer ${session.token}`);
  expect(me.status).toBe(200);
  expect(me.body.role).toBe('admin');
}, 60_000);
