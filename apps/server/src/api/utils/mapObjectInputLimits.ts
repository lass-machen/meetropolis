/**
 * Input limits for map object footprints.
 *
 * Limits only new size and scale inputs at the two POST entry-
 * points (single and bulk creation). Existing worlds, seeds, automatic
 * migrations and backfills keep loading and computing without these limits;
 * `computeFootprintTiles` in collisionHelpers.ts remains unchanged.
 *
 * Calculation contract (exact for the current grid): effective pixel sizes are
 * `width * (scaleFactor ?? 1)` or `height * (scaleFactor ?? 1)`; the
 * Tile counts are `ceil(effective width / map.tileWidth)` and
 * `ceil(effective height / map.tileHeight)` with the real map dimensions from
 * `getMapDimensions` (never a hard-coded 16). The full area always counts
 * always, also with `collide: false` and independent of
 * `collisionBaseHeight`. Overflow, NaN, Infinity and unsafe numbers are
 * rejected; product and bulk sum are protected against overflow.
 */

export const MAX_OBJECT_FOOTPRINT_TILES = 4096;
export const MAX_BULK_FOOTPRINT_TILES = 65536;

export interface FootprintInput {
  width: number;
  height: number;
  scaleFactor?: number;
}

export interface MapTileDimensions {
  tileWidth: number;
  tileHeight: number;
}

export type FootprintLimitError =
  'invalid_map_dimensions' | 'invalid_object_dimensions' | 'object_footprint_too_large' | 'bulk_footprint_too_large';

export type FootprintCheck = { ok: true; tiles: number } | { ok: false; error: FootprintLimitError };

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function footprintTiles(input: FootprintInput, dims: MapTileDimensions): FootprintCheck {
  if (!positiveFinite(dims.tileWidth) || !positiveFinite(dims.tileHeight)) {
    return { ok: false, error: 'invalid_map_dimensions' };
  }
  if (!positiveFinite(input.width) || !positiveFinite(input.height)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const scale = input.scaleFactor ?? 1;
  if (!positiveFinite(scale)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const effWidth = input.width * scale;
  const effHeight = input.height * scale;
  if (!positiveFinite(effWidth) || !positiveFinite(effHeight)) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const tilesW = Math.ceil(effWidth / dims.tileWidth);
  const tilesH = Math.ceil(effHeight / dims.tileHeight);
  if (!Number.isSafeInteger(tilesW) || tilesW < 1 || !Number.isSafeInteger(tilesH) || tilesH < 1) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  const tiles = tilesW * tilesH;
  if (!Number.isSafeInteger(tiles) || tiles < 1) {
    return { ok: false, error: 'invalid_object_dimensions' };
  }
  if (tiles > MAX_OBJECT_FOOTPRINT_TILES) {
    return { ok: false, error: 'object_footprint_too_large' };
  }
  return { ok: true, tiles };
}

/** Checks a single object against the 4096-tile limit. */
export function checkSingleFootprint(input: FootprintInput, dims: MapTileDimensions): FootprintCheck {
  return footprintTiles(input, dims);
}

/**
 * Checks the entire bulk list before any write: each object must meet the
 * single-object limit, and the sum must not exceed 65536 tiles.
 * The caller must write nothing on `ok: false` (no partial writes).
 */
export function checkBulkFootprints(inputs: FootprintInput[], dims: MapTileDimensions): FootprintCheck {
  let total = 0;
  for (const input of inputs) {
    const single = footprintTiles(input, dims);
    if (!single.ok) return single;
    total += single.tiles;
    if (!Number.isSafeInteger(total) || total < 0) {
      return { ok: false, error: 'bulk_footprint_too_large' };
    }
    if (total > MAX_BULK_FOOTPRINT_TILES) {
      return { ok: false, error: 'bulk_footprint_too_large' };
    }
  }
  return { ok: true, tiles: total };
}
