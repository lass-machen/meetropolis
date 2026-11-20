import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { importTmjIntoMap, type Tmj } from './importMapV2.lib.js';
import { MapObjectFootprintRejectedError } from '../api/utils/mapObjectWriteLimits.js';
import type { PrismaClient } from '../generated/prisma/index.js';

vi.mock('../api/utils/collisionReconciler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/utils/collisionReconciler.js')>();
  return { ...original, reconcileCollisionTiles: vi.fn().mockResolvedValue([]) };
});

function tmjWithObject(width: number, height: number): Tmj {
  return {
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [],
    layers: [
      {
        name: 'objects',
        type: 'objectgroup',
        objects: [{ name: 'Box', gid: 1, x: 0, y: height, width, height }],
      },
    ],
  };
}

function fakeImportTx() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    map: {
      findUnique: vi.fn().mockResolvedValue({ id: 'map-one' }),
      upsert: vi.fn().mockResolvedValue({ id: 'map-one', meta: {} }),
    },
    mapTileset: { deleteMany: vi.fn(), create: vi.fn() },
    mapLayer: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(),
      create: vi.fn(({ data }: { data: { name: string } }) => ({ id: `layer-${data.name}` })),
    },
    mapChunk: { deleteMany: vi.fn(), create: vi.fn() },
    mapObject: { deleteMany: vi.fn(), create: vi.fn() },
    zone: { deleteMany: vi.fn(), create: vi.fn() },
    room: { upsert: vi.fn() },
    assetPack: { findUnique: vi.fn() },
  };
  const transaction = vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { tx, prisma };
}

async function withTmjFile(tmj: Tmj, work: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meetropolis-import-limits-'));
  const file = path.join(directory, 'map.tmj');
  try {
    await writeFile(file, JSON.stringify(tmj));
    await work(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function tmjWithBudgetObjects(colliding: number, extra?: { width: number; height: number; collide: boolean }): Tmj {
  const objects: Tmj['layers'][number]['objects'] = Array.from({ length: colliding }, (_, index) => ({
    name: `Crate${index}`,
    gid: 1,
    x: 0,
    y: 1024,
    width: 1024,
    height: 1024,
    properties: [{ name: 'collide', type: 'bool', value: true }],
  }));
  if (extra) {
    objects.push({
      name: 'Extra',
      gid: 1,
      x: 0,
      y: extra.height,
      width: extra.width,
      height: extra.height,
      ...(extra.collide ? { properties: [{ name: 'collide', type: 'bool', value: true }] } : {}),
    });
  }
  return {
    width: 2,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [],
    layers: [{ name: 'objects', type: 'objectgroup', objects }],
  };
}

describe('importTmjIntoMap object footprint limit', () => {
  it('imports a 1024x1024 px object at 16 px tiles (4096 tiles)', async () => {
    const { tx, prisma } = fakeImportTx();

    await withTmjFile(tmjWithObject(1024, 1024), async (file) => {
      await importTmjIntoMap(prisma, 'tenant-one', 'office', file);
    });

    expect(tx.mapObject.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a 1040x1024 px object (4160 tiles) without writing it', async () => {
    const { tx, prisma } = fakeImportTx();

    await withTmjFile(tmjWithObject(1040, 1024), async (file) => {
      const cause = await importTmjIntoMap(prisma, 'tenant-one', 'office', file).then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(cause).toBeInstanceOf(MapObjectFootprintRejectedError);
      expect((cause as MapObjectFootprintRejectedError).code).toBe('object_footprint_too_large');
    });
    expect(tx.mapObject.create).not.toHaveBeenCalled();
  });
});

describe('importTmjIntoMap map collision budget', () => {
  it('imports 16 colliding 1024x1024 px objects (65536 tiles)', async () => {
    const { tx, prisma } = fakeImportTx();

    await withTmjFile(tmjWithBudgetObjects(16), async (file) => {
      await importTmjIntoMap(prisma, 'tenant-one', 'office', file);
    });

    expect(tx.mapObject.create).toHaveBeenCalledTimes(16);
  });

  it('rejects a 17th colliding object without writing it', async () => {
    const { tx, prisma } = fakeImportTx();

    await withTmjFile(tmjWithBudgetObjects(17), async (file) => {
      const cause = await importTmjIntoMap(prisma, 'tenant-one', 'office', file).then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(cause).toBeInstanceOf(MapObjectFootprintRejectedError);
      expect((cause as MapObjectFootprintRejectedError).code).toBe('map_collision_footprint_too_large');
    });
    expect(tx.mapObject.create).toHaveBeenCalledTimes(16);
  });

  it('imports a non-colliding 17th object on a full map', async () => {
    const { tx, prisma } = fakeImportTx();

    await withTmjFile(tmjWithBudgetObjects(16, { width: 16, height: 16, collide: false }), async (file) => {
      await importTmjIntoMap(prisma, 'tenant-one', 'office', file);
    });

    expect(tx.mapObject.create).toHaveBeenCalledTimes(17);
  });
});
