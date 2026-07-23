/**
 * Route tests for `GET /users`, the tenant member directory — names, e-mail
 * addresses, roles and guest expiry.
 *
 * The point of the file is the MEMBERSHIP gate. `getTenantFromReq` only names
 * the tenant a request is about; tenancy.ts deliberately lets the
 * client-supplied `X-Tenant` header win over the session JWT, so resolution is
 * not authorisation. Before the gate existed, any authenticated user could send
 * `X-Tenant: <foreign-slug>` and read a stranger's full member list including
 * every e-mail address — the same mistake as the cross-tenant custom-avatar
 * leak that was reproduced live on production, on PII instead of sprites.
 *
 * Uses an in-memory Prisma double. Auth and tenancy are NOT stubbed away: the
 * real `requireAuth` runs off a published auth resolution (exactly as
 * sessionAuth.ts does) and the real `requireMembership` performs the lookup, so
 * the spoof test genuinely exercises the check rather than mocking it into
 * agreement.
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerMiscRoutes } from './misc.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

interface MembershipRow {
  tenantId: string;
  userId: string;
  role: string;
  expiresAt?: Date | null;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
}

const USERS: UserRow[] = [
  { id: 'owner-a', email: 'owner-a@example.test', name: 'Owner A' },
  { id: 'member-a', email: 'member-a@example.test', name: 'Member A' },
  { id: 'owner-b', email: 'owner-b@example.test', name: 'Owner B' },
];

const MEMBERSHIPS: MembershipRow[] = [
  { tenantId: TENANT_A, userId: 'owner-a', role: 'owner' },
  { tenantId: TENANT_A, userId: 'member-a', role: 'member' },
  { tenantId: TENANT_B, userId: 'owner-b', role: 'owner' },
];

/**
 * Covers exactly the two delegates the route touches. `user.findMany`
 * implements the `memberships.some.tenantId` predicate faithfully — the
 * membership gate is a SEPARATE check, so the double must keep answering the
 * query honestly even for a tenant the caller does not belong to. Otherwise the
 * double, not the route, would be what stops the spoof.
 */
function makePrisma(): PrismaClient {
  const prisma = {
    user: {
      findMany: vi.fn(({ where }: { where: { memberships: { some: { tenantId: string } } } }) => {
        const tenantId = where.memberships.some.tenantId;
        const rows = USERS.filter((u) => MEMBERSHIPS.some((m) => m.userId === u.id && m.tenantId === tenantId)).map(
          (u) => ({
            ...u,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            memberships: MEMBERSHIPS.filter((m) => m.userId === u.id && m.tenantId === tenantId).map((m) => ({
              role: m.role,
              expiresAt: m.expiresAt ?? null,
            })),
          }),
        );
        return Promise.resolve(rows);
      }),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        const row = MEMBERSHIPS.find((m) => m.tenantId === tenantId && m.userId === userId);
        return Promise.resolve(row ? { role: row.role } : null);
      }),
    },
  };
  return prisma as unknown as PrismaClient;
}

/**
 * `x-user` stands in for the verified session identity; `x-tenant` is the
 * CLIENT-SUPPLIED tenant signal and deliberately wins, mirroring the tenancy.ts
 * priority chain (explicit header > token `tid` > host/default). Modelling that
 * precedence is what gives the spoof test its meaning.
 */
function makeApp(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const rawUser = req.headers['x-user'];
    const userId = typeof rawUser === 'string' ? rawUser : null;
    setAuthResolution(req, {
      auth: userId ? { userId, sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` } : null,
    });
    const rawTenant = req.headers['x-tenant'];
    if (typeof rawTenant === 'string') req.tenant = { id: rawTenant, slug: rawTenant, name: rawTenant } as never;
    next();
  });
  registerMiscRoutes(app, prisma);
  return app;
}

const listAs = (app: express.Express, userId: string | null, tenant: string | null) => {
  const req = request(app).get('/users');
  if (userId) req.set('x-user', userId);
  if (tenant) req.set('x-tenant', tenant);
  return req;
};

describe('GET /users — tenant membership gate', () => {
  it('lists the members of the caller’s own tenant', async () => {
    const res = await listAs(makeApp(makePrisma()), 'member-a', TENANT_A).expect(200);
    expect(res.body.map((u: { id: string }) => u.id).sort()).toEqual(['member-a', 'owner-a']);
    expect(res.body.find((u: { id: string }) => u.id === 'owner-a').role).toBe('owner');
  });

  it('refuses an X-Tenant spoof into a FOREIGN tenant', async () => {
    // The leak this file exists for: owner-b belongs to tenant B only, but the
    // header points req.tenant at tenant A. Tenant resolution obeys the header,
    // so the ONLY thing between this request and tenant A's e-mail addresses is
    // the membership lookup.
    const res = await listAs(makeApp(makePrisma()), 'owner-b', TENANT_A).expect(403);
    expect(res.body).toEqual({ error: 'forbidden' });
    expect(JSON.stringify(res.body)).not.toContain('@example.test');
  });

  it('rejects an unauthenticated request', async () => {
    await listAs(makeApp(makePrisma()), null, TENANT_A).expect(401);
  });

  it('rejects a request with no tenant context', async () => {
    await listAs(makeApp(makePrisma()), 'owner-a', null).expect(400);
  });

  it('never runs the query when membership is missing', async () => {
    // Fail-closed ordering: the gate sits BEFORE the read, so a foreign
    // directory is not even fetched, let alone filtered afterwards.
    const prisma = makePrisma();
    await listAs(makeApp(prisma), 'owner-b', TENANT_A).expect(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
