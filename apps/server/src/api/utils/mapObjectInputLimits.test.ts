/**
 * Pure boundary cases for the input limits: exact 4096/4097,
 * exact 65536/exceedance, scaling with pixel ceil edges, scale-
 * Overflow and invalid map tile sizes. Plus one legacy compatibility-
 * case: the proven calculation function still returns 4097 tiles for
 * large legacy inputs; it stays without a global limit so that old
 * worlds, seeds and migrations keep loading unchanged.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBulkFootprints,
  checkSingleFootprint,
  MAX_BULK_FOOTPRINT_TILES,
  MAX_OBJECT_FOOTPRINT_TILES,
} from './mapObjectInputLimits.js';
import { computeFootprintTiles } from './collisionHelpers.js';

const DIMS = { tileWidth: 16, tileHeight: 16 };

describe('checkSingleFootprint', () => {
  it('accepts exactly 4096 tiles (64 x 64 at 16 px per tile)', () => {
    expect(checkSingleFootprint({ width: 1024, height: 1024, scaleFactor: 1 }, DIMS)).toEqual({
      ok: true,
      tiles: 4096,
    });
    expect(MAX_OBJECT_FOOTPRINT_TILES).toBe(4096);
  });

  it('lehnt 4097 Kacheln mit stabilem Fehlercode ab', () => {
    expect(checkSingleFootprint({ width: 16 * 4097, height: 16, scaleFactor: 1 }, DIMS)).toEqual({
      ok: false,
      error: 'object_footprint_too_large',
    });
  });

  it('scales before rounding up to tiles (ceil edges)', () => {
    // 17 px -> 2 Kacheln je Achse, also 4 Kacheln.
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
  it('nimmt exakt 65536 Summen-Kacheln an (64 Objekte a 1024 Kacheln)', () => {
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

describe('computeFootprintTiles stays unbounded (legacy compatibility)', () => {
  it('still returns 4097 tiles for large legacy inputs', () => {
    const tiles = computeFootprintTiles(0, 0, 16 * 4097, 16, 16, 16, 32, 0);
    expect(tiles).toHaveLength(4097);
  });
});
