import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/index.js';
import { encodeRlePairsToBuffer, rleEncodeNumbers } from '../mapEncoding.js';
import { buildLegacyPalette, migrateAutotilePalettes } from './migrateAutotilePalettes.js';

function autotile(id: string) {
  return {
    id,
    key: id,
    category: 'autotile',
    dataURL: `/assets/${id}.png`,
    placement: 'wall',
    collide: true,
    tileWidth: 16,
    tileHeight: 48,
    gridHeight: 3,
    autotileType: '4bit',
    variants: { '0': { col: 0, row: 0 } },
  };
}

describe('legacy autotile palette reconstruction', () => {
  it('reproduces pack UUID then autotile ID ordering from slot one', () => {
    const palette = buildLegacyPalette([
      { uuid: 'pack-z', autotiles: [autotile('b'), autotile('a')] },
      { uuid: 'pack-a', autotiles: [autotile('c')] },
    ]);

    expect(palette.map(({ slot, packUuid, autotileId }) => ({ slot, packUuid, autotileId }))).toEqual([
      { slot: 1, packUuid: 'pack-a', autotileId: 'c' },
      { slot: 2, packUuid: 'pack-z', autotileId: 'a' },
      { slot: 3, packUuid: 'pack-z', autotileId: 'b' },
    ]);
  });

  it('repairs a stale counter once without recreating an existing palette', async () => {
    let nextAutotileSlot = 1;
    const entries = [{ slot: 1, packUuid: 'pack-a', autotileId: 'wall' }];
    const chunkData = new Uint8Array(encodeRlePairsToBuffer(rleEncodeNumbers([1, 0, 0, 0])));
    const updateMany = vi.fn(({ data }: { data: { nextAutotileSlot: number } }) => {
      nextAutotileSlot = data.nextAutotileSlot;
      return { count: 1 };
    });
    const tx = { mapAutotile: { create: vi.fn() }, map: { updateMany } };
    const prisma = {
      assetPack: { findMany: vi.fn().mockResolvedValue([{ uuid: 'pack-a', autotiles: [autotile('wall')] }]) },
      mapLayer: {
        findMany: vi.fn(() => [
          {
            mapId: 'map-one',
            chunkSize: 2,
            map: { nextAutotileSlot },
            chunks: [{ encoding: 'rle', data: chunkData }],
          },
        ]),
      },
      mapAutotile: { findMany: vi.fn(() => entries) },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx)),
    } as unknown as PrismaClient;

    const first = await migrateAutotilePalettes(prisma, true, vi.fn());
    const second = await migrateAutotilePalettes(prisma, true, vi.fn());

    expect(first).toMatchObject({ pending: 1, migrated: 1, unchanged: 0 });
    expect(second).toMatchObject({ pending: 0, migrated: 0, unchanged: 1 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(tx.mapAutotile.create).not.toHaveBeenCalled();
    expect(nextAutotileSlot).toBe(2);
  });
});
