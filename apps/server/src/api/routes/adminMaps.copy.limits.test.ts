/**
 * Footprint limits for the template copy behind POST /admin/maps/:id/copy.
 *
 * `copyObjects` validates every source object with `assertObjectFootprints`
 * before writing the first row, using the tile size the copy inherits from
 * the original map. A violation throws inside the surrounding transaction,
 * so no object row is written.
 *
 * On top of that, the colliding source objects share one `MapCollisionBudget`
 * (the new map is empty, so the budget starts empty): their summed full-area
 * tiles must stay within 65536, otherwise the copy throws before any row is
 * written and the handler answers 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenancy = vi.hoisted(() => ({ enabled: false, resolver: vi.fn() }));

vi.mock('../../tenancyLoader.js', () => ({
  getTenancyModule: () =>
    Promise.resolve(
      tenancy.enabled
        ? { version: 1, isMultiTenantEnabled: () => true, resolvePackVisibility: tenancy.resolver }
        : { version: 1, isMultiTenantEnabled: () => false },
    ),
}));

import { copyMapToTenant } from './adminMaps.copy.js';
import { registerAdminMapRoutes } from './adminMaps.js';
import { MapObjectFootprintRejectedError } from '../utils/mapObjectWriteLimits.js';
import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';

vi.mock('../utils/authHelpers.js', () => ({
  requireSuperAdmin: vi.fn(() => Promise.resolve({ userId: 'admin' })),
}));

const SOURCE_MAP_ID = 'map-source';
const TARGET_TENANT_ID = 'tenant-target';

function sourceObject(width: number, height: number, collide = false) {
  return {
    id: 7,
    mapId: SOURCE_MAP_ID,
    assetPackUuid: 'pixel-agents-furniture',
    itemId: 'wardrobe',
    category: 'objects',
    tileX: 0,
    tileY: 0,
    chunkX: 0,
    chunkY: 0,
    width,
    height,
    collide,
    zIndex: 0,
    rotation: 0,
    flipX: false,
    flipY: false,
    scaleFactor: 1,
    dataUrl: 'data:image/png;base64,AAAA',
    collisionBaseHeight: 0,
    renderLayer: 'sorted',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

function makePrisma(objects: Array<ReturnType<typeof sourceObject>>) {
  const mapObjectCreate = vi.fn(() => Promise.resolve({ id: 99 }));
  const mapCreate = vi.fn(() => Promise.resolve({ id: 'map-copy', name: 'office' }));
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    map: {
      findUnique: vi.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(
          where.id === SOURCE_MAP_ID
            ? {
                id: SOURCE_MAP_ID,
                name: 'office',
                width: 64,
                height: 64,
                tileWidth: 16,
                tileHeight: 16,
                chunkSize: 32,
                nextAutotileSlot: 1,
                meta: {},
                tilesets: [],
                autotiles: [],
                layers: [],
                objects,
                rooms: [],
              }
            : null,
        ),
      ),
      create: mapCreate,
    },
    mapTileset: { create: vi.fn(() => Promise.resolve({})) },
    mapAutotile: { create: vi.fn(() => Promise.resolve({})) },
    mapLayer: { create: vi.fn(() => Promise.resolve({ id: 'layer-copy' })) },
    mapChunk: { create: vi.fn(() => Promise.resolve({})) },
    mapObject: { create: mapObjectCreate },
    room: { create: vi.fn(() => Promise.resolve({ id: 'room-copy' })) },
    zone: { create: vi.fn(() => Promise.resolve({})) },
    assetPack: {
      findMany: vi.fn(() => Promise.resolve([{ uuid: 'pixel-agents-furniture' }])),
    },
  };
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { prisma, mapObjectCreate };
}

beforeEach(() => {
  tenancy.enabled = false;
  tenancy.resolver.mockReset();
});

describe('copyMapToTenant — object footprint limits', () => {
  it('copies a 1024 x 1024 object on a 16 px tile map (64 x 64 = 4096 tiles)', async () => {
    const { prisma, mapObjectCreate } = makePrisma([sourceObject(1024, 1024)]);
    await expect(copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office')).resolves.toMatchObject({
      id: 'map-copy',
    });
    expect(mapObjectCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects a 1040 x 1024 object among several before writing any object', async () => {
    const { prisma, mapObjectCreate } = makePrisma([sourceObject(3, 2), sourceObject(1040, 1024)]);
    const copy = copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    await expect(copy).rejects.toEqual(
      expect.objectContaining<MapObjectFootprintRejectedError>({
        name: 'MapObjectFootprintRejectedError',
        code: 'object_footprint_too_large',
      }),
    );
    expect(mapObjectCreate).not.toHaveBeenCalled();
  });

  it('copies 16 colliding 1024 x 1024 objects (16 x 4096 = 65536 tiles)', async () => {
    const objects = Array.from({ length: 16 }, () => sourceObject(1024, 1024, true));
    const { prisma, mapObjectCreate } = makePrisma(objects);
    await expect(copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office')).resolves.toMatchObject({
      id: 'map-copy',
    });
    expect(mapObjectCreate).toHaveBeenCalledTimes(16);
  });

  it('rejects a 17th colliding object before writing any object', async () => {
    const objects = [...Array.from({ length: 16 }, () => sourceObject(1024, 1024, true)), sourceObject(16, 16, true)];
    const { prisma, mapObjectCreate } = makePrisma(objects);
    const copy = copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office');
    await expect(copy).rejects.toEqual(
      expect.objectContaining<MapObjectFootprintRejectedError>({
        name: 'MapObjectFootprintRejectedError',
        code: 'map_collision_footprint_too_large',
      }),
    );
    expect(mapObjectCreate).not.toHaveBeenCalled();
  });

  it('ignores non-colliding objects for the collision budget', async () => {
    const objects = [...Array.from({ length: 16 }, () => sourceObject(1024, 1024, true)), sourceObject(1024, 1024)];
    const { prisma, mapObjectCreate } = makePrisma(objects);
    await expect(copyMapToTenant(prisma, SOURCE_MAP_ID, TARGET_TENANT_ID, 'office')).resolves.toMatchObject({
      id: 'map-copy',
    });
    expect(mapObjectCreate).toHaveBeenCalledTimes(17);
  });

  it('answers 400 map_collision_footprint_too_large through the copy handler', async () => {
    const objects = [...Array.from({ length: 16 }, () => sourceObject(1024, 1024, true)), sourceObject(16, 16, true)];
    const { prisma, mapObjectCreate } = makePrisma(objects);
    (prisma as unknown as { tenant: unknown }).tenant = {
      findUnique: vi.fn(() => Promise.resolve({ id: TARGET_TENANT_ID })),
    };
    const app = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    registerAdminMapRoutes(app as unknown as express.Application, prisma);
    const copyCall = app.post.mock.calls.find((call) => call[0] === '/admin/maps/:id/copy');
    const handler = copyCall?.[1] as (req: express.Request, res: express.Response) => Promise<void>;
    const req = {
      params: { id: SOURCE_MAP_ID },
      body: { targetTenantId: TARGET_TENANT_ID, newName: 'office' },
    } as unknown as express.Request;
    const res = {
      status: vi.fn(),
      json: vi.fn(),
    } as unknown as express.Response;
    (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
    (res.json as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'map_collision_footprint_too_large' });
    expect(mapObjectCreate).not.toHaveBeenCalled();
  });
});
