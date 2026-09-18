import { describe, expect, it, vi } from 'vitest';
import type express from 'express';
import type { MapAutotile, PrismaClient } from '../../generated/prisma/index.js';
import { allocateMapAutotile, contentHashFromAssetUrl, resolveMapAutotileForPaint } from './mapAutotilePalette.js';

vi.mock('./resolvePackScope.js', () => ({
  resolvePackScope: vi.fn().mockResolvedValue({ kind: 'tenant', tenantId: 'tenant-one' }),
}));

const IDENTITY = { packUuid: '4664b745-6bad-4d86-ae8f-591c57567692', autotileId: 'wall-set' };
const SCOPE = { kind: 'tenant' as const, tenantId: 'tenant-one' };
const SNAPSHOT = {
  key: 'Wall set',
  imageUrl: '/assets/walls.png',
  tileWidth: 16,
  tileHeight: 48,
  gridHeight: 3,
  variants: { '0': { col: 0, row: 0 } },
  collide: true,
  placement: 'wall',
  hash: null,
};

const STORED_PACK = {
  uuid: IDENTITY.packUuid,
  archived: false,
  autotiles: ['wall-set', 'glass-wall'].map((id) => ({
    id,
    key: SNAPSHOT.key,
    category: 'autotile',
    autotileType: '4bit',
    dataURL: SNAPSHOT.imageUrl,
    tileWidth: SNAPSHOT.tileWidth,
    tileHeight: SNAPSHOT.tileHeight,
    gridHeight: SNAPSHOT.gridHeight,
    variants: SNAPSHOT.variants,
    collide: SNAPSHOT.collide,
    placement: SNAPSHOT.placement,
  })),
};

function row(identity: typeof IDENTITY, slot: number): MapAutotile {
  return {
    id: `palette-${slot}`,
    mapId: 'map-one',
    slot,
    ...identity,
    ...SNAPSHOT,
    createdAt: new Date('2026-09-18T00:00:00Z'),
    updatedAt: new Date('2026-09-18T00:00:00Z'),
  };
}

function allocatorPrisma() {
  let nextAutotileSlot = 1;
  const rows: MapAutotile[] = [];
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    assetPack: {
      findFirst: vi.fn(() => STORED_PACK),
    },
    mapAutotile: {
      findUnique: vi.fn(({ where }: { where: { mapId_packUuid_autotileId: typeof IDENTITY & { mapId: string } } }) => {
        const identity = where.mapId_packUuid_autotileId;
        return rows.find(
          (entry) =>
            entry.mapId === identity.mapId &&
            entry.packUuid === identity.packUuid &&
            entry.autotileId === identity.autotileId,
        );
      }),
      create: vi.fn(({ data }: { data: Omit<MapAutotile, 'id' | 'createdAt' | 'updatedAt'> }) => {
        const entry = row({ packUuid: data.packUuid, autotileId: data.autotileId }, data.slot);
        rows.push(entry);
        return entry;
      }),
      aggregate: vi.fn(() => ({ _max: { slot: rows.at(-1)?.slot ?? null } })),
    },
    map: {
      findUnique: vi.fn(() => ({ nextAutotileSlot })),
      update: vi.fn(({ data }: { data: { nextAutotileSlot: number } }) => {
        nextAutotileSlot = data.nextAutotileSlot;
        return { nextAutotileSlot };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return { prisma, rows, tx };
}

describe('map-local autotile palette allocation', () => {
  it('captures the content hash embedded in an asset URL', () => {
    expect(contentHashFromAssetUrl('/packs/pack/walls/wall.5be5bde2dc68.png')).toBe('5be5bde2dc68');
    expect(contentHashFromAssetUrl('/packs/pack/walls/unhashed.png')).toBeNull();
  });
  it('keeps an identity stable and assigns new identities monotonically', async () => {
    const { prisma, rows } = allocatorPrisma();
    const first = await allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE);
    const repeated = await allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE);
    const second = await allocateMapAutotile(prisma, 'map-one', { ...IDENTITY, autotileId: 'glass-wall' }, SCOPE);

    expect(first).toMatchObject({ created: true, entry: { slot: 1 } });
    expect(repeated).toMatchObject({ created: false, entry: { slot: 1 } });
    expect(second).toMatchObject({ created: true, entry: { slot: 2 } });
    expect(rows.map((entry) => entry.slot)).toEqual([1, 2]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('retries a unique conflict and resolves the concurrently created identity', async () => {
    const concurrent = row(IDENTITY, 4);
    const tx = {
      $queryRaw: vi.fn(),
      assetPack: { findFirst: vi.fn().mockResolvedValue(STORED_PACK) },
      mapAutotile: { findUnique: vi.fn().mockResolvedValue(concurrent), create: vi.fn() },
      map: { update: vi.fn() },
    };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('unique conflict'), { code: 'P2002' }))
      .mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const result = await allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE);

    expect(result).toEqual({ entry: concurrent, created: false });
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(tx.mapAutotile.create).not.toHaveBeenCalled();
  });

  it('repairs a counter that fell behind an existing slot', async () => {
    const { prisma, rows } = allocatorPrisma();
    rows.push(row({ ...IDENTITY, autotileId: 'legacy-wall' }, 7));

    const result = await allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE);

    expect(result).toMatchObject({ created: true, entry: { slot: 8 } });
  });

  it('revalidates the caller scope after locking and before creating a snapshot', async () => {
    const { prisma, tx } = allocatorPrisma();

    await allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[1]);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(tx.assetPack.findFirst.mock.invocationCallOrder[0]);
    expect(tx.assetPack.findFirst).toHaveBeenCalledWith({
      where: {
        uuid: IDENTITY.packUuid,
        archived: false,
        OR: [{ tenantId: 'tenant-one' }, { tenantId: null }],
      },
      select: { archived: true, autotiles: true },
    });
  });

  it('rejects a revoked pack before returning an existing palette entry', async () => {
    const { prisma, rows, tx } = allocatorPrisma();
    rows.push(row(IDENTITY, 4));
    tx.assetPack.findFirst.mockResolvedValueOnce(null);

    await expect(allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE)).rejects.toThrow('autotile_not_found');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.assetPack.findFirst).toHaveBeenCalledOnce();
    expect(tx.mapAutotile.findUnique).not.toHaveBeenCalled();
  });

  it('revalidates a revoked pack before an existing-entry return on a retry', async () => {
    const { prisma, rows, tx } = allocatorPrisma();
    rows.push(row(IDENTITY, 4));
    tx.assetPack.findFirst.mockResolvedValueOnce(STORED_PACK).mockResolvedValueOnce(null);
    let attempts = 0;
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => {
      attempts++;
      const result = await callback(tx as never);
      if (attempts === 1) throw Object.assign(new Error('serialization failure'), { code: 'P2034' });
      return result;
    });

    await expect(allocateMapAutotile(prisma, 'map-one', IDENTITY, SCOPE)).rejects.toThrow('autotile_not_found');

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.assetPack.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.mapAutotile.findUnique).toHaveBeenCalledOnce();
  });

  it('rejects an autotile whose pack is outside the caller scope', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const transaction = vi.fn();
    const prisma = { assetPack: { findFirst }, $transaction: transaction } as unknown as PrismaClient;

    const result = await resolveMapAutotileForPaint(prisma, {} as express.Request, 'map-one', IDENTITY);

    expect(result).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        uuid: IDENTITY.packUuid,
        archived: false,
        OR: [{ tenantId: 'tenant-one' }, { tenantId: null }],
      },
      select: { autotiles: true },
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
