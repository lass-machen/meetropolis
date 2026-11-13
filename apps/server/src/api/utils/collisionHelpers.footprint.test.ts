/**
 * Strang B — foot collision. computeFootprintTiles restricts an object's
 * collision to the bottom `collisionBaseTiles` rows of its footprint, so a
 * plant blocks its pot, not its crown. Covers the sentinel (0 = full), the
 * foot rows, the clamp, and the tile-fixed-under-scale case (B-DP6).
 */
import { describe, it, expect } from 'vitest';
import { computeFootprintTiles } from './collisionHelpers.js';
import { ObjectFootprintLimitError } from './objectFootprintLimits.js';

// A 1-wide, 3-tall object anchored at tile (0,0) in one 32x32 chunk. Row index
// == ry because everything lands in chunk (0,0).
const W = 16;
const H = 48; // 3 tiles at 16px
const TILE = 16;
const CHUNK = 32;

function rows(collisionBaseTiles?: number, heightPx = H): number[] {
  const tiles = computeFootprintTiles(0, 0, W, heightPx, TILE, TILE, CHUNK, collisionBaseTiles);
  return tiles.map((t) => t.ry).sort((a, b) => a - b);
}

describe('computeFootprintTiles: foot-only collision', () => {
  it('sentinel 0 collides on the FULL footprint (legacy behaviour)', () => {
    expect(rows(0)).toEqual([0, 1, 2]);
  });

  it('omitted base defaults to the full footprint', () => {
    expect(rows(undefined)).toEqual([0, 1, 2]);
  });

  it('base 1 collides only on the bottom row (the pot)', () => {
    expect(rows(1)).toEqual([2]);
  });

  it('base 2 collides on the bottom two rows', () => {
    expect(rows(2)).toEqual([1, 2]);
  });

  it('clamps a base larger than the footprint to the full footprint', () => {
    expect(rows(5)).toEqual([0, 1, 2]);
  });

  it('is TILE-FIXED under scale (B-DP6): a scaled sprite keeps a 1-tile foot', () => {
    // caller passes heightPx already scaled 2x -> tilesH = 6, base stays 1 row.
    const scaledRows = rows(1, H * 2);
    expect(scaledRows).toEqual([5]); // only the very bottom row of the 6-row footprint
    expect(scaledRows.length).toBe(1);
  });

  it('keeps the full width on the foot rows', () => {
    // 2-wide (32px) x 3-tall, base 1 -> bottom row, both columns.
    const tiles = computeFootprintTiles(0, 0, 32, H, TILE, TILE, CHUNK, 1);
    expect(tiles.map((t) => `${t.rx},${t.ry}`).sort()).toEqual(['0,2', '1,2']);
  });
});

describe('computeFootprintTiles: footprint tile limit (A26)', () => {
  it('rejects a footprint just over the limit (4097 tiles)', () => {
    expect(() => computeFootprintTiles(0, 0, 16 * 4097, 16, 16, 16, 32)).toThrow(ObjectFootprintLimitError);
  });

  it('allows exactly 4096 tiles (64x64) and returns them all', () => {
    const tiles = computeFootprintTiles(0, 0, 16 * 64, 16 * 64, 16, 16, 32);
    expect(tiles).toHaveLength(4096);
  });

  it('rejects more than 4096 tiles', () => {
    expect(() => computeFootprintTiles(0, 0, 16 * 65, 16 * 64, 16, 16, 32)).toThrow(ObjectFootprintLimitError);
  });

  it('rejects invalid or non-finite widthPx', () => {
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => computeFootprintTiles(0, 0, v, 16, 16, 16, 32)).toThrow(ObjectFootprintLimitError);
    }
  });

  it('rejects invalid or non-finite heightPx', () => {
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => computeFootprintTiles(0, 0, 16, v, 16, 16, 32)).toThrow(ObjectFootprintLimitError);
    }
  });

  it('rejects invalid or non-finite tileWidth', () => {
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => computeFootprintTiles(0, 0, 16, 16, v, 16, 32)).toThrow(ObjectFootprintLimitError);
    }
  });

  it('rejects invalid or non-finite tileHeight', () => {
    for (const v of [0, -1, NaN, Infinity, -Infinity]) {
      expect(() => computeFootprintTiles(0, 0, 16, 16, 16, v, 32)).toThrow(ObjectFootprintLimitError);
    }
  });

  it('rejects high geometry even when collisionBaseTiles is 1', () => {
    expect(() => computeFootprintTiles(0, 0, 16, 16 * 4097, 16, 16, 32, 1)).toThrow(ObjectFootprintLimitError);
    expect(() => computeFootprintTiles(0, 0, 16 * 65, 16 * 64, 16, 16, 32, 1)).toThrow(ObjectFootprintLimitError);
  });
});
