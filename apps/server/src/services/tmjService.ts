import { z } from 'zod';
import {
  tileRefIdFrom,
  splitTileRefId,
  rleEncodeNumbers,
  rleEncodeBooleans,
  encodeRlePairsToBuffer,
  decodeRlePairsFromBuffer,
  rleDecodeToNumbers,
  rleDecodeToBooleans,
} from '../mapEncoding.js';

// ---------------------------------------------------------------------------
// Zod Schemas (TMJ validation)
// ---------------------------------------------------------------------------

export const TmjTilesetSchema = z.object({
  firstgid: z.number().int().positive(),
  name: z.string(),
  image: z.string(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  margin: z.number().int().nonnegative().optional(),
  spacing: z.number().int().nonnegative().optional(),
  tilecount: z.number().int().nonnegative().optional(),
  columns: z.number().int().nonnegative().optional(),
  imagewidth: z.number().int().positive().optional(),
  imageheight: z.number().int().positive().optional(),
});

export const TmjObjectSchema = z.object({
  id: z.number().optional(),
  name: z.string().default(''),
  type: z.string().default(''),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  gid: z.number().optional(),
  polygon: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
  properties: z.array(z.any()).optional(),
});

export const TmjLayerSchema = z.object({
  name: z.string(),
  type: z.string(),
  data: z.array(z.number()).optional(),
  objects: z.array(TmjObjectSchema).optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
});

export const TmjSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  tilewidth: z.number().int().positive(),
  tileheight: z.number().int().positive(),
  tilesets: z.array(TmjTilesetSchema),
  layers: z.array(TmjLayerSchema),
  orientation: z.string().optional(),
});

export type Tmj = z.infer<typeof TmjSchema>;
export type TmjTileset = z.infer<typeof TmjTilesetSchema>;
export type TmjLayer = z.infer<typeof TmjLayerSchema>;
export type TmjObject = z.infer<typeof TmjObjectSchema>;

// ---------------------------------------------------------------------------
// GID ↔ TileRefId conversion
// ---------------------------------------------------------------------------

export type SlotMapping = { firstgid: number; slot: number };

export function buildGidToSlotMapping(
  slotAssignments: Array<{ firstgid: number; slot: number }>
): { firstGids: number[]; toSlot: SlotMapping[] } {
  const sorted = [...slotAssignments].sort((a, b) => a.firstgid - b.firstgid);
  return {
    firstGids: sorted.map(s => s.firstgid),
    toSlot: sorted,
  };
}

export function gidToTileRefId(
  gid: number,
  firstGids: number[],
  toSlot: SlotMapping[]
): number {
  if (!gid || gid <= 0) return 0;
  let chosen = -1;
  for (let i = 0; i < firstGids.length; i++) {
    const next = firstGids[i + 1] ?? Number.MAX_SAFE_INTEGER;
    if (gid >= firstGids[i] && gid < next) { chosen = i; break; }
  }
  if (chosen < 0) return 0;
  const base = firstGids[chosen];
  const slot = toSlot[chosen].slot;
  const tileIndex = gid - base;
  return tileRefIdFrom(slot, tileIndex);
}

// ---------------------------------------------------------------------------
// Server-side FirstGid computation (for export)
// ---------------------------------------------------------------------------

export function computeFirstGidsFromTileCounts(
  tilesets: Array<{ slot: number; tileCount: number | null }>
): number[] {
  const sorted = [...tilesets].sort((a, b) => a.slot - b.slot);
  const firstGids: number[] = [];
  let acc = 1; // Tiled GIDs start at 1
  for (const ts of sorted) {
    firstGids[ts.slot] = acc;
    acc += ts.tileCount ?? 1024; // Fallback 1024 if unknown
  }
  return firstGids;
}

// ---------------------------------------------------------------------------
// TileRefId → GID (inverse for export)
// ---------------------------------------------------------------------------

export function tileRefIdToGid(tileRefId: number, firstGids: number[]): number {
  if (!tileRefId || tileRefId <= 0) return 0;
  const { slot, tileIndex } = splitTileRefId(tileRefId);
  const fg = firstGids[slot];
  if (fg === undefined) return 0;
  return fg + tileIndex;
}

// ---------------------------------------------------------------------------
// Layer matching
// ---------------------------------------------------------------------------

export type V2LayerInfo = { v2Name: string; encoding: 'rle' | 'rle-bool' };

export function matchTmjLayerToV2(layerName: string): V2LayerInfo | null {
  const lower = layerName.toLowerCase();
  if (lower.includes('collision')) return { v2Name: 'collision', encoding: 'rle-bool' };
  if (lower.includes('wall')) return { v2Name: 'walls', encoding: 'rle' };
  if (lower.includes('ground')) return { v2Name: 'ground', encoding: 'rle' };
  return null;
}

// ---------------------------------------------------------------------------
// Batch GID → TileRefId
// ---------------------------------------------------------------------------

export function flatGidsToTileRefIds(
  data: number[],
  encoding: 'rle' | 'rle-bool',
  firstGids: number[],
  toSlot: SlotMapping[]
): number[] {
  return data.map(gid => {
    if (encoding === 'rle-bool') return gid > 0 ? 1 : 0;
    return gidToTileRefId(gid, firstGids, toSlot);
  });
}

// ---------------------------------------------------------------------------
// Chunking + Encoding (Import)
// ---------------------------------------------------------------------------

export type EncodedChunk = { cx: number; cy: number; data: Buffer; encoding: string };

export function chunkAndEncode(
  tileRefs: number[],
  mapWidth: number,
  mapHeight: number,
  chunkSize: number,
  encoding: 'rle' | 'rle-bool'
): EncodedChunk[] {
  const chunksX = Math.ceil(mapWidth / chunkSize);
  const chunksY = Math.ceil(mapHeight / chunkSize);
  const result: EncodedChunk[] = [];

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const values: number[] = [];
      for (let y = 0; y < chunkSize; y++) {
        const gy = cy * chunkSize + y;
        if (gy >= mapHeight) {
          for (let x = 0; x < chunkSize; x++) values.push(0);
          continue;
        }
        for (let x = 0; x < chunkSize; x++) {
          const gx = cx * chunkSize + x;
          if (gx >= mapWidth) { values.push(0); continue; }
          values.push(tileRefs[gy * mapWidth + gx] || 0);
        }
      }

      const pairs = encoding === 'rle'
        ? rleEncodeNumbers(values)
        : rleEncodeBooleans(values.map(v => v === 1));
      result.push({ cx, cy, data: encodeRlePairsToBuffer(pairs), encoding });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Decode Chunks → Flat (Export)
// ---------------------------------------------------------------------------

export function decodeChunksToFlat(
  chunks: Array<{ x: number; y: number; encoding: string; data: Buffer }>,
  mapWidth: number,
  mapHeight: number,
  chunkSize: number
): number[] {
  const flat = new Array(mapWidth * mapHeight).fill(0);
  const total = chunkSize * chunkSize;

  for (const chunk of chunks) {
    const pairs = decodeRlePairsFromBuffer(Buffer.from(chunk.data));
    const values = chunk.encoding === 'rle-bool'
      ? rleDecodeToBooleans(pairs, total).map(b => b ? 1 : 0)
      : rleDecodeToNumbers(pairs, total);

    for (let y = 0; y < chunkSize; y++) {
      const gy = chunk.y * chunkSize + y;
      if (gy >= mapHeight) continue;
      for (let x = 0; x < chunkSize; x++) {
        const gx = chunk.x * chunkSize + x;
        if (gx >= mapWidth) continue;
        flat[gy * mapWidth + gx] = values[y * chunkSize + x];
      }
    }
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Zone/Spawn extraction (Import)
// ---------------------------------------------------------------------------

export type ExtractedZone = {
  name: string;
  capacity: number | null;
  polygon: Array<{ x: number; y: number }>;
};

export function extractZonesFromObjectLayers(layers: TmjLayer[]): ExtractedZone[] {
  const zones: ExtractedZone[] = [];
  for (const layer of layers) {
    if (layer.type !== 'objectgroup' || !layer.objects) continue;
    for (const obj of layer.objects) {
      if (obj.type?.toLowerCase() === 'spawn' || obj.name?.toLowerCase() === 'spawn') continue;
      let polygon: Array<{ x: number; y: number }> | null = null;
      if (obj.polygon && obj.polygon.length > 0) {
        polygon = obj.polygon.map(p => ({ x: obj.x + p.x, y: obj.y + p.y }));
      } else if (obj.width && obj.height) {
        polygon = [
          { x: obj.x, y: obj.y },
          { x: obj.x + obj.width, y: obj.y },
          { x: obj.x + obj.width, y: obj.y + obj.height },
          { x: obj.x, y: obj.y + obj.height },
        ];
      }
      if (polygon && polygon.length > 0) {
        const capacityProp = obj.properties?.find((p: any) => p.name === 'capacity');
        zones.push({
          name: obj.name || `Zone_${zones.length}`,
          capacity: capacityProp ? Number(capacityProp.value) : null,
          polygon,
        });
      }
    }
  }
  return zones;
}

export function extractSpawnFromObjectLayers(layers: TmjLayer[]): { x: number; y: number } | null {
  for (const layer of layers) {
    if (layer.type !== 'objectgroup' || !layer.objects) continue;
    for (const obj of layer.objects) {
      if (obj.type?.toLowerCase() === 'spawn' || obj.name?.toLowerCase() === 'spawn') {
        return { x: obj.x, y: obj.y };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// TMJ Export Builder
// ---------------------------------------------------------------------------

export type BuildTmjParams = {
  mapWidth: number;
  mapHeight: number;
  tileWidth: number;
  tileHeight: number;
  tilesets: Array<{
    slot: number;
    key: string;
    imageUrl: string;
    tileWidth: number;
    tileHeight: number;
    margin?: number | null;
    spacing?: number | null;
    tileCount: number | null;
  }>;
  layers: Array<{
    name: string;
    encoding: string;
    chunks: Array<{ x: number; y: number; encoding: string; data: Buffer }>;
    chunkSize: number;
  }>;
  zones?: ExtractedZone[];
  spawn?: { x: number; y: number } | null;
};

function buildTmjTilesets(
  tilesets: BuildTmjParams['tilesets'],
  firstGids: number[],
): TmjTileset[] {
  const sortedTilesets = [...tilesets].sort((a, b) => a.slot - b.slot);
  return sortedTilesets.map(ts => ({
    firstgid: firstGids[ts.slot] ?? 1,
    name: ts.key,
    image: ts.imageUrl,
    tilewidth: ts.tileWidth,
    tileheight: ts.tileHeight,
    margin: ts.margin ?? 0,
    spacing: ts.spacing ?? 0,
    tilecount: ts.tileCount ?? undefined,
    columns: undefined,
    imagewidth: undefined,
    imageheight: undefined,
  }));
}

function buildTmjTileLayers(
  layers: BuildTmjParams['layers'],
  mapWidth: number,
  mapHeight: number,
  firstGids: number[],
): TmjLayer[] {
  const tmjLayers: TmjLayer[] = [];
  for (const layer of layers) {
    const flat = decodeChunksToFlat(layer.chunks, mapWidth, mapHeight, layer.chunkSize);
    const gids = flat.map(ref => {
      if (layer.encoding === 'rle-bool') return ref > 0 ? 1 : 0;
      return tileRefIdToGid(ref, firstGids);
    });
    tmjLayers.push({
      name: layer.name,
      type: 'tilelayer',
      data: gids,
      width: mapWidth,
      height: mapHeight,
    });
  }
  return tmjLayers;
}

function appendZoneObjectLayer(tmjLayers: TmjLayer[], zones: ExtractedZone[]) {
  const objects: TmjObject[] = zones.map((z, i) => ({
    id: i + 1,
    name: z.name,
    type: 'zone',
    x: z.polygon[0]?.x ?? 0,
    y: z.polygon[0]?.y ?? 0,
    polygon: z.polygon.map(p => ({
      x: p.x - (z.polygon[0]?.x ?? 0),
      y: p.y - (z.polygon[0]?.y ?? 0),
    })),
  }));
  tmjLayers.push({
    name: 'zones',
    type: 'objectgroup',
    objects,
  });
}

function appendSpawnObject(tmjLayers: TmjLayer[], spawn: { x: number; y: number }) {
  const existingObjLayer = tmjLayers.find(l => l.type === 'objectgroup');
  const spawnObj: TmjObject = {
    id: 9999,
    name: 'spawn',
    type: 'spawn',
    x: spawn.x,
    y: spawn.y,
  };
  if (existingObjLayer && existingObjLayer.objects) {
    existingObjLayer.objects.push(spawnObj);
  } else {
    tmjLayers.push({
      name: 'objects',
      type: 'objectgroup',
      objects: [spawnObj],
    });
  }
}

export function buildTmjFromV2(params: BuildTmjParams): Tmj {
  const { mapWidth, mapHeight, tileWidth, tileHeight, tilesets, layers, zones, spawn } = params;

  const firstGids = computeFirstGidsFromTileCounts(
    tilesets.map(ts => ({ slot: ts.slot, tileCount: ts.tileCount }))
  );

  const tmjTilesets = buildTmjTilesets(tilesets, firstGids);
  const tmjLayers = buildTmjTileLayers(layers, mapWidth, mapHeight, firstGids);

  if (zones && zones.length > 0) {
    appendZoneObjectLayer(tmjLayers, zones);
  }

  if (spawn) {
    appendSpawnObject(tmjLayers, spawn);
  }

  return {
    width: mapWidth,
    height: mapHeight,
    tilewidth: tileWidth,
    tileheight: tileHeight,
    tilesets: tmjTilesets,
    layers: tmjLayers,
  };
}
