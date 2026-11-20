/**
 * Footprint limits for the TMJ import behind POST /maps/:id/import-tmj.
 *
 * Zone objects carry pixel sizes; `persistImport` validates every zone
 * footprint with `assertObjectFootprints` before the write transaction, so a
 * violation answers 400 `object_footprint_too_large` and writes nothing.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./maps.editor.js', () => ({
  resolveEditorMemberTenant: vi.fn(() => Promise.resolve({ id: 'tenant-1', slug: 'tenant' })),
}));
vi.mock('../utils/broadcast.js', () => ({ broadcastMapUpdate: vi.fn() }));
vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleTmjImport } from './tmj.import.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

function makeTmj(objects: Array<{ width: number; height: number }>, mapWidth = 32, mapHeight = 32) {
  return {
    width: mapWidth,
    height: mapHeight,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [],
    layers: [
      {
        type: 'objectgroup',
        name: 'zones',
        objects: objects.map((obj, index) => ({
          id: index + 1,
          name: `zone-${index + 1}`,
          type: 'zone',
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
  const zoneCreate = vi.fn(() => Promise.resolve({ id: 'zone-new' }));
  const tx = {
    $queryRaw: vi.fn(() => Promise.resolve([])),
    map: { update: vi.fn(() => Promise.resolve({})) },
    mapLayer: {
      findMany: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 'layer-new' })),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    mapChunk: {
      create: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    mapTileset: {
      create: vi.fn(() => Promise.resolve({})),
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    room: { findFirst: vi.fn(() => Promise.resolve({ id: 'room-1' })) },
    zone: { create: zoneCreate, deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  };
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = {
    map: { findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', meta: {} })) },
    $transaction: transaction,
  } as unknown as PrismaClient;
  const req = {
    params: { id: 'map-1' },
    query: {},
    files: { file: [{ buffer: Buffer.from(JSON.stringify(tmj), 'utf-8') }], images: [] },
  } as unknown as Parameters<typeof handleTmjImport>[1];
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Parameters<typeof handleTmjImport>[2];
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return { prisma, req, res, zoneCreate, transaction };
}

describe('handleTmjImport — object footprint limits', () => {
  it('imports a 1024 x 1024 px zone on a 16 px tile map (64 x 64 = 4096 tiles)', async () => {
    const { prisma, req, res, zoneCreate } = makeHarness(makeTmj([{ width: 1024, height: 1024 }]));
    await handleTmjImport(prisma, req, res);
    expect(zoneCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, zones: 1 }));
  });

  it('answers 400 object_footprint_too_large for a 16400 px wide zone without writing', async () => {
    const { prisma, req, res, zoneCreate, transaction } = makeHarness(makeTmj([{ width: 16400, height: 1024 }]));
    await handleTmjImport(prisma, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'object_footprint_too_large' });
    expect(zoneCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('answers 400 invalid_tmj for a 513 tile wide map without writing', async () => {
    const { prisma, req, res, zoneCreate, transaction } = makeHarness(makeTmj([{ width: 16, height: 16 }], 513, 8));
    await handleTmjImport(prisma, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid_tmj' }));
    expect(zoneCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('imports a 512 x 8 tile map', async () => {
    const { prisma, req, res, zoneCreate } = makeHarness(makeTmj([{ width: 16, height: 16 }], 512, 8));
    await handleTmjImport(prisma, req, res);
    expect(zoneCreate).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true, zones: 1 }));
  });
});
