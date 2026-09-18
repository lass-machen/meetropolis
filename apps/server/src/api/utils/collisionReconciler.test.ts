import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  encodeRlePairsToBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
  rleEncodeNumbers,
} from '../../mapEncoding.js';
import { reconcileCollisionTiles } from './collisionReconciler.js';
import { MapChunkWriteConflict, persistChunk, type StoredChunk } from './mapChunkMutations.js';

const DIMS = { chunkSize: 2, tileWidth: 16, tileHeight: 16 };
const AFFECTED = [{ cx: 0, cy: 0, rx: 0, ry: 0 }];

function encoded(values: number[], bool = false): Uint8Array {
  const pairs = bool ? rleEncodeBooleans(values.map(Boolean)) : rleEncodeNumbers(values);
  return new Uint8Array(encodeRlePairsToBuffer(pairs));
}

function collisionDb(params: {
  manual?: number[];
  walls?: number[];
  autotiles?: number[];
  collidingSlots?: number[];
  objects?: Array<Record<string, number>>;
}) {
  const layers = [
    params.manual && { id: 'manual', mapId: 'map', name: 'collision_manual', chunkSize: 2 },
    params.walls && { id: 'walls', mapId: 'map', name: 'walls', chunkSize: 2 },
    params.autotiles && { id: 'auto', mapId: 'map', name: 'walls_auto', chunkSize: 2 },
    { id: 'derived', mapId: 'map', name: 'collision', chunkSize: 2 },
  ].filter(Boolean) as Array<{ id: string; mapId: string; name: string; chunkSize: number }>;
  const chunks: StoredChunk[] = [];
  for (const [layerId, values, bool] of [
    ['manual', params.manual, true],
    ['walls', params.walls, false],
    ['auto', params.autotiles, false],
  ] as const) {
    if (values)
      chunks.push({
        id: layerId,
        layerId,
        x: 0,
        y: 0,
        version: 1,
        encoding: bool ? 'rle-bool' : 'rle',
        data: encoded(values, bool),
      } as StoredChunk & { layerId: string });
  }
  const db = {
    mapLayer: {
      findUnique: vi.fn(({ where }) => layers.find((layer) => layer.name === where.mapId_name.name) ?? null),
      create: vi.fn(),
    },
    mapChunk: {
      findMany: vi.fn(({ where }) =>
        chunks.filter((chunk) => (chunk as StoredChunk & { layerId: string }).layerId === where.layerId),
      ),
      create: vi.fn(({ data }) => ({ id: 'new', ...data })),
      updateMany: vi.fn(() => ({ count: 1 })),
    },
    mapAutotile: {
      findMany: vi.fn(() => (params.collidingSlots ?? []).map((slot) => ({ slot }))),
    },
    mapObject: {
      findMany: vi.fn(() => params.objects ?? []),
    },
  } as unknown as Prisma.TransactionClient;
  return db;
}

function decodedResult(data: string): boolean[] {
  return rleDecodeToBooleans(decodeRlePairsFromBuffer(Buffer.from(data, 'base64')), 4);
}

describe('collision source reconciliation', () => {
  it('keeps an object foot solid when a non-colliding autotile is painted over it', async () => {
    const db = collisionDb({
      autotiles: [2, 0, 0, 0],
      collidingSlots: [],
      objects: [{ tileX: 0, tileY: 0, width: 16, height: 16, scaleFactor: 1, collisionBaseHeight: 0 }],
    });

    const updates = await reconcileCollisionTiles(db, 'map', DIMS, AFFECTED);

    expect(decodedResult(updates[0].data)[0]).toBe(true);
  });

  it('keeps an autotile wall solid after an overlapping object is removed', async () => {
    const db = collisionDb({ autotiles: [7, 0, 0, 0], collidingSlots: [7], objects: [] });

    const updates = await reconcileCollisionTiles(db, 'map', DIMS, AFFECTED);

    expect(decodedResult(updates[0].data)[0]).toBe(true);
  });

  it('keeps manual collision solid while painting or erasing other sources', async () => {
    const db = collisionDb({ manual: [1, 0, 0, 0], autotiles: [0, 0, 0, 0], objects: [] });

    const updates = await reconcileCollisionTiles(db, 'map', DIMS, AFFECTED);

    expect(decodedResult(updates[0].data)[0]).toBe(true);
  });

  it('rejects a stale chunk version instead of losing a concurrent write', async () => {
    const db = {
      mapChunk: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as Prisma.TransactionClient;
    const existing = { id: 'chunk', x: 0, y: 0, version: 4, encoding: 'rle', data: encoded([0, 0, 0, 0]) };

    await expect(persistChunk(db, 'layer', { x: 0, y: 0 }, existing, 'rle', [1, 0, 0, 0])).rejects.toBeInstanceOf(
      MapChunkWriteConflict,
    );
  });
});
