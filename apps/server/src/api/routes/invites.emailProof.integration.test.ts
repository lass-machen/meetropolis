import crypto from 'crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAuthRoutes } from './auth.js';
import { registerInviteRoutes } from './invites.js';

const fixture = createHttpFixture();
const originalBase = process.env.PUBLIC_BASE_URL;
const app = fixture.app();
registerAuthRoutes(app, fixture.prisma);
registerInviteRoutes(app, fixture.prisma);
beforeAll(() => {
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
});
afterAll(async () => {
  if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBase;
  await fixture.close();
});

async function invite(email: string) {
  const { tenant } = await fixture.tenant();
  const value = await fixture.prisma.invite.create({
    data: {
      tenantId: tenant.id,
      email,
      code: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + 3_600_000),
      role: 'admin',
    },
  });
  return { tenant, value };
}

describe('invitation acceptance requires separate email proof', () => {
  it('grants no membership or invitation role before email proof for a new registration', async () => {
    const email = `fixture-account-${crypto.randomUUID()}@example.test`;
    fixture.userEmails.push(email);
    const { tenant, value } = await invite(email);
    const result = await request(app)
      .post('/auth/register')
      .set('X-Tenant', tenant.slug)
      .send({ code: value.code, email, password: crypto.randomBytes(20).toString('hex') });
    const user = await fixture.prisma.user.findUnique({ where: { email } });
    const count = user ? await fixture.prisma.membership.count({ where: { userId: user.id, tenantId: tenant.id } }) : 0;
    expect(count).toBe(0);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.id } })).usedAt).toBeNull();
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(user?.emailVerifiedAt ?? null).toBeNull();
  });

  it('grants no new membership to an existing unverified account', async () => {
    const own = await fixture.tenant();
    const caller = await fixture.caller(own.tenant);
    const user = await fixture.prisma.user.update({ where: { id: caller.id }, data: { emailVerifiedAt: null } });
    const { tenant, value } = await invite(user.email);
    const result = await request(app)
      .post('/invites/accept')
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${caller.session}`)
      .send({ code: value.code });
    expect(await fixture.prisma.membership.count({ where: { userId: user.id, tenantId: tenant.id } })).toBe(0);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.id } })).usedAt).toBeNull();
    expect(result.status).toBeGreaterThanOrEqual(400);
  });

  for (const mode of ['production', 'development']) {
    it(`returns neither a proof token nor a link after real delivery failure in ${mode}`, async () => {
      const result = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', 'test/fixtures/verifyDeliveryProbe.ts'],
        { cwd: process.cwd(), env: { ...process.env, NODE_ENV: mode }, timeout: 45_000, maxBuffer: 256_000 },
      );
      const line = result.stdout.split('\n').find((value) => value.startsWith('VERIFICATION_DELIVERY_RESULT:'));
      if (!line) throw new Error('The delivery probe process returned no result evidence.');
      const parsed: unknown = JSON.parse(line.slice('VERIFICATION_DELIVERY_RESULT:'.length));
      if (!parsed || typeof parsed !== 'object' || !('secret' in parsed)) throw new Error('Invalid result evidence.');
      expect(parsed.secret).toBe(false);
    }, 50_000);
  }

  it('explains an invalid legacy invitation link', async () => {
    const result = await request(app).post('/public/invites/preview').send({ code: 'undefined' });
    expect(result.status).toBe(404);
    expect(String(result.body.error)).toMatch(/invitation|update/i);
  });

  it('rejects a code in the DELETE path with 400 after the administrator gate and preserves the invitation', async () => {
    const { tenant, value } = await invite(`fixture-account-${crypto.randomUUID()}@example.test`);
    const admin = await fixture.caller(tenant, 'admin');
    const result = await request(app)
      .delete(`/invites/${value.code}`)
      .set('X-Tenant', tenant.slug)
      .set('Authorization', `Bearer ${admin.session}`);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('invite_id_invalid');
    expect(String(result.body.error)).toMatch(/update/i);
    expect((await fixture.prisma.invite.findUniqueOrThrow({ where: { id: value.id } })).usedAt).toBeNull();
  });
});
