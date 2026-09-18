import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { decodeRlePairsFromBuffer, rleDecodeToBooleans } from '../../mapEncoding.js';
import { applyCollisionSideEffect } from './collisionSideEffect.js';

describe('autotile collision side effect', () => {
  it('uses the persisted palette collide flag instead of treating every wall slot as solid', async () => {
    const create = vi.fn(({ data }: { data: { encoding: string; data: Uint8Array } }) => ({
      id: 'collision-chunk',
      version: 1,
      encoding: data.encoding,
      data: data.data,
    }));
    const prisma = {
      mapLayer: {
        findUnique: vi.fn().mockResolvedValue({ id: 'collision-layer', chunkSize: 2 }),
        create: vi.fn(),
      },
      mapChunk: { findMany: vi.fn().mockResolvedValue([]), create, update: vi.fn() },
    } as unknown as PrismaClient;

    const updates = await applyCollisionSideEffect({
      prisma,
      mapId: 'map-one',
      defaultChunkSize: 2,
      rect: { x0: 0, y0: 0, x1: 1, y1: 0 },
      wallChunkSize: 2,
      wallChunkUpdates: new Map([['0:0', { _decoded: [1, 2, 0, 0] }]]),
      collidingSlots: new Set([2]),
    });

    expect(updates).toHaveLength(1);
    const encoded = Buffer.from(updates[0].data, 'base64');
    expect(rleDecodeToBooleans(decodeRlePairsFromBuffer(encoded), 4)).toEqual([false, true, false, false]);
  });
});
