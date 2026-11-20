/**
 * Tileset image references in the TMJ import behind POST /maps/:id/import-tmj.
 *
 * A tileset without an uploaded image keeps the path from the TMJ file, and
 * every client of the tenant later fetches it. The import therefore applies
 * the same rule as tileset registration in the editor: only plain asset paths,
 * absolute URLs reduced to their path, everything else answers 400 and writes
 * nothing.
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

function makeTmj(image: string) {
  return {
    width: 8,
    height: 8,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [{ firstgid: 1, name: 'ground', image, tilewidth: 16, tileheight: 16, imagewidth: 64, imageheight: 64 }],
    layers: [],
  };
}

function makeHarness(image: string) {
  const tilesetCreate = vi.fn((_args: { data: { imageUrl: string } }) => Promise.resolve({}));
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
    mapTileset: { create: tilesetCreate, deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    room: { findFirst: vi.fn(() => Promise.resolve({ id: 'room-1' })) },
    zone: { create: vi.fn(), deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  };
  const transaction = vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = {
    map: { findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', meta: {} })) },
    $transaction: transaction,
  } as unknown as PrismaClient;
  const req = {
    params: { id: 'map-1' },
    query: {},
    files: { file: [{ buffer: Buffer.from(JSON.stringify(makeTmj(image)), 'utf-8') }], images: [] },
  } as unknown as Parameters<typeof handleTmjImport>[1];
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Parameters<typeof handleTmjImport>[2];
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  (res.json as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return { prisma, req, res, tilesetCreate, transaction };
}

describe('handleTmjImport — tileset image paths', () => {
  it.each([
    ['a foreign absolute URL', 'https://evil.example/tiles.png'],
    ['a protocol-relative URL', '//evil.example/tiles.png'],
    ['a path outside the asset roots', '/api/admin/tiles.png'],
    ['a dot-segment traversal', '/assets/../api/tiles.png'],
    ['an encoded traversal', '/assets/%2e%2e/api/tiles.png'],
    ['a relative file name without upload', 'tiles.png'],
  ])('answers 400 invalid_tileset_image for %s without writing', async (_label, image) => {
    const { prisma, req, res, tilesetCreate, transaction } = makeHarness(image);
    await handleTmjImport(prisma, req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_tileset_image', tileset: 'ground' });
    expect(tilesetCreate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps a plain asset path', async () => {
    const { prisma, req, res, tilesetCreate } = makeHarness('/assets/tilesets/ground.png');
    await handleTmjImport(prisma, req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(tilesetCreate.mock.calls[0][0].data.imageUrl).toBe('/assets/tilesets/ground.png');
  });

  it('stores only the path of an absolute URL that points at an asset', async () => {
    const { prisma, req, res, tilesetCreate } = makeHarness('https://app.example/packs/pack-1/ground.png');
    await handleTmjImport(prisma, req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(tilesetCreate.mock.calls[0][0].data.imageUrl).toBe('/packs/pack-1/ground.png');
  });
});
