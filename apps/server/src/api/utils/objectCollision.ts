import { computeFootprintTiles, type CollisionTile } from './collisionHelpers.js';
import { reconcileCollisionTiles } from './collisionReconciler.js';
import type { ChunkUpdateResult, MapDb } from './mapChunkMutations.js';

export interface CollisionDimensions {
  chunkSize: number;
  tileWidth: number;
  tileHeight: number;
}

export interface CollisionObject {
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  scaleFactor?: number;
  collisionBaseHeight?: number;
}

export function objectCollisionTiles(object: CollisionObject, dims: CollisionDimensions): CollisionTile[] {
  const scale = object.scaleFactor ?? 1;
  return computeFootprintTiles(
    object.tileX,
    object.tileY,
    object.width * scale,
    object.height * scale,
    dims.tileWidth,
    dims.tileHeight,
    dims.chunkSize,
    object.collisionBaseHeight ?? 0,
  );
}

export function reconcileObjectCollision(
  tx: MapDb,
  mapId: string,
  dims: CollisionDimensions,
  objects: CollisionObject[],
): Promise<ChunkUpdateResult[]> {
  return reconcileCollisionTiles(
    tx,
    mapId,
    dims,
    objects.flatMap((object) => objectCollisionTiles(object, dims)),
  );
}
