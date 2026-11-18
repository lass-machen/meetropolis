import { execFile } from 'node:child_process';
import request from 'supertest';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { registerAdminPasswordResetRoutes } from './admin.passwordReset.js';

const fixture = createHttpFixture();
const app = fixture.app();
registerAdminPasswordResetRoutes(app, fixture.prisma);
const originalBase = process.env.PUBLIC_BASE_URL;
beforeAll(() => {
  process.env.PUBLIC_BASE_URL = 'https://app.example.test';
});
afterAll(async () => {
  if (originalBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBase;
  await fixture.close();
});

it('returns only delivery confirmation and no reset secrets to tenant administrators', async () => {
  const { tenant } = await fixture.tenant();
  const admin = await fixture.caller(tenant, 'admin');
  const target = await fixture.caller(tenant);
  const result = await request(app)
    .post(`/admin/users/${target.id}/reset-token`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  expect('token' in result.body || 'resetUrl' in result.body).toBe(false);
  expect(result.status).toBe(200);
  expect(result.body.sent).toBe(true);
});

it('prevents tenant administrators from resetting an owner password', async () => {
  const { tenant } = await fixture.tenant();
  const admin = await fixture.caller(tenant, 'admin');
  const owner = await fixture.caller(tenant, 'owner');
  const result = await request(app)
    .post(`/admin/users/${owner.id}/reset-token`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  expect(result.status).toBe(403);
  expect(await fixture.prisma.passwordReset.count({ where: { userId: owner.id } })).toBe(0);
});

it('prevents tenant administrators from resetting accounts belonging to other tenants', async () => {
  const own = await fixture.tenant();
  const other = await fixture.tenant();
  const admin = await fixture.caller(own.tenant, 'admin');
  const target = await fixture.caller(own.tenant);
  await fixture.prisma.membership.create({ data: { tenantId: other.tenant.id, userId: target.id } });
  const result = await request(app)
    .post(`/admin/users/${target.id}/reset-token`)
    .set('X-Tenant', own.tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  expect(result.status).toBe(403);
  expect(await fixture.prisma.passwordReset.count({ where: { userId: target.id } })).toBe(0);
});

it('returns user_not_in_tenant for multi-tenant accounts outside the requesting tenant', async () => {
  const own = await fixture.tenant();
  const first = await fixture.tenant();
  const second = await fixture.tenant();
  const admin = await fixture.caller(own.tenant, 'admin');
  const target = await fixture.caller(first.tenant);
  await fixture.prisma.membership.create({
    data: { tenantId: second.tenant.id, userId: target.id },
  });
  const result = await request(app)
    .post(`/admin/users/${target.id}/reset-token`)
    .set('X-Tenant', own.tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  expect(result.status).toBe(403);
  expect(result.body).toEqual({ error: 'user_not_in_tenant' });
  expect(
    await fixture.prisma.passwordReset.count({
      where: { userId: target.id },
    }),
  ).toBe(0);
});

it('returns platform_admin_required when the target is an owner', async () => {
  const { tenant } = await fixture.tenant();
  const admin = await fixture.caller(tenant, 'admin');
  const owner = await fixture.caller(tenant, 'owner');
  const result = await request(app)
    .post(`/admin/users/${owner.id}/reset-token`)
    .set('X-Tenant', tenant.slug)
    .set('Authorization', `Bearer ${admin.session}`)
    .send({});
  expect(result.status).toBe(403);
  expect(result.body).toEqual({ error: 'platform_admin_required' });
  expect(
    await fixture.prisma.passwordReset.count({
      where: { userId: owner.id },
    }),
  ).toBe(0);
});

it('revokes the new token when delivery fails', async () => {
  const result = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'test/fixtures/adminResetDeliveryProbe.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 45_000,
      maxBuffer: 256_000,
    },
  );
  const line = result.stdout.split('\n').find((value) => value.startsWith('ADMIN_RESET_DELIVERY_RESULT:'));
  if (!line) {
    throw new Error('The admin reset probe returned no result evidence.');
  }
  const parsed: unknown = JSON.parse(line.slice('ADMIN_RESET_DELIVERY_RESULT:'.length));
  expect(!!parsed && typeof parsed === 'object' && 'status' in parsed && parsed.status === 503).toBe(true);
  expect(!!parsed && typeof parsed === 'object' && 'secret' in parsed && parsed.secret === false).toBe(true);
  expect(!!parsed && typeof parsed === 'object' && 'unused' in parsed && parsed.unused === 0).toBe(true);
}, 50_000);
