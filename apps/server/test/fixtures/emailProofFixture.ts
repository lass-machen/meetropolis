import crypto from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { createHttpFixture } from './httpFixture.js';
import { createMailFixture } from './mailFixture.js';
import { registerAuthRoutes } from '../../src/api/routes/auth.js';
import { registerMiscRoutes } from '../../src/api/routes/misc.js';
import { registerInviteRoutes } from '../../src/api/routes/invites.js';
import { registerAdminPasswordResetRoutes } from '../../src/api/routes/admin.passwordReset.js';
import { errorHandler } from '../../src/api/errorHandler.js';
import { hashInviteCode } from '../../src/api/utils/inviteCode.js';

export function createEmailProofFixture() {
  const originalBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL ??= 'https://app.example.test';
  const fixture = createHttpFixture();
  const mail = createMailFixture();
  const app = fixture.app();
  registerAuthRoutes(app, fixture.prisma);
  registerMiscRoutes(app, fixture.prisma);
  registerInviteRoutes(app, fixture.prisma);
  registerAdminPasswordResetRoutes(app, fixture.prisma);
  app.use(errorHandler);
  const email = () => `fixture-account-${crypto.randomUUID()}@example.test`;
  async function registration() {
    const own = await fixture.tenant();
    const target = email();
    fixture.userEmails.push(target);
    const code = crypto.randomBytes(12).toString('hex');
    const invite = await fixture.prisma.invite.create({
      data: {
        tenantId: own.tenant.id,
        email: target,
        code: hashInviteCode(code),
        role: 'admin',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const password = crypto.randomBytes(20).toString('hex');
    const result = await request(app)
      .post('/auth/register')
      .set('X-Tenant', own.tenant.slug)
      .send({ code, email: target, password });
    expect(result.status).toBe(409);
    expect(result.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    const user = await fixture.prisma.user.findUniqueOrThrow({ where: { email: target } });
    fixture.userIds.push(user.id);
    const cookies = result.headers['set-cookie'];
    const cookie = Array.isArray(cookies)
      ? cookies.find((value: string) => value.startsWith('auth_token='))?.split(';')[0]
      : null;
    if (!cookie) throw new Error('Pending registration did not create a restricted session cookie.');
    return { ...own, user, invite, token: await mail.token(target), password, cookie };
  }
  return {
    fixture,
    mail,
    app,
    email,
    registration,
    tokenFromMail: mail.token,
    close: async () => {
      await mail.close();
      await fixture.close();
      if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = originalBase;
    },
  };
}
