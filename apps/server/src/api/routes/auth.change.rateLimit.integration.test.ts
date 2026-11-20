import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAuthRoutes } from './auth.js';
import { errorHandler } from '../errorHandler.js';

const fixture = createHttpFixture();
const app = fixture.app();
const previousEnabled = process.env.RATE_LIMIT_ENABLED;
const previousMax = process.env.RATE_LIMIT_PASSWORD_CHANGE_MAX;
const previousWindow = process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS;
const previousIpMax = process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_MAX;
const previousIpWindow = process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_WINDOW_MS;

beforeAll(() => {
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_MAX = '5';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS = '900000';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_MAX = '20';
  process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_WINDOW_MS = '900000';
  registerAuthRoutes(app, fixture.prisma);
  app.use(errorHandler);
});
afterAll(async () => {
  if (previousEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
  else process.env.RATE_LIMIT_ENABLED = previousEnabled;
  if (previousMax === undefined) delete process.env.RATE_LIMIT_PASSWORD_CHANGE_MAX;
  else process.env.RATE_LIMIT_PASSWORD_CHANGE_MAX = previousMax;
  if (previousWindow === undefined) delete process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS;
  else process.env.RATE_LIMIT_PASSWORD_CHANGE_WINDOW_MS = previousWindow;
  if (previousIpMax === undefined) delete process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_MAX;
  else process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_MAX = previousIpMax;
  if (previousIpWindow === undefined) delete process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_WINDOW_MS;
  else process.env.RATE_LIMIT_PASSWORD_CHANGE_IP_WINDOW_MS = previousIpWindow;
  await fixture.close();
});

describe('password changes with real HTTP and database identities', () => {
  it('limits incorrect attempts across sessions before bcrypt and preserves the password', async () => {
    const own = await fixture.tenant();
    const password = crypto.randomBytes(24).toString('hex');
    const caller = await fixture.caller(own.tenant, 'member', password);
    const second = await fixture.session(caller.id, own.tenant.id);
    const before = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    const body = { currentPassword: `wrong-${crypto.randomUUID()}`, newPassword: crypto.randomUUID() };
    for (let index = 0; index < 5; index++) {
      const response = await request(app)
        .post('/auth/change')
        .set('x-tenant', own.tenant.slug)
        .set('Authorization', `Bearer ${index % 2 ? second.token : caller.session}`)
        .send(body);
      expect(response.status).toBe(401);
    }
    const limited = await request(app)
      .post('/auth/change')
      .set('x-tenant', own.tenant.slug)
      .set('Authorization', `Bearer ${second.token}`)
      .send(body);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    const after = await fixture.prisma.user.findUniqueOrThrow({ where: { id: caller.id } });
    expect(after.passwordHash === before.passwordHash).toBe(true);

    const other = await fixture.caller(own.tenant, 'member', password);
    const revoked = await fixture.session(other.id, own.tenant.id);
    const newPassword = crypto.randomBytes(24).toString('hex');
    const allowed = await request(app)
      .post('/auth/change')
      .set('x-tenant', own.tenant.slug)
      .set('Authorization', `Bearer ${other.session}`)
      .send({ currentPassword: password, newPassword });
    expect(allowed.status).toBe(200);
    expect(await fixture.prisma.session.count({ where: { id: revoked.id } })).toBe(0);
    expect(await fixture.prisma.session.count({ where: { id: other.sessionId } })).toBe(1);
    const updated = await fixture.prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    expect(await bcrypt.compare(newPassword, updated.passwordHash ?? '')).toBe(true);
  });
});
