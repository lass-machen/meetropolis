import type { PrismaClient } from '../../generated/prisma/index.js';
import { assetPackScopeWhere, refreshPackScope, type PackScope } from '../../services/packScope.js';
import { acquireMapAdvisoryLock, acquirePackAdvisoryLock } from './advisoryLocks.js';
import { broadcastMapUpdate } from './broadcast.js';
import { runSerializable, type ChunkUpdateResult, type MapDb } from './mapChunkMutations.js';
import { MapCollisionBudget, mapTileDimensions } from './mapObjectWriteLimits.js';
import { reconcileObjectCollision } from './objectCollision.js';

export type MapObjectWriteData = {
  assetPackUuid: string;
  itemId: string;
  category: string;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  collide: boolean;
  zIndex?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  scaleFactor?: number;
  dataUrl: string;
  collisionBaseHeight?: number;
  renderLayer?: 'floor' | 'sorted' | 'overhead';
};

export type MapDimensions = {
  chunkSize: number;
  tileWidth: number;
  tileHeight: number;
};

export function getMapDimensions(map: {
  chunkSize: number | null;
  tileWidth: number | null;
  tileHeight: number | null;
}): MapDimensions {
  const tiles = mapTileDimensions(map);
  return {
    chunkSize: map.chunkSize ?? 32,
    tileWidth: tiles.tileWidth,
    tileHeight: tiles.tileHeight,
  };
}

export function broadcastCollisionUpdates(
  tenantSlug: string,
  mapId: string,
  mapName: string,
  updates: ChunkUpdateResult[],
): void {
  if (updates.length > 0) {
    broadcastMapUpdate(tenantSlug, 'chunks_updated', {
      mapId,
      mapName,
      layer: 'collision',
      updates,
    });
  }
}

export function persistMapObject(prisma: MapDb, mapId: string, data: MapObjectWriteData, chunkSize: number) {
  const chunkX = Math.floor(data.tileX / chunkSize);
  const chunkY = Math.floor(data.tileY / chunkSize);
  return prisma.mapObject.create({
    data: {
      mapId,
      assetPackUuid: data.assetPackUuid,
      itemId: data.itemId,
      category: data.category,
      tileX: data.tileX,
      tileY: data.tileY,
      chunkX,
      chunkY,
      width: data.width,
      height: data.height,
      collide: data.collide,
      zIndex: data.zIndex ?? 0,
      rotation: data.rotation ?? 0,
      flipX: data.flipX ?? false,
      flipY: data.flipY ?? false,
      scaleFactor: data.scaleFactor ?? 1,
      dataUrl: data.dataUrl,
      collisionBaseHeight: data.collisionBaseHeight ?? 0,
      renderLayer: data.renderLayer ?? 'sorted',
    },
  });
}

export function snapshotObjectDataUrl(
  pack: { terrain: unknown; structures: unknown; objects: unknown },
  itemId: string,
  category: string,
): string | null {
  const source =
    category === 'terrain'
      ? pack.terrain
      : category === 'structures' || category === 'structure'
        ? pack.structures
        : pack.objects;
  if (!Array.isArray(source)) return null;
  const entries: unknown[] = source;
  const item = entries.find((candidate): candidate is { id: string; dataURL: string } => {
    if (typeof candidate !== 'object' || candidate === null) return false;
    const record = candidate as Record<string, unknown>;
    return record.id === itemId && typeof record.dataURL === 'string';
  });
  if (!item) return null;
  return item.dataURL;
}

export type CreatedMapObjectResult = {
  obj: Awaited<ReturnType<typeof persistMapObject>>;
  collisionUpdates: Awaited<ReturnType<typeof reconcileObjectCollision>>;
};

export async function persistCreatedMapObject(
  prisma: PrismaClient,
  mapId: string,
  data: MapObjectWriteData,
  dims: MapDimensions,
  scope: PackScope,
): Promise<CreatedMapObjectResult | null> {
  return runSerializable(prisma, async (tx) => {
    await acquireMapAdvisoryLock(tx, mapId);
    if (data.collide) {
      (await MapCollisionBudget.forMap(tx, mapId, dims)).add(data, dims);
    }
    await acquirePackAdvisoryLock(tx, data.assetPackUuid);
    const currentScope = await refreshPackScope(tx, scope, 'asset');
    const currentPack = await tx.assetPack.findFirst({
      where: { uuid: data.assetPackUuid, ...assetPackScopeWhere(currentScope) },
      select: { terrain: true, structures: true, objects: true },
    });
    if (!currentPack) return null;
    const dataUrl = snapshotObjectDataUrl(currentPack, data.itemId, data.category);
    if (!dataUrl) return null;
    const snapshot = { ...data, dataUrl };
    const obj = await persistMapObject(tx, mapId, snapshot, dims.chunkSize);
    const collisionUpdates = snapshot.collide ? await reconcileObjectCollision(tx, mapId, dims, [snapshot]) : [];
    return { obj, collisionUpdates };
  });
}
