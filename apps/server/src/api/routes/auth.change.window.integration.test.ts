import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAuthRoutes } from './auth.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
afterAll(() => fixture.close());

it('permits a valid password change after the real rate-limit window expires', async () => {
  const keys = [
    'RATE_LIMIT_ENABLED',
    'RATE_LIMIT_PASSWORD_CHANGE_MAX',
    'RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS',
    'RATE_LIMIT_PASSWORD_CHANGE_IP_MAX',
  ];
  const previous = keys.map((key) => process.env[key]);
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_MAX = '2';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS = '5000';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_MAX = '50';
  try {
    const { tenant } = await fixture.tenant();
    const password = crypto.randomBytes(20).toString('hex');
    const caller = await fixture.caller(tenant, 'member', password);
    const app = fixture.app();
    registerAuthRoutes(app, fixture.prisma);
    app.use(errorHandler);
    const post = (currentPassword: string) =>
      request(app)
        .post('/auth/change')
        .set('X-Tenant', tenant.slug)
        .set('Authorization', `Bearer ${caller.session}`)
        .send({ currentPassword, newPassword: crypto.randomBytes(20).toString('hex') });
    expect((await post('incorrect-password')).status).toBe(401);
    expect((await post('incorrect-password')).status).toBe(401);
    const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    expect((await post(password)).status).toBe(429);
    expect(
      (await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } })).passwordHash === before.passwordHash,
    ).toBe(true);
    // Use a short real window without changing the product clock.
    await new Promise((resolve) => setTimeout(resolve, 5100));
    expect((await post(password)).status).toBe(200);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}, 30_000);
