/**
 * Footprint limits for every map object write path besides the POST routes.
 *
 * PATCH, the Tiled admin import, the template copy and the V2 importer apply
 * the same per-object limit as POST (`checkSingleFootprint`) to the values
 * they are about to persist. A violation throws before any object is written;
 * thrown inside a transaction it rolls the whole operation back.
 *
 * On top of that, the colliding objects of one map share a budget: every
 * collision reconcile computes the footprint of all of them, so their summed
 * full-area tiles bound the cost of a single reconcile.
 */
import type { Response } from 'express';
import {
  checkSingleFootprint,
  type FootprintInput,
  type FootprintLimitError,
  type MapTileDimensions,
} from './mapObjectInputLimits.js';
import type { MapDb } from './mapChunkMutations.js';
import { ObjectFootprintLimitError } from './objectFootprintLimits.js';

/**
 * Upper bound for the summed full-area tiles of all colliding objects of one
 * map. Derived from the shipped maps: the largest, the office atelier
 * template, holds 235 colliding objects with 745 tiles in total (office.json:
 * 99 objects, 272 tiles). 65536 leaves a margin of about 88 times that and
 * equals the bulk request limit, i.e. 16 objects at the single-object limit.
 */
export const MAX_MAP_COLLISION_FOOTPRINT_TILES = 65536;

export type MapObjectWriteLimitError = FootprintLimitError | 'map_collision_footprint_too_large';

const DEFAULT_TILE_SIZE = 16;

/** Tile size of a stored map; unset values fall back to 16 px like every map route. */
export function mapTileDimensions(map: { tileWidth: number | null; tileHeight: number | null }): MapTileDimensions {
  return {
    tileWidth: map.tileWidth ?? DEFAULT_TILE_SIZE,
    tileHeight: map.tileHeight ?? DEFAULT_TILE_SIZE,
  };
}

export class MapObjectFootprintRejectedError extends Error {
  readonly code: MapObjectWriteLimitError;

  constructor(code: MapObjectWriteLimitError) {
    super(`map object rejected: ${code}`);
    this.name = 'MapObjectFootprintRejectedError';
    this.code = code;
  }
}

/** Throws `MapObjectFootprintRejectedError` for the first object over the limit. */
export function assertObjectFootprints(inputs: Iterable<FootprintInput>, dims: MapTileDimensions): void {
  for (const input of inputs) {
    const check = checkSingleFootprint(input, dims);
    if (!check.ok) throw new MapObjectFootprintRejectedError(check.error);
  }
}

/**
 * Collision budget of one map. Create it inside the write transaction after
 * the map advisory lock is held, so concurrent writes to the same map cannot
 * exceed the budget together. Deletes never consult it.
 */
export class MapCollisionBudget {
  private usedTiles: number;

  constructor(usedTiles = 0) {
    this.usedTiles = usedTiles;
  }

  /** Budget already used by the colliding objects stored on `mapId`. */
  static async forMap(db: MapDb, mapId: string, dims: MapTileDimensions): Promise<MapCollisionBudget> {
    const stored = await db.mapObject.findMany({
      where: { mapId, collide: true },
      select: { width: true, height: true, scaleFactor: true },
    });
    const budget = new MapCollisionBudget();
    for (const object of stored) budget.add(object, dims);
    return budget;
  }

  /** Counts one colliding object; throws when it is invalid or the map budget would be exceeded. */
  add(input: FootprintInput, dims: MapTileDimensions): void {
    const check = checkSingleFootprint(input, dims);
    if (!check.ok) throw new MapObjectFootprintRejectedError(check.error);
    const next = this.usedTiles + check.tiles;
    if (next > MAX_MAP_COLLISION_FOOTPRINT_TILES) {
      throw new MapObjectFootprintRejectedError('map_collision_footprint_too_large');
    }
    this.usedTiles = next;
  }
}

/** Stable 400 body for footprint failures at an HTTP boundary; null for any other error. */
export function footprintErrorBody(error: unknown): { error: MapObjectWriteLimitError } | null {
  if (error instanceof MapObjectFootprintRejectedError) return { error: error.code };
  if (error instanceof ObjectFootprintLimitError) return { error: 'object_footprint_too_large' };
  return null;
}

/** Answers 400 for footprint failures and returns true; returns false for any other error. */
export function sendFootprintError(res: Response, error: unknown): boolean {
  const body = footprintErrorBody(error);
  if (!body) return false;
  res.status(400).json(body);
  return true;
}
