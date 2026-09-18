/**
 * Enterprise pack visibility must enter both collection routes through the
 * shared PackScope. The optional loader hook has three distinct outcomes:
 * absent keeps the OSS global catalogue, [] authoritatively grants no global
 * packs, and returned UUIDs add only those global packs to tenant-owned ones.
 */
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';

const tenancyMocks = vi.hoisted(() => ({
  enabled: false,
  resolveAdditionalPackUuids: vi.fn(),
}));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancyMocks.enabled
        ? {
            version: 1,
            isMultiTenantEnabled: () => true,
            resolveAdditionalPackUuids: tenancyMocks.resolveAdditionalPackUuids,
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

const TEST_SECRET = 'enterprise-pack-list-test-secret';
const TENANT_ID = 'tenant-lm';
const INTERNAL_TENANT_ID = 'internal-tenant';
const USER_ID = 'lm-user';

interface PackRow {
  id: number;
  uuid: string;
  tenantId: string | null;
  archived?: boolean;
}

interface PackWhere {
  tenantId?: string | null;
  uuid?: { in: string[] };
  archived?: boolean;
  OR?: PackWhere[];
}

const ASSET_PACKS: PackRow[] = [
  { id: 1, uuid: 'global-assets', tenantId: null, archived: false },
  { id: 2, uuid: 'own-assets', tenantId: TENANT_ID, archived: false },
  { id: 3, uuid: 'foreign-assets', tenantId: 'tenant-other', archived: false },
];

const AVATAR_PACKS: PackRow[] = [
  { id: 11, uuid: 'global-avatars', tenantId: null },
  { id: 12, uuid: 'own-avatars', tenantId: TENANT_ID },
  { id: 13, uuid: 'foreign-avatars', tenantId: 'tenant-other' },
];

function matchesWhere(row: PackRow, where: PackWhere): boolean {
  if (where.archived !== undefined && row.archived !== where.archived) return false;
  if (where.uuid && !where.uuid.in.includes(row.uuid)) return false;
  if (where.OR && !where.OR.some((clause) => matchesWhere(row, clause))) return false;
  if (where.tenantId !== undefined && row.tenantId !== where.tenantId) return false;
  return true;
}

const sessions = new Map<string, string>();

function makePrisma(): PrismaClient {
  return {
    session: {
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
    tenant: {
      findUnique: vi.fn(({ where }: { where: { slug?: string } }) =>
        Promise.resolve(where.slug === 'internal' ? { id: INTERNAL_TENANT_ID, slug: 'internal' } : null),
      ),
    },
    membership: {
      findUnique: vi.fn(({ where }: { where: { tenantId_userId: { tenantId: string; userId: string } } }) => {
        const { tenantId, userId } = where.tenantId_userId;
        return Promise.resolve(tenantId === TENANT_ID && userId === USER_ID ? { role: 'member' } : null);
      }),
    },
    assetPack: {
      findMany: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(ASSET_PACKS.filter((row) => matchesWhere(row, where))),
      ),
    },
    avatarPack: {
      findMany: vi.fn(({ where }: { where: PackWhere }) =>
        Promise.resolve(AVATAR_PACKS.filter((row) => matchesWhere(row, where))),
      ),
    },
  } as unknown as PrismaClient;
}

function tenantMiddleware(req: express.Request, _res: express.Response, next: express.NextFunction): void {
  (req as unknown as { tenant: Partial<Tenant> }).tenant = {
    id: TENANT_ID,
    slug: 'lass-machen',
    name: 'Lass Machen',
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
  tenancyMocks.resolveAdditionalPackUuids.mockReset();
  sessions.clear();
});

afterEach(() => {
  process.env = originalEnv;
  vi.clearAllMocks();
});

describe('enterprise pack list visibility', () => {
  it('preserves own plus global packs when the optional resolver is absent', async () => {
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([1, 2]);
    expect(idsOf(avatars.body)).toEqual([11, 12]);
    expect(tenancyMocks.resolveAdditionalPackUuids).not.toHaveBeenCalled();
  });

  it('hides every global pack when the resolver returns an empty set', async () => {
    tenancyMocks.enabled = true;
    tenancyMocks.resolveAdditionalPackUuids.mockResolvedValue([]);
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([2]);
    expect(idsOf(avatars.body)).toEqual([12]);
    expect(tenancyMocks.resolveAdditionalPackUuids).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, packKind: 'asset', at: expect.any(Date) }),
    );
    expect(tenancyMocks.resolveAdditionalPackUuids).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tenantId: TENANT_ID, packKind: 'avatar', at: expect.any(Date) }),
    );
  });

  it('adds only the global UUIDs returned for each pack kind', async () => {
    tenancyMocks.enabled = true;
    tenancyMocks.resolveAdditionalPackUuids.mockImplementation(
      (_prisma: PrismaClient, input: { packKind: 'asset' | 'avatar' }) =>
        Promise.resolve(input.packKind === 'asset' ? ['global-assets'] : ['global-avatars']),
    );
    const app = makeApp(makePrisma());
    const auth = bearer();
    const [assets, avatars] = await Promise.all([
      request(app).get('/asset-packs').set('Authorization', auth),
      request(app).get('/avatar-packs').set('Authorization', auth),
    ]);

    expect(idsOf(assets.body)).toEqual([1, 2]);
    expect(idsOf(avatars.body)).toEqual([11, 12]);
  });
});
