/**
 * Cross-tenant disclosure guard for GET /tenant (A10a).
 *
 * Tenant resolution (tenancy.ts) lets the client-supplied X-Tenant header win
 * over the session JWT, so an authenticated user can force req.tenant onto ANY
 * tenant. Without a membership check GET /tenant then hands a foreign tenant's
 * metadata (name, slug, concurrentLimit, freeSeats, memberCount,
 * publicRegistrationEnabled) to that user. These tests exercise the REAL guard
 * chain — requireAuth (via a seeded auth resolution), getTenantFromReq (via
 * req.tenant) and requireMembership (via a Prisma double) — not mocks of it.
 */
import { describe, it, expect, vi } from 'vitest';
import type express from 'express';
import { handleGetTenant } from './tenant.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/** A request already resolved (by tenantMiddleware) to `tenant`, optionally authenticated as `userId`. */
function fakeReq(tenant: Partial<Tenant> | null, userId?: string): express.Request {
  const req = { headers: {}, query: {} } as unknown as express.Request;
  if (tenant) (req as unknown as { tenant: Partial<Tenant> }).tenant = tenant;
  if (userId) {
    setAuthResolution(req, { auth: { userId, sessionId: 'sess-1', tokenHash: 'hash-1' } });
  }
  return req;
}

function fakeRes(): express.Response {
  const res = {} as express.Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

interface FakePrisma {
  membership: { findUnique: ReturnType<typeof vi.fn> };
  tenant: { findUnique: ReturnType<typeof vi.fn> };
}

function fakePrisma(overrides: Partial<FakePrisma> = {}): { prisma: PrismaClient; db: FakePrisma } {
  const db: FakePrisma = {
    membership: { findUnique: vi.fn().mockResolvedValue(null) },
    tenant: { findUnique: vi.fn().mockResolvedValue(null) },
    ...overrides,
  };
  return { prisma: db as unknown as PrismaClient, db };
}

const FOREIGN_TENANT = { id: 't-default', slug: 'default', name: 'Default' };

describe('handleGetTenant: cross-tenant membership gate (A10a)', () => {
  it('returns 401 when the session-auth middleware never resolved an identity', async () => {
    const { prisma } = fakePrisma();
    const req = fakeReq(FOREIGN_TENANT); // no auth resolution seeded
    const res = fakeRes();

    await handleGetTenant(req, res, prisma);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when no tenant resolved for the request', async () => {
    const { prisma } = fakePrisma();
    const req = fakeReq(null, 'user-1');
    const res = fakeRes();

    await handleGetTenant(req, res, prisma);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tenant_required' });
  });

  it('returns a generic 403 (no metadata) for a foreign tenant the caller is not a member of', async () => {
    // Attacker: valid session for lobster-hq, X-Tenant forced req.tenant to `default`,
    // but no Membership row ties them to `default`.
    const { prisma, db } = fakePrisma();
    db.membership.findUnique.mockResolvedValue(null);
    const req = fakeReq(FOREIGN_TENANT, 'lobster-owner');
    const res = fakeRes();

    await handleGetTenant(req, res, prisma);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    // The disclosure query never runs.
    expect(db.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('returns the metadata for a tenant the caller IS a member of', async () => {
    const { prisma, db } = fakePrisma();
    db.membership.findUnique.mockResolvedValue({ role: 'member' });
    db.tenant.findUnique.mockResolvedValue({
      id: 't-default',
      slug: 'default',
      name: 'Default',
      concurrentLimit: 50,
      freeSeats: 5,
      bypassLimits: false,
      isInternal: false,
      defaultMapName: 'world',
      publicRegistrationEnabled: true,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      _count: { memberships: 3 },
    });
    const req = fakeReq(FOREIGN_TENANT, 'default-member');
    const res = fakeRes();

    await handleGetTenant(req, res, prisma);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ slug: 'default', memberCount: 3 }));
    // Membership was checked against the RESOLVED tenant.
    expect(db.membership.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_userId: { tenantId: 't-default', userId: 'default-member' } } }),
    );
  });
});
