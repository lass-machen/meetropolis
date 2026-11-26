import { afterAll, expect, it } from 'vitest';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from './authHelpers.js';
import { hashSessionToken } from './sessionAuth.js';
import net from 'node:net';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/index.js';
import { createHttpFixture } from '../../../test/fixtures/httpFixture.js';
import { validateSessionToken, validateTenantSessionFresh } from './sessionAuth.js';

const fixture = createHttpFixture();
afterAll(() => fixture.close());

it('reads the session and membership afresh despite a populated general session cache', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  expect(!!(await validateSessionToken(fixture.prisma, caller.session))).toBe(true);
  expect((await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).status).toBe('allowed');
  await fixture.prisma.membership.update({
    where: { tenantId_userId: { tenantId: tenant.id, userId: caller.id } },
    data: { inviteVerificationRequired: true },
  });
  expect(await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).toEqual({
    status: 'forbidden',
    reason: 'verification_required',
  });
  await fixture.prisma.membership.update({
    where: { tenantId_userId: { tenantId: tenant.id, userId: caller.id } },
    data: { inviteVerificationRequired: false, expiresAt: new Date(Date.now() - 1000) },
  });
  expect((await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).status).toBe('forbidden');
  await fixture.prisma.membership.delete({ where: { tenantId_userId: { tenantId: tenant.id, userId: caller.id } } });
  expect((await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).status).toBe('forbidden');
  await fixture.prisma.session.delete({ where: { id: caller.sessionId } });
  expect(await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).toEqual({
    status: 'unauthenticated',
  });
  expect(await validateTenantSessionFresh(fixture.prisma, caller.apiToken, tenant.id)).toEqual({
    status: 'unauthenticated',
  });
});

it('reads platform-operator rights and their markers afresh on every call', async () => {
  const { tenant } = await fixture.tenant();
  const other = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  let internal = await fixture.prisma.tenant.findUnique({ where: { slug: 'internal' } });
  if (!internal) {
    internal = await fixture.prisma.tenant.create({ data: { slug: 'internal', name: 'Internal test tenant' } });
    fixture.tenantIds.push(internal.id);
  }
  const operator = await fixture.prisma.membership.create({
    data: { tenantId: internal.id, userId: caller.id, role: 'owner' },
  });
  const result = await validateTenantSessionFresh(fixture.prisma, caller.session, other.tenant.id);
  expect(result.status === 'allowed' && result.access === 'platform_operator').toBe(true);
  await fixture.prisma.membership.update({ where: { id: operator.id }, data: { inviteVerificationRequired: true } });
  expect((await validateTenantSessionFresh(fixture.prisma, caller.session, other.tenant.id)).status).toBe('forbidden');
});

it('propagates a real database connection failure instead of treating it as missing authentication', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('No local probe port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
  const url = new URL(process.env.DATABASE_URL!);
  url.port = String(port);
  const unavailable = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), connectionTimeoutMillis: 1000 }),
  });
  try {
    await expect(validateTenantSessionFresh(unavailable, caller.session, tenant.id)).rejects.toThrow();
  } finally {
    await unavailable.$disconnect();
  }
});

it('distinguishes expired sessions, mismatched subjects and missing tenants without a cache fallback', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  await validateSessionToken(fixture.prisma, caller.session);
  expect(await validateTenantSessionFresh(fixture.prisma, caller.session, crypto.randomUUID())).toEqual({
    status: 'forbidden',
    reason: 'tenant_unavailable',
  });
  await fixture.prisma.session.update({
    where: { id: caller.sessionId },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  expect(await validateTenantSessionFresh(fixture.prisma, caller.session, tenant.id)).toEqual({
    status: 'unauthenticated',
  });
  const other = await fixture.caller(tenant);
  const raw = jwt.sign({ sub: other.id, tid: tenant.id, jti: crypto.randomUUID() }, getJwtSecret(), {
    expiresIn: '1h',
  });
  await fixture.prisma.session.create({
    data: { userId: caller.id, tokenHash: hashSessionToken(raw), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  expect(await validateTenantSessionFresh(fixture.prisma, raw, tenant.id)).toEqual({ status: 'unauthenticated' });
});

it('rejects verification-only sessions even after the account has been confirmed', async () => {
  const { tenant } = await fixture.tenant();
  const caller = await fixture.caller(tenant);
  const token = jwt.sign(
    { sub: caller.id, tid: tenant.id, jti: crypto.randomUUID(), scope: 'email_verification' },
    getJwtSecret(),
    { expiresIn: '15m' },
  );
  await fixture.prisma.session.create({
    data: { userId: caller.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 900_000) },
  });
  expect(await validateTenantSessionFresh(fixture.prisma, token, tenant.id)).toEqual({ status: 'unauthenticated' });
});
