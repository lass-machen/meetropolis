import { describe, expect, it } from 'vitest';
import { encodeRlePairsToBuffer, rleEncodeBooleans, rleEncodeNumbers } from '../mapEncoding.js';
import { planCollisionMigration, type CollisionMigrationMap } from './migrateCollisionSources.js';

function chunk(values: number[], encoding: 'rle' | 'rle-bool') {
  const pairs = encoding === 'rle' ? rleEncodeNumbers(values) : rleEncodeBooleans(values.map(Boolean));
  return {
    id: `${encoding}-chunk`,
    x: 0,
    y: 0,
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
  it('subtracts reconstructable wall, autotile, and object sources from manual collision', () => {
    const plan = planCollisionMigration(legacyMap());

    expect(plan).toEqual({ status: 'pending', manual: new Set(['1:1']) });
  });

  it('is idempotent once the manual source layer exists', () => {
    const map = legacyMap();
    map.layers.push({ id: 'manual', name: 'collision_manual', chunkSize: 2, chunks: [] });

    expect(planCollisionMigration(map)).toEqual({ status: 'unchanged' });
  });
});
