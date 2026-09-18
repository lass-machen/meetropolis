import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/index.js';
import { encodeRlePairsToBuffer, rleEncodeBooleans, rleEncodeNumbers } from '../mapEncoding.js';
import {
  CollisionMigrationConflictsError,
  migrateCollisionSources,
  planCollisionMigration,
  type CollisionMigrationMap,
} from './migrateCollisionSources.js';

function chunk(values: number[], encoding: 'rle' | 'rle-bool', x = 0, y = 0) {
  const pairs = encoding === 'rle' ? rleEncodeNumbers(values) : rleEncodeBooleans(values.map(Boolean));
  return {
    id: `${encoding}-chunk`,
    x,
    y,
    version: 1,
    encoding,
    data: new Uint8Array(encodeRlePairsToBuffer(pairs)),
  };
}

function legacyMap(): CollisionMigrationMap {
  return {
    id: 'map-one',
    width: 2,
    height: 2,
    tileWidth: 16,
    tileHeight: 16,
    chunkSize: 2,
    collisionSourcesMigratedAt: null,
    autotiles: [{ slot: 7, collide: true }],
    objects: [
      {
        tileX: 0,
        tileY: 1,
        width: 16,
        height: 16,
        collide: true,
        scaleFactor: 1,
        collisionBaseHeight: 0,
      },
    ],
    layers: [
      { id: 'collision', name: 'collision', chunkSize: 2, chunks: [chunk([1, 1, 1, 1], 'rle-bool')] },
      { id: 'walls', name: 'walls', chunkSize: 2, chunks: [chunk([1, 0, 0, 0], 'rle')] },
      { id: 'auto', name: 'walls_auto', chunkSize: 2, chunks: [chunk([0, 7, 0, 0], 'rle')] },
    ],
  };
}

describe('legacy collision source migration', () => {
  it('preserves every legacy collision cell, including overlaps with reconstructable sources', () => {
    const plan = planCollisionMigration(legacyMap());

    expect(plan).toEqual({
      status: 'pending',
      manual: new Set(['0:0', '1:0', '0:1', '1:1']),
      affected: new Set(['0:0', '1:0', '0:1', '1:1']),
    });
  });

  it('does not mistake a pre-existing empty manual layer for the migration marker', () => {
    const map = legacyMap();
    map.layers.push({ id: 'manual', name: 'collision_manual', chunkSize: 2, chunks: [] });

    expect(planCollisionMigration(map).status).toBe('pending');
  });

  it('is idempotent only after the explicit marker is present', () => {
    const map = legacyMap();
    map.collisionSourcesMigratedAt = new Date('2026-09-18T00:00:00Z');

    expect(planCollisionMigration(map)).toEqual({ status: 'unchanged' });
  });

  it('leaves a post-cutover map with derived collision unchanged on a later run', async () => {
    const map = legacyMap();
    map.collisionSourcesMigratedAt = new Date('2026-09-18T12:00:00Z');
    const update = vi.fn();
    const createLayer = vi.fn();
    const tx = {
      map: { findUnique: vi.fn().mockResolvedValue(map), update },
      mapLayer: { create: createLayer },
    };
    const prisma = {
      map: { findMany: vi.fn().mockResolvedValue([{ id: map.id }]) },
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;

    const summary = await migrateCollisionSources(prisma, true, vi.fn());

    expect(summary).toEqual({ maps: 1, pending: 0, migrated: 0, unchanged: 1, conflicts: 0 });
    expect(createLayer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('handles different source chunk sizes, scaled base collision, and outside coordinates', () => {
    const map = legacyMap();
    map.width = 2;
    map.height = 2;
    map.chunkSize = 5;
    map.layers = [
      {
        id: 'collision',
        name: 'collision',
        chunkSize: 2,
        chunks: [chunk([0, 0, 0, 1], 'rle-bool', -1, -1), chunk([1, 0, 0, 0], 'rle-bool', 2, 0)],
      },
      {
        id: 'walls',
        name: 'walls',
        chunkSize: 3,
        chunks: [chunk([0, 0, 0, 0, 0, 0, 0, 0, 9], 'rle', -1, -1)],
      },
      {
        id: 'auto',
        name: 'walls_auto',
        chunkSize: 4,
        chunks: [chunk([7, ...new Array<number>(15).fill(0)], 'rle', 1, 0)],
      },
    ];
    map.objects = [
      {
        tileX: 5,
        tileY: 5,
        width: 16,
        height: 32,
        collide: true,
        scaleFactor: 2,
        collisionBaseHeight: 1,
      },
    ];

    const plan = planCollisionMigration(map);

    expect(plan.status).toBe('pending');
    if (plan.status === 'pending') {
      expect(plan.manual).toEqual(new Set(['-1:-1', '4:0']));
      expect(plan.affected).toEqual(new Set(['-1:-1', '4:0', '5:8', '6:8']));
    }
  });

  it('reports planning failures after continuing the per-map run', async () => {
    const tx = { map: { findUnique: vi.fn().mockRejectedValue(new Error('broken legacy chunk')) } };
    const prisma = {
      map: { findMany: vi.fn().mockResolvedValue([{ id: 'broken-map' }]) },
      $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaClient;
    const log = vi.fn();

    await expect(migrateCollisionSources(prisma, true, log)).rejects.toBeInstanceOf(CollisionMigrationConflictsError);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('broken-map: CONFLICT broken legacy chunk'));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"conflicts":1'));
  });
});
