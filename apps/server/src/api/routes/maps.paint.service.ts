import type { MapAutotile } from '../../generated/prisma/index.js';
import type { AutotileSnapshot } from '../utils/mapAutotilePalette.js';
import { allocateMapAutotileInTransaction, mapAutotileRegistration } from '../utils/mapAutotilePalette.js';
import { MANUAL_COLLISION_LAYER, reconcileCollisionTiles, rectCollisionTiles } from '../utils/collisionReconciler.js';
import {
  collectChunkCoords,
  decodeChunk,
  getOrCreateMapLayer,
  loadChunks,
  persistChunk,
  runSerializable,
  type ChunkEncoding,
  type ChunkUpdateResult,
  type MapDb,
  type StoredChunk,
} from '../utils/mapChunkMutations.js';
import type { PaintRequest } from './maps.paint.schema.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

export interface PaintResult {
  updates: ChunkUpdateResult[];
  collisionUpdates?: ChunkUpdateResult[];
  paletteEntry?: ReturnType<typeof mapAutotileRegistration>;
  paletteEntryCreated: boolean;
}

function paintChunkValues(params: {
  existing: StoredChunk | undefined;
  chunkSize: number;
  encoding: ChunkEncoding;
  paint: PaintRequest;
  tileRefId: number | undefined;
  chunkX: number;
  chunkY: number;
}): { values: number[]; modified: boolean } {
  const { existing, chunkSize, encoding, paint, tileRefId, chunkX, chunkY } = params;
  const values = decodeChunk(existing, chunkSize, encoding);
  const rectWidth = paint.rect.x1 - paint.rect.x0 + 1;
  let modified = false;
  for (let y = paint.rect.y0; y <= paint.rect.y1; y++) {
    for (let x = paint.rect.x0; x <= paint.rect.x1; x++) {
      if (Math.floor(x / chunkSize) !== chunkX || Math.floor(y / chunkSize) !== chunkY) continue;
      const rx = ((x % chunkSize) + chunkSize) % chunkSize;
      const ry = ((y % chunkSize) + chunkSize) % chunkSize;
      const valueIndex = (y - paint.rect.y0) * rectWidth + (x - paint.rect.x0);
      const next = paint.erase ? 0 : (paint.values?.[valueIndex] ?? tileRefId ?? 0);
      const index = ry * chunkSize + rx;
      if (values[index] === next) continue;
      values[index] = next;
      modified = true;
    }
  }
  return { values, modified };
}

async function persistPaintLayer(
  tx: MapDb,
  mapId: string,
  defaultChunkSize: number,
  paint: PaintRequest,
  tileRefId: number | undefined,
): Promise<ChunkUpdateResult[]> {
  const storedLayerName = paint.layer === 'collision' ? MANUAL_COLLISION_LAYER : paint.layer;
  const layer = await getOrCreateMapLayer(tx, mapId, storedLayerName, defaultChunkSize);
  const encoding: ChunkEncoding = paint.layer === 'collision' ? 'rle-bool' : 'rle';
  const coords = collectChunkCoords(paint.rect, layer.chunkSize);
  const existing = await loadChunks(tx, layer.id, coords);
  const updates: ChunkUpdateResult[] = [];
  for (const coord of coords) {
    const key = `${coord.x}:${coord.y}`;
    const current = existing.get(key);
    const mutation = paintChunkValues({
      existing: current,
      chunkSize: layer.chunkSize,
      encoding,
      paint,
      tileRefId,
      chunkX: coord.x,
      chunkY: coord.y,
    });
    if (mutation.modified) updates.push(await persistChunk(tx, layer.id, coord, current, encoding, mutation.values));
  }
  return updates;
}

function publicUpdates(
  paint: PaintRequest,
  sourceUpdates: ChunkUpdateResult[],
  collisionUpdates: ChunkUpdateResult[],
): ChunkUpdateResult[] {
  return paint.layer === 'collision' ? collisionUpdates : sourceUpdates;
}

export async function executePaint(params: {
  prisma: PrismaClient;
  map: { id: string; chunkSize: number | null; tileWidth: number | null; tileHeight: number | null };
  paint: PaintRequest;
  autotileSnapshot: AutotileSnapshot | null;
}): Promise<PaintResult> {
  const { prisma, map, paint, autotileSnapshot } = params;
  return runSerializable(prisma, async (tx) => {
    let allocation: { entry: MapAutotile; created: boolean } | undefined;
    if (!paint.erase && paint.autotile && autotileSnapshot) {
      allocation = await allocateMapAutotileInTransaction(tx, map.id, paint.autotile, autotileSnapshot);
    }
    const tileRefId = allocation?.entry.slot ?? paint.tileRefId;
    const sourceUpdates = await persistPaintLayer(tx, map.id, map.chunkSize ?? 32, paint, tileRefId);
    const needsReconcile = ['collision', 'walls', 'walls_auto'].includes(paint.layer) && sourceUpdates.length > 0;
    const collisionUpdates = needsReconcile
      ? await reconcileCollisionTiles(
          tx,
          map.id,
          {
            chunkSize: map.chunkSize ?? 32,
            tileWidth: map.tileWidth ?? 16,
            tileHeight: map.tileHeight ?? 16,
          },
          rectCollisionTiles(paint.rect, map.chunkSize ?? 32),
          paint.layer === 'collision',
        )
      : [];
    return {
      updates: publicUpdates(paint, sourceUpdates, collisionUpdates),
      collisionUpdates: paint.layer !== 'collision' && collisionUpdates.length > 0 ? collisionUpdates : undefined,
      paletteEntry: allocation ? mapAutotileRegistration(allocation.entry) : undefined,
      paletteEntryCreated: allocation?.created ?? false,
    };
  });
}
