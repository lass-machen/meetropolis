import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  importTmjIntoMap,
  readSpawnFromProperties,
  persistSpawnFromTmj,
  readZonesFromObjectLayers,
  resolveObjectDataUrl,
} from './importMapV2.lib.js';
import type { TmjProperty, Tmj } from './importMapV2.lib.js';
import type { PrismaClient } from '../generated/prisma/index.js';

vi.mock('../api/utils/collisionReconciler.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../api/utils/collisionReconciler.js')>();
  return { ...original, reconcileCollisionTiles: vi.fn().mockResolvedValue([]) };
});

// A TMJ carrying the given top-level properties; only `properties` is read by
// persistSpawnFromTmj, so the rest is filler to satisfy the type.
function tmjWithProps(properties: TmjProperty[]): Tmj {
  return { width: 1, height: 1, tilewidth: 16, tileheight: 16, tilesets: [], layers: [], properties };
}

// Minimal Prisma stand-in that records map.update calls.
function fakePrismaWithUpdateSpy() {
  const update = vi.fn(() => Promise.resolve());
  const prisma = { map: { update } } as unknown as PrismaClient;
  return { prisma, update };
}

// ---------------------------------------------------------------------------
// readSpawnFromProperties
//
// Guards the spawn-propagation fix: the v2 importer must lift the TMJ
// top-level `spawnX` / `spawnY` custom properties (pixel coords) into
// Map.meta.spawn. These are the only spawn source the office.json ships.
// ---------------------------------------------------------------------------

describe('readSpawnFromProperties', () => {
  it('reads spawnX/spawnY as pixel coordinates', () => {
    const props: TmjProperty[] = [
      { name: 'spawnX', type: 'int', value: 384 },
      { name: 'spawnY', type: 'int', value: 560 },
    ];
    expect(readSpawnFromProperties(props)).toEqual({ x: 384, y: 560 });
  });

  it('ignores unrelated properties around the spawn ones', () => {
    const props: TmjProperty[] = [
      { name: 'author', type: 'string', value: 'meetropolis' },
      { name: 'spawnY', type: 'int', value: 12 },
      { name: 'spawnX', type: 'int', value: 34 },
    ];
    expect(readSpawnFromProperties(props)).toEqual({ x: 34, y: 12 });
  });

  it('returns undefined when either coordinate is missing', () => {
    expect(readSpawnFromProperties([{ name: 'spawnX', type: 'int', value: 100 }])).toBeUndefined();
    expect(readSpawnFromProperties([{ name: 'spawnY', type: 'int', value: 100 }])).toBeUndefined();
  });

  it('returns undefined for non-numeric coordinates', () => {
    const props: TmjProperty[] = [
      { name: 'spawnX', type: 'string', value: '384' },
      { name: 'spawnY', type: 'int', value: 560 },
    ];
    expect(readSpawnFromProperties(props)).toBeUndefined();
  });

  it('returns undefined for undefined or empty properties', () => {
    expect(readSpawnFromProperties(undefined)).toBeUndefined();
    expect(readSpawnFromProperties([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// persistSpawnFromTmj
//
// Guards the meta merge: the spawn must be written into Map.meta.spawn without
// dropping foreign meta keys, and no write must happen when there is no spawn.
// ---------------------------------------------------------------------------

describe('persistSpawnFromTmj', () => {
  const spawnProps: TmjProperty[] = [
    { name: 'spawnX', type: 'int', value: 384 },
    { name: 'spawnY', type: 'int', value: 560 },
  ];

  it('merges spawn into existing meta, preserving foreign keys', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();
    const map = { id: 'map-1', meta: { zonesVersion: 3, theme: 'dark' } };

    await persistSpawnFromTmj(prisma, map, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-1' },
      data: { meta: { zonesVersion: 3, theme: 'dark', spawn: { x: 384, y: 560 } } },
    });
  });

  it('writes spawn onto an empty meta', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();

    await persistSpawnFromTmj(prisma, { id: 'map-2', meta: {} }, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-2' },
      data: { meta: { spawn: { x: 384, y: 560 } } },
    });
  });

  it('overwrites only the spawn key on re-import, keeping the rest', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();
    const map = { id: 'map-3', meta: { spawn: { x: 1, y: 2 }, keep: 'me' } };

    await persistSpawnFromTmj(prisma, map, tmjWithProps(spawnProps));

    expect(update).toHaveBeenCalledWith({
      where: { id: 'map-3' },
      data: { meta: { spawn: { x: 384, y: 560 }, keep: 'me' } },
    });
  });

  it('does not write when the TMJ has no spawn properties', async () => {
    const { prisma, update } = fakePrismaWithUpdateSpy();

    await persistSpawnFromTmj(prisma, { id: 'map-4', meta: { theme: 'dark' } }, tmjWithProps([]));

    expect(update).not.toHaveBeenCalled();
  });
});

describe('readZonesFromObjectLayers', () => {
  it('converts relative polygon points and carries capacity', () => {
    const zones = readZonesFromObjectLayers([
      {
        name: 'Zones',
        type: 'objectgroup',
        objects: [
          {
            name: 'Besprechung',
            type: 'zone',
            x: 100,
            y: 50,
            width: 0,
            height: 0,
            polygon: [
              { x: 0, y: 0 },
              { x: 80, y: 0 },
              { x: 80, y: 64 },
              { x: 0, y: 64 },
            ],
            properties: [{ name: 'capacity', type: 'int', value: 4 }],
          },
        ],
      },
    ]);

    expect(zones).toEqual([
      {
        name: 'Besprechung',
        capacity: 4,
        polygon: [
          { x: 100, y: 50 },
          { x: 180, y: 50 },
          { x: 180, y: 114 },
          { x: 100, y: 114 },
        ],
      },
    ]);
  });

  it('ignores non-zone point objects', () => {
    expect(
      readZonesFromObjectLayers([
        {
          name: 'Points',
          type: 'objectgroup',
          objects: [{ name: 'spawn', type: 'spawn', x: 8, y: 8, width: 0, height: 0 }],
        },
      ]),
    ).toEqual([]);
  });
});

describe('resolveObjectDataUrl', () => {
  it('uses the referenced tileset image for product-pack objects', () => {
    expect(
      resolveObjectDataUrl(
        { name: 'Desk', type: 'objects', gid: 7, x: 0, y: 32, width: 48, height: 32 },
        [
          { firstgid: 1, name: 'floor', image: '/assets/floor.png', tilewidth: 16, tileheight: 16, tilecount: 4 },
          {
            firstgid: 7,
            name: 'atelier-desk',
            image: '/assets/atelier/v1/holz/compact_desk.hash.png',
            tilewidth: 48,
            tileheight: 32,
            tilecount: 1,
          },
        ],
        'atelier_v1_holz_compact_desk',
      ),
    ).toBe('/assets/atelier/v1/holz/compact_desk.hash.png');
  });
});

async function withTmjFile(tmj: Tmj, work: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meetropolis-import-'));
  const file = path.join(directory, 'map.tmj');
  try {
    await writeFile(file, JSON.stringify(tmj));
    await work(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('importTmjIntoMap layer policy and atomicity', () => {
  it.each(['collision_manual', 'walls_auto'])(
    'rejects reserved layer %s before opening a transaction',
    async (name) => {
      const transaction = vi.fn();
      const prisma = { $transaction: transaction } as unknown as PrismaClient;
      const tmj: Tmj = {
        width: 1,
        height: 1,
        tilewidth: 16,
        tileheight: 16,
        tilesets: [],
        layers: [{ name, type: 'tilelayer', data: [1] }],
      };

      await withTmjFile(tmj, async (file) => {
        await expect(importTmjIntoMap(prisma, 'tenant-one', 'office', file)).rejects.toThrow(
          `reserved_import_layer:${name}`,
        );
      });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('stores public collision as collision_manual inside one transaction', async () => {
    const createdLayerNames: string[] = [];
    const tx = {
      map: { upsert: vi.fn().mockResolvedValue({ id: 'map-one', meta: {} }) },
      mapTileset: { deleteMany: vi.fn(), create: vi.fn() },
      mapLayer: {
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn(),
        create: vi.fn(({ data }: { data: { name: string } }) => {
          createdLayerNames.push(data.name);
          return { id: `layer-${data.name}` };
        }),
      },
      mapChunk: { deleteMany: vi.fn(), create: vi.fn() },
      mapObject: { deleteMany: vi.fn(), create: vi.fn() },
      zone: { deleteMany: vi.fn(), create: vi.fn() },
      room: { findFirst: vi.fn(), upsert: vi.fn() },
      assetPack: { findUnique: vi.fn() },
    };
    const transaction = vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const tmj: Tmj = {
      width: 1,
      height: 1,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [],
      layers: [{ name: 'collision', type: 'tilelayer', data: [1] }],
    };

    await withTmjFile(tmj, async (file) => {
      await importTmjIntoMap(prisma, 'tenant-one', 'office', file);
    });

    expect(transaction).toHaveBeenCalledOnce();
    expect(createdLayerNames).toContain('collision_manual');
    expect(createdLayerNames).not.toContain('collision');
  });

  it('preserves the previous state when a replace step fails', async () => {
    const state = { mapName: 'existing', layers: ['old-layer'] };
    const transaction = vi.fn(async (work: (client: unknown) => Promise<unknown>) => {
      const pending = { mapName: state.mapName, layers: [...state.layers] };
      const tx = {
        map: {
          upsert: vi.fn(() => {
            pending.mapName = 'replacement';
            return { id: 'map-one', meta: {} };
          }),
        },
        mapTileset: { deleteMany: vi.fn(() => Promise.reject(new Error('tileset write failed'))) },
      };
      const result = await work(tx);
      state.mapName = pending.mapName;
      state.layers = pending.layers;
      return result;
    });
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const tmj: Tmj = { width: 1, height: 1, tilewidth: 16, tileheight: 16, tilesets: [], layers: [] };

    await withTmjFile(tmj, async (file) => {
      await expect(importTmjIntoMap(prisma, 'tenant-one', 'office', file)).rejects.toThrow('tileset write failed');
    });

    expect(state).toEqual({ mapName: 'existing', layers: ['old-layer'] });
    expect(transaction).toHaveBeenCalledOnce();
  });
});
