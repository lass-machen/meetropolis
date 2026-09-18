import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  encodeRlePairsToBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
  rleEncodeNumbers,
} from '../../mapEncoding.js';
import { setAuthResolution } from '../utils/authState.js';
import { registerMapObjectRoutes } from './mapObjects.js';
import { registerMapRoutes } from './maps.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../utils/broadcast.js', () => ({ broadcastMapUpdate: vi.fn() }));

const MAP = {
  id: 'map',
  name: 'office',
  tenantId: 'tenant',
  meta: {},
  width: 2,
  height: 2,
  tileWidth: 16,
  tileHeight: 16,
  chunkSize: 2,
  nextAutotileSlot: 1,
};
const PACK_UUID = '4664b745-6bad-4d86-ae8f-591c57567692';
const TENANT = { id: 'tenant', slug: 'tenant', name: 'Tenant' } as Tenant;

interface LayerRow {
  id: string;
  mapId: string;
  name: string;
  chunkSize: number;
}

interface ChunkRow {
  id: string;
  layerId: string;
  x: number;
  y: number;
  version: number;
  encoding: string;
  data: Uint8Array;
}

function encoded(values: number[], bool: boolean): Uint8Array {
  const pairs = bool ? rleEncodeBooleans(values.map(Boolean)) : rleEncodeNumbers(values);
  return new Uint8Array(encodeRlePairsToBuffer(pairs));
}

function createCollisionPrisma(params: {
  objects?: Array<Record<string, unknown>>;
  autotile?: { slot: number; collide: boolean };
  autotileValues?: number[];
  collisionValues?: number[];
}) {
  const layers: LayerRow[] = [];
  const chunks: ChunkRow[] = [];
  const objects = [...(params.objects ?? [])];
  const palette: Array<Record<string, unknown>> = [];
  let nextLayerId = 1;
  let nextChunkId = 1;

  const addLayer = (name: string, values?: number[], bool = false): LayerRow => {
    const layer = { id: `layer-${nextLayerId++}`, mapId: MAP.id, name, chunkSize: 2 };
    layers.push(layer);
    if (values) {
      chunks.push({
        id: `chunk-${nextChunkId++}`,
        layerId: layer.id,
        x: 0,
        y: 0,
        version: 1,
        encoding: bool ? 'rle-bool' : 'rle',
        data: encoded(values, bool),
      });
    }
    return layer;
  };
  if (params.autotileValues) addLayer('walls_auto', params.autotileValues);
  if (params.collisionValues) addLayer('collision', params.collisionValues, true);
  if (params.autotile) {
    palette.push({
      id: 'palette-existing',
      mapId: MAP.id,
      packUuid: PACK_UUID,
      autotileId: 'solid',
      key: 'Solid',
      imageUrl: '/packs/test/solid.png',
      tileWidth: 16,
      tileHeight: 16,
      gridHeight: 1,
      variants: { '0': { col: 0, row: 0 } },
      placement: 'wall',
      hash: null,
      ...params.autotile,
    });
    MAP.nextAutotileSlot = Math.max(MAP.nextAutotileSlot, params.autotile.slot + 1);
  }

  const packAutotiles = [
    {
      id: 'soft',
      key: 'Soft',
      category: 'autotile',
      dataURL: '/packs/test/soft.png',
      placement: 'wall',
      collide: false,
      tileWidth: 16,
      tileHeight: 16,
      gridHeight: 1,
      autotileType: '4bit',
      variants: { '0': { col: 0, row: 0 } },
    },
  ];

  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((work: (tx: unknown) => Promise<unknown>) => work(db)),
    tenant: { findUnique: vi.fn().mockResolvedValue(null) },
    membership: { findUnique: vi.fn().mockResolvedValue({ role: 'admin' }) },
    map: {
      findFirst: vi.fn().mockResolvedValue(MAP),
      findUnique: vi.fn().mockResolvedValue(MAP),
      update: vi.fn(({ data }: { data: { nextAutotileSlot?: number } }) => {
        if (data.nextAutotileSlot !== undefined) MAP.nextAutotileSlot = data.nextAutotileSlot;
        return MAP;
      }),
      findMany: vi.fn().mockResolvedValue([MAP]),
    },
    mapLayer: {
      findUnique: vi.fn(({ where }: { where: { mapId_name: { name: string } } }) =>
        layers.find((layer) => layer.name === where.mapId_name.name),
      ),
      findMany: vi.fn(() => layers),
      create: vi.fn(({ data }: { data: { mapId: string; name: string; chunkSize: number } }) => addLayer(data.name)),
    },
    mapChunk: {
      findMany: vi.fn(({ where }: { where: { layerId: string; OR?: Array<{ x: number; y: number }> } }) =>
        chunks.filter(
          (chunk) =>
            chunk.layerId === where.layerId &&
            (!where.OR || where.OR.some((coord) => coord.x === chunk.x && coord.y === chunk.y)),
        ),
      ),
      create: vi.fn(({ data }: { data: Omit<ChunkRow, 'id'> }) => {
        const chunk = { id: `chunk-${nextChunkId++}`, ...data };
        chunks.push(chunk);
        return chunk;
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
          const chunk = chunks.find((candidate) => candidate.id === where.id && candidate.version === where.version);
          if (!chunk) return { count: 0 };
          chunk.version += 1;
          chunk.encoding = String(data.encoding);
          chunk.data = data.data as Uint8Array;
          return { count: 1 };
        },
      ),
    },
    mapAutotile: {
      findMany: vi.fn(({ where }: { where: { collide?: boolean } }) =>
        palette.filter((entry) => where.collide === undefined || entry.collide === where.collide),
      ),
      findUnique: vi.fn(({ where }: { where: { mapId_packUuid_autotileId: { autotileId: string } } }) =>
        palette.find((entry) => entry.autotileId === where.mapId_packUuid_autotileId.autotileId),
      ),
      aggregate: vi.fn(() => ({ _max: { slot: Math.max(0, ...palette.map((entry) => Number(entry.slot))) || null } })),
      create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
        const entry = { id: `palette-${String(data.slot)}`, ...data };
        palette.push(entry);
        return entry;
      }),
    },
    mapObject: {
      findMany: vi.fn(({ where }: { where: { collide?: boolean } }) =>
        objects.filter((object) => where.collide === undefined || object.collide === where.collide),
      ),
      findFirst: vi.fn(({ where }: { where: { id: number } }) => objects.find((object) => object.id === where.id)),
      delete: vi.fn(({ where }: { where: { id: number } }) => {
        const index = objects.findIndex((object) => object.id === where.id);
        return objects.splice(index, 1)[0];
      }),
    },
    assetPack: {
      findFirst: vi.fn().mockResolvedValue({ uuid: PACK_UUID, autotiles: packAutotiles }),
      findUnique: vi.fn().mockResolvedValue({ uuid: PACK_UUID, archived: false, autotiles: packAutotiles }),
    },
    mapTileset: { findMany: vi.fn().mockResolvedValue([]) },
    zone: { findMany: vi.fn().mockResolvedValue([]) },
  };
  return { prisma: db as unknown as PrismaClient, layers, chunks };
}

function appFor(prisma: PrismaClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    setAuthResolution(req, { auth: { userId: 'admin', sessionId: 'session', tokenHash: 'hash' } });
    req.tenant = TENANT;
    next();
  });
  registerMapRoutes(app, prisma);
  registerMapObjectRoutes(app, prisma);
  return app;
}

function collisionCell(state: ReturnType<typeof createCollisionPrisma>): boolean {
  const layer = state.layers.find((candidate) => candidate.name === 'collision');
  const chunk = state.chunks.find((candidate) => candidate.layerId === layer?.id);
  if (!chunk) return false;
  return rleDecodeToBooleans(decodeRlePairsFromBuffer(Buffer.from(chunk.data)), 4)[0];
}

describe('collision reconciliation through map routes', () => {
  it('keeps an object footprint solid when a non-colliding autotile is painted over it', async () => {
    const state = createCollisionPrisma({
      objects: [
        {
          id: 1,
          mapId: MAP.id,
          tileX: 0,
          tileY: 0,
          width: 16,
          height: 16,
          collide: true,
          scaleFactor: 1,
          collisionBaseHeight: 0,
        },
      ],
    });

    const response = await request(appFor(state.prisma))
      .patch('/maps/map/paint-rect')
      .send({
        layer: 'walls_auto',
        rect: { x0: 0, y0: 0, x1: 0, y1: 0 },
        autotile: { packUuid: PACK_UUID, autotileId: 'soft' },
      });

    expect(response.status).toBe(200);
    expect(collisionCell(state)).toBe(true);
  });

  it('keeps a colliding autotile solid after an overlapping object is deleted', async () => {
    const state = createCollisionPrisma({
      autotile: { slot: 7, collide: true },
      autotileValues: [7, 0, 0, 0],
      collisionValues: [1, 0, 0, 0],
      objects: [
        {
          id: 1,
          mapId: MAP.id,
          tileX: 0,
          tileY: 0,
          width: 16,
          height: 16,
          collide: true,
          scaleFactor: 1,
          collisionBaseHeight: 0,
        },
      ],
    });

    const response = await request(appFor(state.prisma)).delete('/maps/map/objects/1');

    expect(response.status).toBe(200);
    expect(collisionCell(state)).toBe(true);
  });

  it('keeps manual collision solid after a wall is painted and erased', async () => {
    const state = createCollisionPrisma({});
    const app = appFor(state.prisma);
    const rect = { x0: 0, y0: 0, x1: 0, y1: 0 };

    expect(
      (
        await request(app)
          .patch('/maps/map/paint-rect')
          .send({ layer: 'collision', rect, values: [1] })
      ).status,
    ).toBe(200);
    expect((await request(app).patch('/maps/map/paint-rect').send({ layer: 'walls', rect, tileRefId: 1 })).status).toBe(
      200,
    );
    expect((await request(app).patch('/maps/map/paint-rect').send({ layer: 'walls', rect, erase: true })).status).toBe(
      200,
    );
    expect(collisionCell(state)).toBe(true);
  });
});
