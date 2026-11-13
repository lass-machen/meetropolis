import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

const setup = createEmailProofFixture();
const { fixture, app } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

it('does not unlock an old marked administrator role through a new invitation', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant, 'admin');
  const user = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
  await fixture.prisma.membership.update({
    where: { tenantId_userId: { tenantId: tenant.id, userId: caller.id } },
    data: { inviteVerificationRequired: true },
  });
  const invite = await fixture.prisma.invite.create({
    data: {
      tenantId: tenant.id,
      email: user.email,
      code: crypto.randomBytes(12).toString('hex'),
      role: 'member',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const result = await request(app)
    .post('/invites/accept')
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${caller.session}`)
    .send({ code: invite.code });
  expect(result.status).toBe(200);
  const member = await fixture.prisma.membership.findUniqueOrThrow({
    where: { tenantId_userId: { tenantId: tenant.id, userId: caller.id } },
  });
  expect(member.role).toBe('member');
  expect(member.inviteVerificationRequired).toBe(false);
});
