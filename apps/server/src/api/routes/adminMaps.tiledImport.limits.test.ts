/**
 * Footprint limits for the Tiled admin import behind POST /admin/maps/import.
 *
 * Tiled objects carry no asset pack, so the import stores none of them and
 * reports them as skipped. It still validates the stored tile size of every
 * object with `assertObjectFootprints` inside the import transaction, so a
 * violation rolls map and layers back; the handler answers 400
 * `object_footprint_too_large`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/authHelpers.js', () => ({
  requireSuperAdmin: vi.fn(() => Promise.resolve({ userId: 'admin' })),
}));

import { handleImportAdminMap } from './adminMaps.tiledImport.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

function makeTmj(objects: Array<{ width: number; height: number }>) {
  return {
    width: 32,
    height: 32,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        type: 'objectgroup',
        name: 'furniture',
        objects: objects.map((obj, index) => ({
          id: index + 1,
          name: `prop-${index + 1}`,
          x: 0,
          y: 0,
          width: obj.width,
          height: obj.height,
        })),
      },
    ],
  };
}

function makeHarness(tmj: ReturnType<typeof makeTmj>) {
  const mapObjectCreate = vi.fn(() => Promise.resolve({ id: 11 }));
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    map: { create: vi.fn(() => Promise.resolve({ id: 'map-new', name: 'imported' })) },
    mapTileset: { create: vi.fn(() => Promise.resolve({})) },
    mapLayer: { create: vi.fn(() => Promise.resolve({ id: 'layer-new' })) },
    mapChunk: { create: vi.fn(() => Promise.resolve({})) },
    mapObject: { create: mapObjectCreate },
    room: { create: vi.fn(() => Promise.resolve({ id: 'room-new' })) },
  };
  const prisma = {
    tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'tenant-1' })) },
    map: { findUnique: vi.fn(() => Promise.resolve(null)) },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaClient;
  const req = {
    body: { tenantId: 'tenant-1', name: 'imported' },
    file: { buffer: Buffer.from(JSON.stringify(tmj), 'utf-8') },
  } as unknown as Parameters<typeof handleImportAdminMap>[1];
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Parameters<typeof handleImportAdminMap>[2];
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return { prisma, req, res, mapObjectCreate };
}

describe('handleImportAdminMap — object footprint limits', () => {
  it('accepts a 16384 px object on a 16 px tile map (stored 1024 x 1024 = 4096 tiles)', async () => {
    const { prisma, req, res } = makeHarness(makeTmj([{ width: 16384, height: 16384 }]));
    await handleImportAdminMap(prisma, req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 'map-new', name: 'imported', skippedObjects: 1 });
  });

  it('answers 400 object_footprint_too_large for a 16400 px wide object without writing it', async () => {
    const { prisma, req, res, mapObjectCreate } = makeHarness(makeTmj([{ width: 16400, height: 16384 }]));
    await handleImportAdminMap(prisma, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'object_footprint_too_large' });
    expect(mapObjectCreate).not.toHaveBeenCalled();
  });
});

describe('handleImportAdminMap — objects without an asset pack', () => {
  it('stores no map objects for Tiled objects and reports how many it skipped', async () => {
    const { prisma, req, res, mapObjectCreate } = makeHarness(
      makeTmj([
        { width: 16, height: 16 },
        { width: 32, height: 32 },
      ]),
    );
    await handleImportAdminMap(prisma, req, res);
    expect(mapObjectCreate).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: 'map-new', name: 'imported', skippedObjects: 2 });
  });
});
