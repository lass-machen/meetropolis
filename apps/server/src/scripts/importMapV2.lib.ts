/**
 * Library half of the v2 map importer.
 *
 * Reads a Tiled JSON (TMJ) file and persists its tile layers, object
 * groups and tileset registry into the database for the given tenant.
 * This module is intentionally side-effect-free at import time so it can
 * be called from `prisma db seed` and the CLI wrapper alike.
 *
 * The schema mirrors the public `/maps/:id/objects` REST contract used
 * by the editor: each Tiled object becomes one `MapObject` row carrying
 * the seven custom properties the editor and renderer expect
 * (assetPackUuid, itemId, category, collide, tileX, tileY, footprintW,
 * footprintH). Older TMJ files without those properties fall back to
 * deriving tileX/tileY from the Tiled bottom-anchored pixel coords.
 */
import fs from 'fs/promises';
import type { PrismaClient } from '../generated/prisma/index.js';
import { encodeRlePairsToBuffer, rleEncodeBooleans, rleEncodeNumbers, tileRefIdFrom } from '../mapEncoding.js';

export type TmjTileset = {
  firstgid: number;
  name: string;
  image: string;
  tilewidth: number;
  tileheight: number;
  margin?: number;
  spacing?: number;
  tilecount?: number;
};

export type TmjLayer = {
  name: string;
  type: string;
  data?: number[];
  width?: number;
  height?: number;
  objects?: TmjObject[];
};

export type TmjProperty = { name: string; type?: string; value: unknown };

export type TmjObject = {
  id?: number;
  gid?: number;
  name?: string;
  type?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  properties?: TmjProperty[];
};

export type Tmj = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TmjTileset[];
  layers: TmjLayer[];
  properties?: TmjProperty[];
};

function readProp<T = unknown>(props: TmjProperty[] | undefined, name: string): T | undefined {
  if (!props) return undefined;
  const p = props.find((entry) => entry.name === name);
  return p ? (p.value as T) : undefined;
}

/**
 * Read the map's default spawn from the TMJ top-level custom properties
 * (`spawnX` / `spawnY`). Tiled authors these as pixel coordinates, which is
 * exactly what the runtime consumes: `WorldRoom` reads `Map.meta.spawn.{x,y}`
 * and sanitizes it against the map's pixel bounds (see
 * rooms/lifecycle/onCreateSetup.ts -> loadInitialSpawn). No unit conversion.
 * Returns undefined when either coordinate is missing or not numeric.
 */
export function readSpawnFromProperties(props: TmjProperty[] | undefined): { x: number; y: number } | undefined {
  const x = readProp<number>(props, 'spawnX');
  const y = readProp<number>(props, 'spawnY');
  if (typeof x === 'number' && typeof y === 'number') {
    return { x, y };
  }
  return undefined;
}

/**
 * Persist the TMJ spawn into `Map.meta.spawn`. The v2 importer otherwise never
 * writes the spawn, so without this the DB map keeps the schema default and the
 * `spawnX`/`spawnY` map properties are silently dropped. Merges into existing
 * meta (preserving other keys); a re-import of the template is authoritative
 * for the spawn.
 */
export async function persistSpawnFromTmj(
  prisma: PrismaClient,
  map: { id: string; meta: unknown },
  tmj: Tmj,
): Promise<void> {
  const spawn = readSpawnFromProperties(tmj.properties);
  if (!spawn) return;
  const currentMeta = (map.meta as Record<string, unknown>) || {};
  await prisma.map.update({
    where: { id: map.id },
    data: { meta: { ...currentMeta, spawn } },
  });
}

function upsertMap(prisma: PrismaClient, tenantId: string, mapName: string, tmj: Tmj, chunkSize: number) {
  return prisma.map.upsert({
    where: { tenantId_name: { tenantId, name: mapName } },
    create: {
      name: mapName,
      meta: {},
      width: tmj.width,
      height: tmj.height,
      tileWidth: tmj.tilewidth,
      tileHeight: tmj.tileheight,
      chunkSize,
      tenant: { connect: { id: tenantId } },
    },
    update: {
      width: tmj.width,
      height: tmj.height,
      tileWidth: tmj.tilewidth,
      tileHeight: tmj.tileheight,
      chunkSize,
    },
  });
}

async function rebuildTilesetRegistry(prisma: PrismaClient, mapId: string, tilesets: TmjTileset[]) {
  await prisma.mapTileset.deleteMany({ where: { mapId } });
  for (let i = 0; i < tilesets.length; i++) {
    const t = tilesets[i];
    await prisma.mapTileset.create({
      data: {
        mapId,
        slot: i,
        key: t.name,
        imageUrl: t.image,
        tileWidth: t.tilewidth,
        tileHeight: t.tileheight,
        margin: t.margin ?? 0,
        spacing: t.spacing ?? 0,
        tileCount: t.tilecount ?? null,
      },
    });
  }
}

function makeGidConverter(tilesets: TmjTileset[]) {
  const sortedByFirstGid = [...tilesets].sort((a, b) => a.firstgid - b.firstgid);
  const firstGids = sortedByFirstGid.map((ts) => ts.firstgid);
  const toSlot: Array<{ firstgid: number; slot: number }> = sortedByFirstGid.map((ts) => ({
    firstgid: ts.firstgid,
    slot: tilesets.findIndex((t) => t.firstgid === ts.firstgid),
  }));

  return function gidToTileRefId(gid: number): number {
    if (!gid || gid <= 0) return 0;
    let chosen = -1;
    for (let i = 0; i < firstGids.length; i++) {
      const fg = firstGids[i];
      const next = firstGids[i + 1] ?? Number.MAX_SAFE_INTEGER;
      if (gid >= fg && gid < next) {
        chosen = i;
        break;
      }
    }
    if (chosen < 0) return 0;
    const base = firstGids[chosen];
    const slot = toSlot[chosen].slot;
    const tileIndex = gid - base;
    return tileRefIdFrom(slot, tileIndex);
  };
}

async function clearExistingLayers(prisma: PrismaClient, mapId: string) {
  const existingLayers = await prisma.mapLayer.findMany({ where: { mapId } });
  for (const l of existingLayers) {
    await prisma.mapChunk.deleteMany({ where: { layerId: l.id } });
  }
  await prisma.mapLayer.deleteMany({ where: { mapId } });
}

function buildTileRefArray(
  tmjLayer: TmjLayer,
  width: number,
  height: number,
  enc: 'rle' | 'rle-bool',
  gidToTileRefId: (gid: number) => number,
): number[] {
  const total = width * height;
  const tileRefs: number[] = new Array<number>(total).fill(0);
  for (let i = 0; i < total; i++) {
    const gid = tmjLayer.data?.[i] || 0;
    if (enc === 'rle') tileRefs[i] = gidToTileRefId(gid);
    else tileRefs[i] = gid > 0 ? 1 : 0;
  }
  return tileRefs;
}

async function persistChunks(
  prisma: PrismaClient,
  layerId: string,
  tileRefs: number[],
  width: number,
  height: number,
  chunkSize: number,
  enc: 'rle' | 'rle-bool',
) {
  const chunksX = Math.ceil(width / chunkSize);
  const chunksY = Math.ceil(height / chunkSize);
  for (let cy = 0; cy < chunksY; cy++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const values: number[] = [];
      for (let y = 0; y < chunkSize; y++) {
        const gy = cy * chunkSize + y;
        if (gy >= height) {
          for (let x = 0; x < chunkSize; x++) values.push(0);
          continue;
        }
        for (let x = 0; x < chunkSize; x++) {
          const gx = cx * chunkSize + x;
          if (gx >= width) {
            values.push(0);
            continue;
          }
          const idx = gy * width + gx;
          values.push(tileRefs[idx] || 0);
        }
      }
      const pairs = enc === 'rle' ? rleEncodeNumbers(values) : rleEncodeBooleans(values.map((v) => v === 1));
      const buf = encodeRlePairsToBuffer(pairs);
      const u8 = new Uint8Array(buf);
      await prisma.mapChunk.create({ data: { layerId, x: cx, y: cy, version: 1, encoding: enc, data: u8 } });
    }
  }
}

async function importTileLayers(
  prisma: PrismaClient,
  mapId: string,
  tmj: Tmj,
  chunkSize: number,
  gidToTileRefId: (gid: number) => number,
) {
  const layersWanted = new Map<string, 'rle' | 'rle-bool'>([
    ['ground', 'rle'],
    ['walls', 'rle'],
    ['collision', 'rle-bool'],
  ]);

  for (const [layerName, enc] of layersWanted) {
    const tmjLayer = tmj.layers.find((l) => (l.name || '').toLowerCase().includes(layerName));
    const layer = await prisma.mapLayer.create({ data: { mapId, name: layerName, chunkSize } });
    if (!tmjLayer || !Array.isArray(tmjLayer.data)) continue;

    const width = tmjLayer.width || tmj.width;
    const height = tmjLayer.height || tmj.height;
    const tileRefs = buildTileRefArray(tmjLayer, width, height, enc, gidToTileRefId);
    await persistChunks(prisma, layer.id, tileRefs, width, height, chunkSize, enc);
  }
}

function resolveObjectFromProperties(obj: TmjObject): {
  assetPackUuid?: string;
  itemId?: string;
  category?: string;
  collide?: boolean;
  tileX?: number;
  tileY?: number;
  footprintW?: number;
  footprintH?: number;
  collisionBaseHeight?: number;
  renderLayer?: string;
} {
  const props = obj.properties;
  return {
    assetPackUuid: readProp<string>(props, 'assetPackUuid'),
    itemId: readProp<string>(props, 'itemId'),
    category: readProp<string>(props, 'category'),
    collide: readProp<boolean>(props, 'collide'),
    tileX: readProp<number>(props, 'tileX'),
    tileY: readProp<number>(props, 'tileY'),
    footprintW: readProp<number>(props, 'footprintW'),
    footprintH: readProp<number>(props, 'footprintH'),
    // Depth-layering (Strang B/C). Persisted so the client can render overhead
    // objects above actors and so later collision reconciles use the foot.
    collisionBaseHeight: readProp<number>(props, 'collisionBaseHeight'),
    renderLayer: readProp<string>(props, 'renderLayer'),
  };
}

function deriveTilePositionFromTiled(obj: TmjObject, tileWidthPx: number, tileHeightPx: number) {
  // Tiled tile-object anchor is the bottom-left in pixel coords. Convert
  // back to a top-left tile index.
  const tileX = Math.floor(obj.x / tileWidthPx);
  const tileY = Math.floor((obj.y - obj.height) / tileHeightPx);
  return { tileX, tileY };
}

async function importObjectGroup(
  prisma: PrismaClient,
  mapId: string,
  chunkSize: number,
  tileWidthPx: number,
  tileHeightPx: number,
  layer: TmjLayer,
) {
  if (!Array.isArray(layer.objects) || layer.objects.length === 0) return 0;
  let created = 0;

  // Group by assetPackUuid for fast existence checks. Objects from packs
  // that don't exist yet are still persisted; the seed registers the
  // pack before the importer runs, so a missing pack here usually
  // indicates a data bug worth surfacing as a console warning rather
  // than a hard crash.
  const seenPacks = new Set<string>();

  for (const obj of layer.objects) {
    const meta = resolveObjectFromProperties(obj);
    const fallback = deriveTilePositionFromTiled(obj, tileWidthPx, tileHeightPx);
    const assetPackUuid = meta.assetPackUuid ?? 'unknown-pack';
    const itemId = meta.itemId ?? obj.name ?? `gid-${obj.gid ?? 0}`;
    const category = meta.category ?? layer.name?.toLowerCase() ?? 'objects';
    const tileX = meta.tileX ?? fallback.tileX;
    const tileY = meta.tileY ?? fallback.tileY;
    const footprintW = meta.footprintW ?? Math.max(1, Math.round(obj.width / tileWidthPx));
    const footprintH = meta.footprintH ?? Math.max(1, Math.round(obj.height / tileHeightPx));
    const collide = meta.collide ?? false;
    const collisionBaseHeight = meta.collisionBaseHeight ?? 0;
    const renderLayer = meta.renderLayer === 'floor' || meta.renderLayer === 'overhead' ? meta.renderLayer : 'sorted';
    const chunkX = Math.floor(tileX / chunkSize);
    const chunkY = Math.floor(tileY / chunkSize);

    if (assetPackUuid !== 'unknown-pack' && !seenPacks.has(assetPackUuid)) {
      const exists = await prisma.assetPack.findUnique({ where: { uuid: assetPackUuid } });
      if (!exists) {
        console.warn(
          `[importMapV2] object refers to missing AssetPack '${assetPackUuid}'; importing anyway. Make sure the seed creates the pack first.`,
        );
      }
      seenPacks.add(assetPackUuid);
    }

    // Determine dataUrl: prefer a path that resolves to the on-disk PNG
    // for this single-tile object tileset.
    const dataUrl = inferObjectDataUrl(obj, layer.name, itemId);

    await prisma.mapObject.create({
      data: {
        mapId,
        assetPackUuid,
        itemId,
        category,
        tileX,
        tileY,
        chunkX,
        chunkY,
        width: obj.width,
        height: obj.height,
        collide,
        zIndex: 0,
        rotation: obj.rotation ?? 0,
        flipX: false,
        flipY: false,
        scaleFactor: 1,
        dataUrl,
        collisionBaseHeight,
        renderLayer,
      },
    });
    // Update footprint metadata via a follow-up update because the
    // current MapObject schema stores footprint indirectly via width /
    // height in pixels. We persist footprint as part of `meta` only if
    // the schema ever grows the column; for now it is implicit in width
    // / height. This keeps the seed-time importer working today without
    // a schema migration.
    void footprintW;
    void footprintH;
    created++;
  }
  return created;
}

/**
 * Try to construct the public `/assets/furniture/<GROUP>/<file>.png` URL
 * for a built-in pixel-agents object. We derive the directory from the
 * itemId prefix (e.g. `DESK_FRONT` -> `DESK/`) by stripping orientation
 * and state suffixes. Falls back to an empty string when nothing
 * sensible can be inferred; the editor handles missing dataUrls.
 */
function inferObjectDataUrl(_obj: TmjObject, _layerName: string, itemId: string): string {
  if (!itemId) return '';
  // Known direction/state suffixes to strip when computing the group.
  const SUFFIXES = ['_FRONT_OFF', '_FRONT_ON_1', '_FRONT_ON_2', '_FRONT_ON_3', '_FRONT', '_BACK', '_SIDE'];
  let group = itemId;
  for (const s of SUFFIXES) {
    if (group.endsWith(s)) {
      group = group.slice(0, -s.length);
      break;
    }
  }
  return `/assets/furniture/${group}/${itemId}.png`;
}

async function importObjectGroups(prisma: PrismaClient, mapId: string, tmj: Tmj, chunkSize: number) {
  let total = 0;
  for (const layer of tmj.layers) {
    if (layer.type !== 'objectgroup') continue;
    total += await importObjectGroup(prisma, mapId, chunkSize, tmj.tilewidth, tmj.tileheight, layer);
  }
  return total;
}

async function clearExistingObjects(prisma: PrismaClient, mapId: string) {
  await prisma.mapObject.deleteMany({ where: { mapId } });
}

/**
 * Read a TMJ file and import it into the given tenant's named map.
 * Idempotent: each call clears the previous layers + objects for that
 * map and rebuilds them from the file. Returns the count of objects
 * created.
 */
export async function importTmjIntoMap(
  prisma: PrismaClient,
  tenantId: string,
  mapName: string,
  tmjPath: string,
  chunkSize = 32,
): Promise<{ mapId: string; objectsCreated: number }> {
  const raw = await fs.readFile(tmjPath, 'utf8');
  const tmj = JSON.parse(raw) as Tmj;

  const map = await upsertMap(prisma, tenantId, mapName, tmj, chunkSize);
  await persistSpawnFromTmj(prisma, map, tmj);
  await rebuildTilesetRegistry(prisma, map.id, tmj.tilesets);

  const gidToTileRefId = makeGidConverter(tmj.tilesets);

  await clearExistingLayers(prisma, map.id);
  await clearExistingObjects(prisma, map.id);

  await importTileLayers(prisma, map.id, tmj, chunkSize, gidToTileRefId);
  const objectsCreated = await importObjectGroups(prisma, map.id, tmj, chunkSize);

  return { mapId: map.id, objectsCreated };
}
