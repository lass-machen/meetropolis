import { PrismaClient } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
  encodeRlePairsToBuffer,
} from '../../mapEncoding.js';

export interface CollisionTile {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/**
 * Compute all tile positions covered by an object's COLLISION footprint.
 * Returns local chunk coords so we can batch by chunk.
 *
 * `collisionBaseTiles` (Strang B) restricts collision to the bottom N tile rows
 * of the footprint — e.g. a plant collides only on its pot, not its crown:
 *   - 0 (sentinel, B-DP1): the FULL footprint collides (legacy behaviour).
 *   - N > 0: only the bottom N rows collide.
 *
 * The base is TILE-FIXED (B-DP6): it is an absolute row count that does NOT
 * scale with the sprite's scaleFactor (a pot is physically fixed even when the
 * sprite is drawn 2x). `heightPx` may already be scaled by the caller, growing
 * `tilesH`; the base stays put and is clamped to `tilesH` so it can never
 * underflow the start row.
 */
export function computeFootprintTiles(
  tileX: number,
  tileY: number,
  widthPx: number,
  heightPx: number,
  tileWidth: number,
  tileHeight: number,
  chunkSize: number,
  collisionBaseTiles = 0,
): CollisionTile[] {
  const tilesW = Math.ceil(widthPx / tileWidth);
  const tilesH = Math.ceil(heightPx / tileHeight);
  const baseRows = collisionBaseTiles > 0 ? Math.min(collisionBaseTiles, tilesH) : tilesH;
  const startDy = tilesH - baseRows;
  const tiles: CollisionTile[] = [];
  for (let dy = startDy; dy < tilesH; dy++) {
    for (let dx = 0; dx < tilesW; dx++) {
      const tx = tileX + dx;
      const ty = tileY + dy;
      const cx = Math.floor(tx / chunkSize);
      const cy = Math.floor(ty / chunkSize);
      const rx = ((tx % chunkSize) + chunkSize) % chunkSize;
      const ry = ((ty % chunkSize) + chunkSize) % chunkSize;
      tiles.push({ cx, cy, rx, ry });
    }
  }
  return tiles;
}

/** Group tiles by chunk key */
function groupByChunk(tiles: CollisionTile[]): Map<string, CollisionTile[]> {
  const map = new Map<string, CollisionTile[]>();
  for (const t of tiles) {
    const key = `${t.cx}:${t.cy}`;
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  }
  return map;
}

export interface ChunkUpdateResult {
  key: string;
  version: number;
  encoding: string;
  data: string;
}

/**
 * Apply or remove collision for a set of tiles.
 * Returns list of updated chunk keys for broadcasting.
 */
export async function updateCollisionChunks(
  prisma: PrismaClient,
  mapId: string,
  chunkSize: number,
  tiles: CollisionTile[],
  setTo: boolean,
): Promise<ChunkUpdateResult[]> {
  const grouped = groupByChunk(tiles);
  const collisionLayerName = 'collision';

  let layer = await prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId, name: collisionLayerName } },
  });
  if (!layer) {
    layer = await prisma.mapLayer.create({
      data: { mapId, name: collisionLayerName, chunkSize },
    });
  }

  const totalPerChunk = chunkSize * chunkSize;
  const updates: ChunkUpdateResult[] = [];

  for (const [key, chunkTiles] of grouped.entries()) {
    const [cxs, cys] = key.split(':');
    const cx = Number(cxs);
    const cy = Number(cys);

    const existing = await prisma.mapChunk.findUnique({
      where: { layerId_x_y: { layerId: layer.id, x: cx, y: cy } },
    });

    let decoded: boolean[];
    if (existing) {
      // Prisma Buffer fields are typed as Buffer<any>; copy through Uint8Array to land
      // on Buffer<ArrayBufferLike> which the decoder expects.
      const raw: unknown = existing.data;
      const bytes = raw instanceof Buffer ? new Uint8Array(raw) : (raw as Uint8Array);
      const buf = Buffer.from(bytes);
      const pairs = decodeRlePairsFromBuffer(buf);
      decoded = rleDecodeToBooleans(pairs, totalPerChunk);
    } else {
      decoded = new Array<boolean>(totalPerChunk).fill(false);
    }

    let modified = false;
    for (const t of chunkTiles) {
      const idx = t.ry * chunkSize + t.rx;
      if (decoded[idx] !== setTo) {
        decoded[idx] = setTo;
        modified = true;
      }
    }

    if (!modified) continue;

    const pairs = rleEncodeBooleans(decoded);
    const buf = encodeRlePairsToBuffer(pairs);
    const u8 = new Uint8Array(buf);

    let chunk;
    if (!existing) {
      chunk = await prisma.mapChunk.create({
        data: { layerId: layer.id, x: cx, y: cy, version: 1, encoding: 'rle-bool', data: u8 },
      });
    } else {
      chunk = await prisma.mapChunk.update({
        where: { id: existing.id },
        data: { version: existing.version + 1, encoding: 'rle-bool', data: u8 },
      });
    }

    updates.push({ key, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
  }

  return updates;
}

/**
 * Remove collision for an object, then re-apply collision for any
 * other collidable objects that overlap the same tiles.
 */
export async function removeCollisionAndReconcile(
  prisma: PrismaClient,
  mapId: string,
  chunkSize: number,
  tileWidth: number,
  tileHeight: number,
  removedObj: { tileX: number; tileY: number; width: number; height: number; collisionBaseHeight?: number },
): Promise<ChunkUpdateResult[]> {
  const footprint = computeFootprintTiles(
    removedObj.tileX,
    removedObj.tileY,
    removedObj.width,
    removedObj.height,
    tileWidth,
    tileHeight,
    chunkSize,
    removedObj.collisionBaseHeight ?? 0,
  );

  // Clear collision for the removed object
  const updates = await updateCollisionChunks(prisma, mapId, chunkSize, footprint, false);

  // Find overlapping collidable objects and re-apply their collision
  const chunkKeys = groupByChunk(footprint);
  const chunkCoords = Array.from(chunkKeys.keys()).map((k) => {
    const [x, y] = k.split(':').map(Number);
    return { chunkX: x, chunkY: y };
  });

  if (chunkCoords.length === 0) return updates;

  const overlapping = await prisma.mapObject.findMany({
    where: {
      mapId,
      collide: true,
      OR: chunkCoords.map((c) => ({ chunkX: c.chunkX, chunkY: c.chunkY })),
    },
  });

  if (overlapping.length === 0) return updates;

  // Collect all tiles that need to be re-set to true. Each neighbour is re-baked
  // with ITS OWN collisionBaseHeight (loaded on the full row above). Unmigrated
  // rows carry the sentinel 0 (= full footprint), so a reconcile never silently
  // shrinks an untouched full-rect neighbour to a foot; only rows that already
  // opted into a foot (>0) re-bake as a foot (plan §3 silent-partial).
  const reapplyTiles: CollisionTile[] = [];
  for (const obj of overlapping) {
    const sf = obj.scaleFactor ?? 1;
    const objTiles = computeFootprintTiles(
      obj.tileX,
      obj.tileY,
      obj.width * sf,
      obj.height * sf,
      tileWidth,
      tileHeight,
      chunkSize,
      obj.collisionBaseHeight ?? 0,
    );
    reapplyTiles.push(...objTiles);
  }

  const reapplyUpdates = await updateCollisionChunks(prisma, mapId, chunkSize, reapplyTiles, true);

  // Merge: reapply updates override initial removal for same chunk keys
  const mergedMap = new Map<string, ChunkUpdateResult>();
  for (const u of updates) mergedMap.set(u.key, u);
  for (const u of reapplyUpdates) mergedMap.set(u.key, u);

  return Array.from(mergedMap.values());
}
