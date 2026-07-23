/**
 * Cross-tenant read guard for the tenant-scoped map endpoints (A10b + siblings).
 *
 * Tenant resolution (tenancy.ts) lets the client-supplied X-Tenant header win
 * over the session JWT, so an authenticated user can force req.tenant onto ANY
 * tenant. handleListMaps additionally had NO auth at all. Every read handler in
 * maps.read.ts (maps list, state-v2, chunks, zones) now runs through the shared
 * resolveMemberTenant gate; these tests exercise the REAL guard chain
 * (requireAuth via a seeded auth resolution, getTenantFromReq via req.tenant,
 * requireMembership via a Prisma double) rather than mocking it.
 */
import { describe, it, expect, vi } from 'vitest';
import type express from 'express';
import { handleListMaps, handleStateV2, handleChunksFetch, handleListZonesForTenant } from './maps.read.js';
import { setAuthResolution } from '../utils/authState.js';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function fakeReq(
  tenant: Partial<Tenant> | null,
  userId?: string,
  extra?: { params?: Record<string, string>; query?: Record<string, string> },
): express.Request {
  const req = {
    headers: {},
    params: extra?.params ?? { id: 'm1' },
    query: extra?.query ?? {},
  } as unknown as express.Request;
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
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

interface FakeDb {
  membership: { findUnique: ReturnType<typeof vi.fn> };
  map: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  mapTileset: { findMany: ReturnType<typeof vi.fn> };
  mapLayer: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  zone: { findMany: ReturnType<typeof vi.fn> };
}

function fakePrisma(member: boolean): { prisma: PrismaClient; db: FakeDb } {
  const db: FakeDb = {
    membership: { findUnique: vi.fn().mockResolvedValue(member ? { role: 'member' } : null) },
    map: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    mapTileset: { findMany: vi.fn().mockResolvedValue([]) },
    mapLayer: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    zone: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: db as unknown as PrismaClient, db };
}

const FOREIGN = { id: 't-default', slug: 'default', name: 'Default' };

/** A map fully dimensioned so handleStateV2 never triggers the auto-patch update. */
const MAP = {
  id: 'm1',
  name: 'Office',
  tenantId: 't-default',
  width: 64,
  height: 64,
  tileWidth: 16,
  tileHeight: 16,
  chunkSize: 32,
  version: 1,
};

describe('handleListMaps: auth + cross-tenant membership gate (A10b)', () => {
  it('returns 401 for an unauthenticated caller (previously had no auth at all)', async () => {
    const { prisma } = fakePrisma(false);
    const req = fakeReq(FOREIGN); // no auth resolution seeded
    const res = fakeRes();

    await handleListMaps(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when no tenant resolved', async () => {
    const { prisma } = fakePrisma(true);
    const req = fakeReq(null, 'user-1');
    const res = fakeRes();

    await handleListMaps(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'tenant_required' });
  });

  it('returns a generic 403 for a foreign tenant and never queries its maps', async () => {
    const { prisma, db } = fakePrisma(false);
    const req = fakeReq(FOREIGN, 'lobster-owner');
    const res = fakeRes();

    await handleListMaps(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(db.map.findMany).not.toHaveBeenCalled();
  });

  it('lists the maps for a tenant the caller is a member of', async () => {
    const { prisma, db } = fakePrisma(true);
    db.map.findMany.mockResolvedValue([{ id: 'm1', name: 'Office', tenantId: 't-default' }]);
    const req = fakeReq(FOREIGN, 'default-member');
    const res = fakeRes();

    await handleListMaps(prisma, req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(db.map.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't-default' } }));
    expect(res.json).toHaveBeenCalledWith([{ id: 'm1', name: 'Office', tenantId: 't-default' }]);
  });
});

describe('handleStateV2: auth + cross-tenant membership gate', () => {
  it('returns 401 for an unauthenticated caller and never reads the map', async () => {
    const { prisma, db } = fakePrisma(false);
    const req = fakeReq(FOREIGN); // no auth resolution seeded
    const res = fakeRes();

    await handleStateV2(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.map.findFirst).not.toHaveBeenCalled();
  });

  it('returns a generic 403 for a foreign tenant and never reads the map', async () => {
    const { prisma, db } = fakePrisma(false);
    const req = fakeReq(FOREIGN, 'lobster-owner');
    const res = fakeRes();

    await handleStateV2(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(db.map.findFirst).not.toHaveBeenCalled();
  });

  it('returns the map state for a tenant the caller is a member of', async () => {
    const { prisma, db } = fakePrisma(true);
    db.map.findFirst.mockResolvedValue(MAP);
    const req = fakeReq(FOREIGN, 'default-member');
    const res = fakeRes();

    await handleStateV2(prisma, req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(db.map.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', tenantId: 't-default' } }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ mapMeta: expect.objectContaining({ width: 64, height: 64 }) }),
    );
  });
});

describe('handleChunksFetch: auth + cross-tenant membership gate', () => {
  const chunkReq = (userId?: string): express.Request =>
    fakeReq(FOREIGN, userId, { params: { id: 'm1' }, query: { layer: 'ground', keys: '0:0' } });

  it('returns 401 for an unauthenticated caller and never reads the map', async () => {
    const { prisma, db } = fakePrisma(false);
    const res = fakeRes();

    await handleChunksFetch(prisma, chunkReq(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.map.findFirst).not.toHaveBeenCalled();
  });

  it('returns a generic 403 for a foreign tenant and never reads the map', async () => {
    const { prisma, db } = fakePrisma(false);
    const res = fakeRes();

    await handleChunksFetch(prisma, chunkReq('lobster-owner'), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(db.map.findFirst).not.toHaveBeenCalled();
  });

  it('returns chunks for a tenant the caller is a member of', async () => {
    const { prisma, db } = fakePrisma(true);
    db.map.findFirst.mockResolvedValue(MAP); // layer.findUnique -> null yields an empty chunk set
    const res = fakeRes();

    await handleChunksFetch(prisma, chunkReq('default-member'), res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ chunks: {} });
  });
});

describe('handleListZonesForTenant: auth + cross-tenant membership gate', () => {
  it('returns 401 for an unauthenticated caller and never reads zones', async () => {
    const { prisma, db } = fakePrisma(false);
    const req = fakeReq(FOREIGN);
    const res = fakeRes();

    await handleListZonesForTenant(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(db.zone.findMany).not.toHaveBeenCalled();
  });

  it('returns a generic 403 for a foreign tenant and never reads zones', async () => {
    const { prisma, db } = fakePrisma(false);
    const req = fakeReq(FOREIGN, 'lobster-owner');
    const res = fakeRes();

    await handleListZonesForTenant(prisma, req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(db.zone.findMany).not.toHaveBeenCalled();
  });

  it('lists the zones for a tenant the caller is a member of', async () => {
    const { prisma, db } = fakePrisma(true);
    db.zone.findMany.mockResolvedValue([{ id: 'z1', tenantId: 't-default' }]);
    const req = fakeReq(FOREIGN, 'default-member');
    const res = fakeRes();

    await handleListZonesForTenant(prisma, req, res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(db.zone.findMany).toHaveBeenCalledWith({ where: { tenantId: 't-default' } });
    expect(res.json).toHaveBeenCalledWith([{ id: 'z1', tenantId: 't-default' }]);
  });
});
