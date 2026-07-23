import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// The middleware logs on unexpected errors; keep the test output clean.
vi.mock('../../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createRequireTenantAdmin } from './authHelpers.js';
import { setAuthResolution } from './authState.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

// ---------------------------------------------------------------------------
// requireTenantAdmin (M2/M4)
//
// The guard binds the authenticated caller to the *resolved* tenant: only an
// owner/admin member of that tenant — or a platform super-admin — may pass. A
// spoofed X-Tenant header naming a foreign tenant must be refused, which closes
// the cross-tenant access hole on the enterprise /billing/* routes.
// ---------------------------------------------------------------------------

const TEST_SECRET = 'test-tenant-admin-secret';
const INTERNAL_TENANT_ID = 'internal-tenant';

interface MembershipRow {
  tenantId: string;
  userId: string;
  role: string;
}

/**
 * Minimal in-memory Prisma double covering exactly the two delegates the guard
 * touches: `membership.findUnique` (the primary tenant-scoped lookup) and, via
 * the super-admin fallback, `tenant.findUnique` for the internal tenant.
 */
function makePrisma(opts: {
  memberships: MembershipRow[];
  internalTenantExists?: boolean;
  membershipError?: boolean;
}): PrismaClient {
  const { memberships, internalTenantExists = true, membershipError = false } = opts;
  return {
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        if (membershipError) return Promise.reject(new Error('db_down'));
        const { tenantId, userId } = where.tenantId_userId;
        const row = memberships.find((m) => m.tenantId === tenantId && m.userId === userId);
        return Promise.resolve(row ? { role: row.role } : null);
      }),
    },
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) => {
        if (where.slug === 'internal') {
          return Promise.resolve(internalTenantExists ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null);
        }
        return Promise.resolve(null);
      }),
    },
  } as unknown as PrismaClient;
}

function tokenFor(userId: string, tenantId: string): string {
  return jwt.sign({ sub: userId, tid: tenantId }, TEST_SECRET);
}

/**
 * A request as the route table sees it: the session-auth middleware has already
 * resolved the caller's token against their Session row and published the
 * identity for `requireAuth` (see sessionAuth.ts). A request without that
 * resolution is unauthenticated by definition, which is what `userId: undefined`
 * models here. The cookie is kept so the guard's super-admin fallback sees the
 * same request shape it does in production.
 */
function makeReq(opts: { userId?: string; tenant?: { id: string; slug: string } | undefined }): unknown {
  const { userId, tenant } = opts;
  const cookies = userId ? { auth_token: tokenFor(userId, tenant?.id ?? 'unused') } : {};
  const req = { cookies, headers: {}, tenant };
  setAuthResolution(req as never, {
    auth: userId
      ? { userId, tenantId: tenant?.id ?? 'unused', sessionId: `sess-${userId}`, tokenHash: `hash-${userId}` }
      : null,
  });
  return req;
}

function makeRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
    headersSent: false,
  };
  return res;
}

/** Flush the fire-and-forget async task the (void-returning) guard kicks off. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('createRequireTenantAdmin', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it('allows an owner of the resolved tenant', async () => {
    const prisma = makePrisma({ memberships: [{ tenantId: 'acme', userId: 'u1', role: 'owner' }] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows an admin of the resolved tenant', async () => {
    const prisma = makePrisma({ memberships: [{ tenantId: 'acme', userId: 'u1', role: 'admin' }] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('allows the freshly-signed-up owner (WF-4a two-step checkout)', async () => {
    // POST /public/tenants creates the owner Membership BEFORE returning the
    // session token, so the immediately-following checkout call already passes.
    const prisma = makePrisma({ memberships: [{ tenantId: 'newco', userId: 'owner-1', role: 'owner' }] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'owner-1', tenant: { id: 'newco', slug: 'newco' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a plain member of the resolved tenant with 403', async () => {
    const prisma = makePrisma({ memberships: [{ tenantId: 'acme', userId: 'u1', role: 'member' }] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
  });

  it('rejects an authenticated non-member with 403', async () => {
    // No membership row at all in the resolved tenant, and not a super-admin.
    const prisma = makePrisma({ memberships: [] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'stranger', tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects cross-tenant access: owner of A spoofing X-Tenant: B gets 403', async () => {
    // The caller owns tenant A but the request resolved to tenant B (via a
    // forged X-Tenant header). No membership in B, not a super-admin -> 403.
    const prisma = makePrisma({ memberships: [{ tenantId: 'tenant-a', userId: 'u1', role: 'owner' }] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: { id: 'tenant-b', slug: 'tenant-b' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
  });

  it('allows a platform super-admin who is not a member of the resolved tenant', async () => {
    // Internal owner (super-admin) governs every tenant; the goodwill tools that
    // wrap requireTenantAdmin around an inner requireSuperAdmin rely on this.
    const prisma = makePrisma({
      memberships: [{ tenantId: INTERNAL_TENANT_ID, userId: 'root', role: 'owner' }],
    });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'root', tenant: { id: 'foreign', slug: 'foreign' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when the request carries no valid session', async () => {
    const prisma = makePrisma({ memberships: [] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: undefined, tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when no tenant context was resolved', async () => {
    const prisma = makePrisma({ memberships: [] });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: undefined });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 500 when the membership lookup throws', async () => {
    const prisma = makePrisma({ memberships: [], membershipError: true });
    const mw = createRequireTenantAdmin(prisma);
    const req = makeReq({ userId: 'u1', tenant: { id: 'acme', slug: 'acme' } });
    const res = makeRes();
    const next = vi.fn();

    mw(req as never, res as never, next as never);
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
