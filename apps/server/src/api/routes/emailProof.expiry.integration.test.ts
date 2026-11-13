import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmailProofFixture } from '../../../test/fixtures/emailProofFixture.js';

const setup = createEmailProofFixture();
const { fixture, app, registration } = setup;
beforeAll(async () => {
  await setup.mail.connect();
});
afterAll(() => setup.close());

it('creates no membership or partial consumption after expiry or revocation', async () => {
  for (const action of ['expire', 'revoke']) {
    const value = await registration();
    if (action === 'expire')
      await fixture.prisma.emailVerification.updateMany({
        where: { userId: value.user.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
    else await fixture.prisma.invite.delete({ where: { id: value.invite.id } });
    const result = await request(app).post('/auth/verify').send({ token: value.token });
    expect(result.status).toBe(400);
    expect(await fixture.prisma.membership.count({ where: { userId: value.user.id } })).toBe(0);
    expect((await fixture.prisma.user.findUniqueOrThrow({ where: { id: value.user.id } })).emailVerifiedAt).toBeNull();
  }
}, 60_000);
