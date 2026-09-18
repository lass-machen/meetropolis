/**
 * Enterprise pack visibility must enter both collection routes through the
 * shared PackScope. Uncatalogued globals are base equipment; catalogue rows
 * become merchandise and require publication or a tenant grant.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../generated/prisma/index.js';

const tenancyMocks = vi.hoisted(() => ({
  enabled: false,
  resolvePackVisibility: vi.fn(),
}));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancyMocks.enabled
        ? {
            version: 1,
            isMultiTenantEnabled: () => true,
            resolvePackVisibility: tenancyMocks.resolvePackVisibility,
          }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

vi.mock('../../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { registerAssetPackRoutes } from './assetPacks.js';
import { registerAvatarPackRoutes } from './avatarPacks.js';
import { createSessionAuthMiddleware, hashSessionToken } from '../utils/sessionAuth.js';
import {
  ENTERPRISE_PACK_RESOLVER_STATES,
  type EnterprisePackResolverState,
} from '../../testUtils/enterprisePackResolverStates.js';

const TEST_SECRET = 'enterprise-pack-list-test-secret';
const TENANT_ID = 'tenant-lm';
const INTERNAL_TENANT_ID = 'internal-tenant';
const USER_ID = 'lm-user';

function configureResolver(state: EnterprisePackResolverState): void {
  tenancyMocks.enabled = state.hook !== 'absent';
  if (state.hook === 'reject') {
    tenancyMocks.resolvePackVisibility.mockRejectedValue(new Error('catalogue unavailable'));
  } else if (state.hook === 'resolve') {
    tenancyMocks.resolvePackVisibility.mockResolvedValue(state.result?.(['catalog-assets', 'catalog-avatars']));
  }
}

interface PackRow {
  id: number;
  uuid: string;
  tenantId: string | null;
  archived?: boolean;
}

interface PackWhere {
  id?: number;
  tenantId?: string | null;
  uuid?: string | { in?: string[]; notIn?: string[] };
  archived?: boolean;
  OR?: PackWhere[];
  AND?: PackWhere[];
}

const ASSET_PACKS: PackRow[] = [
  { id: 1, uuid: 'base-assets', tenantId: null, archived: false },
  { id: 2, uuid: 'own-assets', tenantId: TENANT_ID, archived: false },
  { id: 3, uuid: 'foreign-assets', tenantId: 'tenant-other', archived: false },
  { id: 4, uuid: 'catalog-assets', tenantId: null, archived: false },
];

const AVATAR_PACKS: PackRow[] = [
  { id: 11, uuid: 'base-avatars', tenantId: null },
  { id: 12, uuid: 'own-avatars', tenantId: TENANT_ID },
  { id: 13, uuid: 'foreign-avatars', tenantId: 'tenant-other' },
  { id: 14, uuid: 'catalog-avatars', tenantId: null },
];

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.archived !== undefined && row.archived !== where.archived) return false;
  if (where.id !== undefined && row.id !== where.id) return false;
  if (typeof where.uuid === 'string' && row.uuid !== where.uuid) return false;
  if (typeof where.uuid === 'object' && where.uuid.in && !where.uuid.in.includes(row.uuid)) return false;
  if (typeof where.uuid === 'object' && where.uuid.notIn?.includes(row.uuid)) return false;
  if (where.OR && !where.OR.some((clause) => matchesWhere(row, clause))) return false;
  if (where.AND && !where.AND.every((clause) => matchesWhere(row, clause))) return false;
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
  return true;
}

const sessions = new Map<string, string>();

function makePrisma(): PrismaClient {
  const prisma = Object.create(PrismaClient.prototype) as PrismaClient;
  Object.defineProperties(prisma, {
    session: {
      value: {
        findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) => {
          const userId = sessions.get(where.tokenHash);
          return Promise.resolve(
            userId
              ? {
                  id: `session-${userId}`,
                  userId,
                  expiresAt: new Date(Date.now() + 60_000),
                  lastActiveAt: new Date(),
                }
              : null,
          );
        }),
        update: vi.fn(() => Promise.resolve({})),
      },
    },
    tenant: {
      value: {
        findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
          Promise.resolve(where.slug === 'internal' ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null),
        ),
      },
    },
    membership: {
      value: {
        findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
          const { tenantId, userId } = where.tenantId_userId;
          return Promise.resolve(tenantId === TENANT_ID && userId === USER_ID ? { role: 'member' } : null);
        }),
      },
    },
    assetPack: {
      value: {
        findMany: vi.fn(({ where }: { where: PackWhere }) =>
          Promise.resolve(ASSET_PACKS.filter((row) => matchesWhere(row, where))),
        ),
        findFirst: vi.fn(({ where }: { where: PackWhere }) =>
          Promise.resolve(ASSET_PACKS.find((row) => matchesWhere(row, where)) ?? null),
        ),
      },
    },
    avatarPack: {
      value: {
        findMany: vi.fn(({ where }: { where: PackWhere }) =>
          Promise.resolve(AVATAR_PACKS.filter((row) => matchesWhere(row, where))),
        ),
        findFirst: vi.fn(({ where }: { where: PackWhere }) =>
          Promise.resolve(AVATAR_PACKS.find((row) => matchesWhere(row, where)) ?? null),
        ),
      },
    },
  });
  return prisma;
}

function tenantMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  req.tenant = {
    id: TENANT_ID,
    slug: 'lass-machen',
    name: 'Lass Machen',
    createdAt: new Date(),
    updatedAt: new Date(),
    domain: null,
    settings: {},
    defaultMapName: 'office',
    publicRegistrationEnabled: true,
    plan: 'free',
  };
  next();
}

function makeApp(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(createSessionAuthMiddleware(prisma));
  app.use(tenantMiddleware);
  registerAssetPackRoutes(app, prisma);
  registerAvatarPackRoutes(app, prisma);
  return app;
}

function bearer(): string {
  const token = jwt.sign({ sub: USER_ID }, TEST_SECRET);
  sessions.set(hashSessionToken(token), USER_ID);
  return `Bearer ${token}`;
}

function idsOf(body: unknown): number[] {
  return (body as PackRow[]).map((pack) => pack.id).sort((a, b) => a - b);
}

const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, JWT_SECRET: TEST_SECRET };
  tenancyMocks.enabled = false;
  tenancyMocks.resolvePackVisibility.mockReset();
  sessions.clear();
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe('enterprise pack list visibility', () => {
  it.each(ENTERPRISE_PACK_RESOLVER_STATES)(
    'applies $name to both list and detail routes for every audience',
    async (state) => {
      configureResolver(state);
      const app = makeApp(makePrisma());
      const auth = bearer();
      const requests = await Promise.all([
        request(app).get('/asset-packs'),
        request(app).get('/avatar-packs'),
        request(app).get('/asset-packs/catalog-assets'),
        request(app).get('/avatar-packs/14'),
        request(app).get('/asset-packs/base-assets'),
        request(app).get('/avatar-packs/11'),
        request(app).get('/asset-packs').set('Authorization', auth),
        request(app).get('/avatar-packs').set('Authorization', auth),
        request(app).get('/asset-packs/catalog-assets').set('Authorization', auth),
        request(app).get('/avatar-packs/14').set('Authorization', auth),
        request(app).get('/asset-packs/base-assets').set('Authorization', auth),
        request(app).get('/avatar-packs/11').set('Authorization', auth),
      ]);

      if (state.expected === 'error') {
        expect(requests.map((response) => response.status)).toEqual(Array.from({ length: 12 }, () => 500));
        return;
      }

      const [publicAssets, publicAvatars, publicCatalogAsset, publicCatalogAvatar, ...rest] = requests;
      const [publicBaseAsset, publicBaseAvatar, tenantAssets, tenantAvatars, tenantCatalogAsset, tenantCatalogAvatar] =
        rest;
      const [tenantBaseAsset, tenantBaseAvatar] = rest.slice(6);
      expect(idsOf(publicAssets.body)).toEqual(state.expected === 'accessible' ? [1, 4] : [1]);
      expect(idsOf(publicAvatars.body)).toEqual(state.expected === 'accessible' ? [11, 14] : [11]);
      expect(idsOf(tenantAssets.body)).toEqual(state.expected === 'accessible' ? [1, 2, 4] : [1, 2]);
      expect(idsOf(tenantAvatars.body)).toEqual(state.expected === 'accessible' ? [11, 12, 14] : [11, 12]);
      const catalogStatus = state.expected === 'accessible' ? 200 : 404;
      expect([
        publicCatalogAsset.status,
        publicCatalogAvatar.status,
        tenantCatalogAsset.status,
        tenantCatalogAvatar.status,
      ]).toEqual([catalogStatus, catalogStatus, catalogStatus, catalogStatus]);
      expect([
        publicBaseAsset.status,
        publicBaseAvatar.status,
        tenantBaseAsset.status,
        tenantBaseAvatar.status,
      ]).toEqual([200, 200, 200, 200]);
    },
  );

  it('preserves own plus global packs when the optional resolver is absent', async () => {
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([1, 2, 4]);
    expect(idsOf(avatars.body)).toEqual([11, 12, 14]);
    expect(tenancyMocks.resolvePackVisibility).not.toHaveBeenCalled();
  });

  it('keeps uncatalogued base equipment when no catalogue pack is accessible', async () => {
    tenancyMocks.enabled = true;
    tenancyMocks.resolvePackVisibility.mockImplementation(
      (_prisma: PrismaClient, input: { packKind: 'asset' | 'avatar' }) =>
        Promise.resolve({
          catalogPackUuids: [input.packKind === 'asset' ? 'catalog-assets' : 'catalog-avatars'],
          accessiblePackUuids: [],
        }),
    );
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([1, 2]);
    expect(idsOf(avatars.body)).toEqual([11, 12]);
    expect(tenancyMocks.resolvePackVisibility).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, packKind: 'asset', at: expect.any(Date) }),
    );
    expect(tenancyMocks.resolvePackVisibility).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, packKind: 'avatar', at: expect.any(Date) }),
    );
  });

  it('adds only accessible catalogue UUIDs for each pack kind', async () => {
    tenancyMocks.enabled = true;
    tenancyMocks.resolvePackVisibility.mockImplementation(
      (_prisma: PrismaClient, input: { packKind: 'asset' | 'avatar' }) =>
        Promise.resolve({
          catalogPackUuids: [input.packKind === 'asset' ? 'catalog-assets' : 'catalog-avatars'],
          accessiblePackUuids: [input.packKind === 'asset' ? 'catalog-assets' : 'catalog-avatars'],
        }),
    );
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([1, 2, 4]);
    expect(idsOf(avatars.body)).toEqual([11, 12, 14]);
  });

  it('applies the same base-plus-published rule to anonymous list and detail reads', async () => {
    tenancyMocks.enabled = true;
    tenancyMocks.resolvePackVisibility.mockImplementation(
      (_prisma: PrismaClient, input: { packKind: 'asset' | 'avatar'; tenantId?: string }) =>
        Promise.resolve({
          catalogPackUuids: [input.packKind === 'asset' ? 'catalog-assets' : 'catalog-avatars'],
          accessiblePackUuids: input.tenantId
            ? [input.packKind === 'asset' ? 'catalog-assets' : 'catalog-avatars']
            : [],
        }),
    );
    const app = makeApp(makePrisma());
    const auth = bearer();

    const [assets, avatars, baseAsset, catalogAsset, baseAvatar, catalogAvatar, tenantAsset, tenantAvatar] =
      await Promise.all([
        request(app).get('/asset-packs'),
        request(app).get('/avatar-packs'),
        request(app).get('/asset-packs/base-assets'),
        request(app).get('/asset-packs/catalog-assets'),
        request(app).get('/avatar-packs/11'),
        request(app).get('/avatar-packs/14'),
        request(app).get('/asset-packs/catalog-assets').set('Authorization', auth),
        request(app).get('/avatar-packs/14').set('Authorization', auth),
      ]);

    expect(idsOf(assets.body)).toEqual([1]);
    expect(idsOf(avatars.body)).toEqual([11]);
    expect(baseAsset.status).toBe(200);
    expect(catalogAsset.status).toBe(404);
    expect(baseAvatar.status).toBe(200);
    expect(catalogAvatar.status).toBe(404);
    expect(tenantAsset.status).toBe(200);
    expect(tenantAvatar.status).toBe(200);
  });
});
