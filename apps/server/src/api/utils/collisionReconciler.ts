import type { Prisma } from '../../generated/prisma/index.js';
import { computeFootprintTiles, type CollisionTile } from './collisionHelpers.js';
import {
  chunkKey,
  decodeChunk,
  getOrCreateMapLayer,
  loadChunks,
  persistChunk,
  type ChunkCoord,
  type ChunkEncoding,
  type ChunkUpdateResult,
  type MapDb,
  type StoredChunk,
} from './mapChunkMutations.js';

export const MANUAL_COLLISION_LAYER = 'collision_manual';
export const DERIVED_COLLISION_LAYER = 'collision';

interface MapDimensions {
  chunkSize: number;
  tileWidth: number;
  tileHeight: number;
}

interface TilePosition {
  x: number;
  y: number;
}

interface LayerSource {
  chunkSize: number;
  encoding: ChunkEncoding;
  chunks: Map<string, StoredChunk>;
  decoded: Map<string, number[]>;
}

function globalTiles(tiles: CollisionTile[], chunkSize: number): TilePosition[] {
  const unique = new Map<string, TilePosition>();
  for (const tile of tiles) {
    const position = { x: tile.cx * chunkSize + tile.rx, y: tile.cy * chunkSize + tile.ry };
    unique.set(chunkKey(position.x, position.y), position);
  }
  return [...unique.values()];
}

function sourceCoords(tiles: TilePosition[], chunkSize: number): ChunkCoord[] {
  const unique = new Map<string, ChunkCoord>();
  for (const tile of tiles) {
    const coord = { x: Math.floor(tile.x / chunkSize), y: Math.floor(tile.y / chunkSize) };
    unique.set(chunkKey(coord.x, coord.y), coord);
  }
  return [...unique.values()];
}

async function loadLayerSource(
  db: MapDb,
  mapId: string,
  name: string,
  tiles: TilePosition[],
  encoding: ChunkEncoding,
): Promise<LayerSource | null> {
  const layer = await db.mapLayer.findUnique({ where: { mapId_name: { mapId, name } } });
  if (!layer) return null;
  return {
    chunkSize: layer.chunkSize,
    encoding,
    chunks: await loadChunks(db, layer.id, sourceCoords(tiles, layer.chunkSize)),
    decoded: new Map(),
  };
}

function sourceValue(source: LayerSource | null, tile: TilePosition): number {
  if (!source) return 0;
  const cx = Math.floor(tile.x / source.chunkSize);
  const cy = Math.floor(tile.y / source.chunkSize);
  const key = chunkKey(cx, cy);
  let values = source.decoded.get(key);
  if (!values) {
    values = decodeChunk(source.chunks.get(key), source.chunkSize, source.encoding);
    source.decoded.set(key, values);
  }
  const rx = ((tile.x % source.chunkSize) + source.chunkSize) % source.chunkSize;
  const ry = ((tile.y % source.chunkSize) + source.chunkSize) % source.chunkSize;
  return values[ry * source.chunkSize + rx] ?? 0;
}

function objectCollisionTiles(
  objects: Array<{
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    scaleFactor: number;
    collisionBaseHeight: number;
  }>,
  dims: MapDimensions,
): Set<string> {
  const occupied = new Set<string>();
  for (const object of objects) {
    const footprint = computeFootprintTiles(
      object.tileX,
      object.tileY,
      object.width * object.scaleFactor,
      object.height * object.scaleFactor,
      dims.tileWidth,
      dims.tileHeight,
      dims.chunkSize,
      object.collisionBaseHeight,
    );
    for (const tile of globalTiles(footprint, dims.chunkSize)) occupied.add(chunkKey(tile.x, tile.y));
  }
  return occupied;
}

function shouldCollide(params: {
  tile: TilePosition;
  manual: LayerSource | null;
  walls: LayerSource | null;
  autotiles: LayerSource | null;
  collidingSlots: ReadonlySet<number>;
  objectTiles: ReadonlySet<string>;
}): boolean {
  const { tile, manual, walls, autotiles, collidingSlots, objectTiles } = params;
  return (
    sourceValue(manual, tile) !== 0 ||
    sourceValue(walls, tile) !== 0 ||
    collidingSlots.has(sourceValue(autotiles, tile)) ||
    objectTiles.has(chunkKey(tile.x, tile.y))
  );
}

export async function reconcileCollisionTiles(
  db: MapDb,
  mapId: string,
  dims: MapDimensions,
  affected: CollisionTile[],
  includeUnchanged = false,
): Promise<ChunkUpdateResult[]> {
  const tiles = globalTiles(affected, dims.chunkSize);
  if (tiles.length === 0) return [];

  const [manual, walls, autotiles, palette, objects] = await Promise.all([
    loadLayerSource(db, mapId, MANUAL_COLLISION_LAYER, tiles, 'rle-bool'),
    loadLayerSource(db, mapId, 'walls', tiles, 'rle'),
    loadLayerSource(db, mapId, 'walls_auto', tiles, 'rle'),
    db.mapAutotile.findMany({ where: { mapId, collide: true }, select: { slot: true } }),
    db.mapObject.findMany({
      where: { mapId, collide: true },
      select: {
        tileX: true,
        tileY: true,
        width: true,
        height: true,
        scaleFactor: true,
        collisionBaseHeight: true,
      },
    }),
  ]);
  const collidingSlots = new Set(palette.map((entry) => entry.slot));
  const objectTiles = objectCollisionTiles(objects, dims);
  const layer = await getOrCreateMapLayer(db, mapId, DERIVED_COLLISION_LAYER, dims.chunkSize);
  const coords = sourceCoords(tiles, layer.chunkSize);
  const existingChunks = await loadChunks(db, layer.id, coords);
  const updates: ChunkUpdateResult[] = [];

  for (const coord of coords) {
    const key = chunkKey(coord.x, coord.y);
    const existing = existingChunks.get(key);
    const values = decodeChunk(existing, layer.chunkSize, 'rle-bool');
    let modified = false;
    for (const tile of tiles) {
      if (Math.floor(tile.x / layer.chunkSize) !== coord.x || Math.floor(tile.y / layer.chunkSize) !== coord.y)
        continue;
      const rx = ((tile.x % layer.chunkSize) + layer.chunkSize) % layer.chunkSize;
      const ry = ((tile.y % layer.chunkSize) + layer.chunkSize) % layer.chunkSize;
      const index = ry * layer.chunkSize + rx;
      const next = shouldCollide({ tile, manual, walls, autotiles, collidingSlots, objectTiles }) ? 1 : 0;
      if (values[index] === next) continue;
      values[index] = next;
      modified = true;
    }
    if (modified) {
      updates.push(await persistChunk(db, layer.id, coord, existing, 'rle-bool', values));
    } else if (includeUnchanged && existing) {
      updates.push({
        key,
        version: existing.version,
        encoding: existing.encoding,
        data: Buffer.from(existing.data).toString('base64'),
      });
    }
  }
  return updates;
}

export function rectCollisionTiles(rect: { x0: number; y0: number; x1: number; y1: number }, chunkSize: number) {
  const tiles: CollisionTile[] = [];
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      tiles.push({
        cx: Math.floor(x / chunkSize),
        cy: Math.floor(y / chunkSize),
        rx: ((x % chunkSize) + chunkSize) % chunkSize,
        ry: ((y % chunkSize) + chunkSize) % chunkSize,
      });
    }
  }
  return tiles;
}

export type CollisionTransaction = Prisma.TransactionClient;
