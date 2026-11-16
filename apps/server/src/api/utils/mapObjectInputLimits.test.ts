/**
 * Pure boundary cases for the input limits: exact 4096/4097,
 * exact 65536/exceedance, scaling with pixel ceil edges, scale-
 * Overflow and invalid map tile sizes. Plus one legacy compatibility-
 * case: the proven calculation function throws above the limit for
 * large legacy inputs instead of returning 4097 tiles.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBulkFootprints,
  checkSingleFootprint,
  MAX_BULK_FOOTPRINT_TILES,
  MAX_OBJECT_FOOTPRINT_TILES,
} from './mapObjectInputLimits.js';
import { computeFootprintTiles } from './collisionHelpers.js';
import { ObjectFootprintLimitError } from './objectFootprintLimits.js';

const DIMS = { tileWidth: 16, tileHeight: 16 };

describe('checkSingleFootprint', () => {
  it('accepts exactly 4096 tiles (64 x 64 at 16 px per tile)', () => {
    expect(checkSingleFootprint({ width: 1024, height: 1024, scaleFactor: 1 }, DIMS)).toEqual({
      ok: true,
      tiles: 4096,
    });
    expect(MAX_OBJECT_FOOTPRINT_TILES).toBe(4096);
  });

  it('rejects 4097 tiles with a stable error code', () => {
    expect(checkSingleFootprint({ width: 16 * 4097, height: 16, scaleFactor: 1 }, DIMS)).toEqual({
      ok: false,
      error: 'object_footprint_too_large',
    });
  });

  it('scales before rounding up to tiles (ceil edges)', () => {
    // 17 px -> 2 tiles per axis, so 4 tiles.
    expect(checkSingleFootprint({ width: 17, height: 17 }, DIMS)).toEqual({ ok: true, tiles: 4 });
    // scale 1.5 on 16 px -> 24 px effective -> 2 x 2 tiles.
    expect(checkSingleFootprint({ width: 16, height: 16, scaleFactor: 1.5 }, DIMS)).toEqual({
      ok: true,
      tiles: 4,
    });
  });

  it('rejects a scale overflow without crashing', () => {
    expect(checkSingleFootprint({ width: 32, height: 32, scaleFactor: 1e308 }, DIMS)).toEqual({
      ok: false,
      error: 'invalid_object_dimensions',
    });
  });

  it('rejects invalid map tile sizes with its own error code', () => {
    expect(checkSingleFootprint({ width: 16, height: 16 }, { tileWidth: 0, tileHeight: 16 })).toEqual({
      ok: false,
      error: 'invalid_map_dimensions',
    });
    expect(checkSingleFootprint({ width: 16, height: 16 }, { tileWidth: Number.NaN, tileHeight: 16 })).toEqual({
      ok: false,
      error: 'invalid_map_dimensions',
    });
  });
});

describe('checkBulkFootprints', () => {
  it('accepts exactly 65536 total tiles (64 objects at 1024 tiles each)', () => {
    const objects = Array.from({ length: 64 }, () => ({ width: 512, height: 512, scaleFactor: 1 }));
    expect(checkBulkFootprints(objects, DIMS)).toEqual({ ok: true, tiles: 65536 });
    expect(MAX_BULK_FOOTPRINT_TILES).toBe(65536);
  });

  it('rejects an exceeded sum with a stable error code', () => {
    const objects = Array.from({ length: 65 }, () => ({ width: 512, height: 512, scaleFactor: 1 }));
    expect(checkBulkFootprints(objects, DIMS)).toEqual({
      ok: false,
      error: 'bulk_footprint_too_large',
    });
  });

  it('reports a single object that is too large even with a small sum', () => {
    const objects = [
      { width: 16, height: 16 },
      { width: 16 * 4097, height: 16, scaleFactor: 1 },
    ];
    expect(checkBulkFootprints(objects, DIMS)).toEqual({
      ok: false,
      error: 'object_footprint_too_large',
    });
  });
});

describe('computeFootprintTiles enforces the per-object tile limit', () => {
  it('rejects 4097 tiles for large legacy inputs', () => {
    expect(() => computeFootprintTiles(0, 0, 16 * 4097, 16, 16, 16, 32, 0)).toThrow(ObjectFootprintLimitError);
  });
});
