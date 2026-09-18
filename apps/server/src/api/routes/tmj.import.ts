import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import multer from 'multer';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import { reconcileCollisionTiles, rectCollisionTiles } from '../utils/collisionReconciler.js';
import { importedLayerStorageName, isReservedImportLayer } from '../utils/mapLayerPolicy.js';
import type { MapDb } from '../utils/mapChunkMutations.js';
import type { MulterFile, RequestWithMulterFields } from '../../types/multer.js';
import {
  TmjSchema,
  buildGidToSlotMapping,
  flatGidsToTileRefIds,
  matchTmjLayerToV2,
  chunkAndEncode,
  extractZonesFromObjectLayers,
  extractSpawnFromObjectLayers,
  type Tmj,
} from '../../services/tmjService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const importUpload = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'images', maxCount: 10 },
]);

function computeTileCount(t: {
  tilecount?: number;
  imagewidth?: number;
  imageheight?: number;
  tilewidth: number;
  tileheight: number;
  margin?: number;
  spacing?: number;
}): number | null {
  if (t.tilecount) return t.tilecount;
  if (!t.imagewidth || !t.imageheight) return null;
  const margin = t.margin ?? 0;
  const spacing = t.spacing ?? 0;
  const columns = Math.max(1, Math.floor((t.imagewidth - margin * 2 + spacing) / (t.tilewidth + spacing)));
  const rows = Math.max(1, Math.floor((t.imageheight - margin * 2 + spacing) / (t.tileheight + spacing)));
  return columns * rows;
}

function saveTilesetImage(images: MulterFile[], tilesetImage: string): string | null {
  const baseName = path.basename(tilesetImage);
  const file = images.find((candidate) => candidate.originalname === baseName);
  if (!file) return null;
  const tilesetsDir = path.resolve(__dirname, '../../../../public/assets/tilesets');
  if (!fs.existsSync(tilesetsDir)) fs.mkdirSync(tilesetsDir, { recursive: true });
  fs.writeFileSync(path.join(tilesetsDir, baseName), file.buffer);
  return `/assets/tilesets/${baseName}`;
}

async function clearExistingMapData(prisma: MapDb, mapId: string): Promise<void> {
  const existingLayers = await prisma.mapLayer.findMany({ where: { mapId } });
  for (const layer of existingLayers) {
    await prisma.mapChunk.deleteMany({ where: { layerId: layer.id } });
  }
  await prisma.mapLayer.deleteMany({ where: { mapId } });
  await prisma.mapTileset.deleteMany({ where: { mapId } });
}

async function registerImportedTilesets(
  prisma: MapDb,
  mapId: string,
  tmjTilesets: Tmj['tilesets'],
  images: MulterFile[],
): Promise<void> {
  for (let index = 0; index < tmjTilesets.length; index++) {
    const tileset = tmjTilesets[index];
    const uploadedUrl = saveTilesetImage(images, tileset.image);
    await prisma.mapTileset.create({
      data: {
        mapId,
        slot: index,
        key: tileset.name,
        imageUrl: uploadedUrl ?? tileset.image,
        tileWidth: tileset.tilewidth,
        tileHeight: tileset.tileheight,
        margin: tileset.margin ?? 0,
        spacing: tileset.spacing ?? 0,
        tileCount: computeTileCount(tileset),
      },
    });
  }
}

async function processTileLayers(
  prisma: MapDb,
  mapId: string,
  tmj: Tmj,
  chunkSize: number,
): Promise<{ warnings: string[]; layerCounts: Record<string, number> }> {
  const warnings: string[] = [];
  const layerCounts: Record<string, number> = {};
  const slotAssignments = tmj.tilesets.map((tileset, index) => ({ firstgid: tileset.firstgid, slot: index }));
  const { firstGids, toSlot } = buildGidToSlotMapping(slotAssignments);

  for (const tmjLayer of tmj.layers) {
    if (tmjLayer.type !== 'tilelayer' || !tmjLayer.data) continue;
    const match = matchTmjLayerToV2(tmjLayer.name);
    if (!match) {
      warnings.push(`Layer '${tmjLayer.name}' skipped: no V2 mapping`);
      continue;
    }
    const width = tmjLayer.width || tmj.width;
    const height = tmjLayer.height || tmj.height;
    const tileRefs = flatGidsToTileRefIds(tmjLayer.data, match.encoding, firstGids, toSlot);
    const chunks = chunkAndEncode(tileRefs, width, height, chunkSize, match.encoding);
    const layer = await prisma.mapLayer.create({
      data: { mapId, name: importedLayerStorageName(match.v2Name), chunkSize },
    });
    for (const chunk of chunks) {
      await prisma.mapChunk.create({
        data: {
          layerId: layer.id,
          x: chunk.cx,
          y: chunk.cy,
          version: 1,
          encoding: chunk.encoding,
          data: new Uint8Array(chunk.data),
        },
      });
    }
    layerCounts[match.v2Name] = chunks.length;
  }
  return { warnings, layerCounts };
}

async function processZones(
  prisma: MapDb,
  mapId: string,
  tenantId: string,
  layers: Tmj['layers'],
  mode: 'merge' | 'replace',
): Promise<number> {
  const extractedZones = extractZonesFromObjectLayers(layers);
  if (extractedZones.length === 0) return 0;
  let room = await prisma.room.findFirst({ where: { mapId }, orderBy: { createdAt: 'asc' } });
  if (!room) {
    try {
      room = await prisma.room.create({ data: { id: `${mapId}:lobby`, name: 'lobby', mapId, tenantId } });
    } catch {
      room = await prisma.room.findFirst({ where: { mapId } });
    }
  }
  if (!room) return 0;
  if (mode === 'replace') await prisma.zone.deleteMany({ where: { mapId } });
  for (const zone of extractedZones) {
    await prisma.zone.create({
      data: {
        name: zone.name,
        capacity: zone.capacity ?? undefined,
        polygon: zone.polygon,
        mapId,
        roomId: room.id,
        tenantId,
      },
    });
  }
  return extractedZones.length;
}

type ParsedImport = { tmj: Tmj; images: MulterFile[]; mode: 'merge' | 'replace' };

function parseImport(req: express.Request, res: express.Response): ParsedImport | null {
  const request = req as unknown as RequestWithMulterFields;
  const fileBuffer = request.files?.file?.[0]?.buffer;
  if (!fileBuffer) {
    res.status(400).json({ error: 'file_required' });
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(fileBuffer.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'invalid_json' });
    return null;
  }
  const parsed = TmjSchema.safeParse(json);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_tmj', details: parsed.error.issues });
    return null;
  }
  const reserved = parsed.data.layers.find((layer) => layer.type === 'tilelayer' && isReservedImportLayer(layer.name));
  if (reserved) {
    res.status(400).json({ error: 'reserved_layer', layer: reserved.name });
    return null;
  }
  const mappedNames = parsed.data.layers
    .filter((layer) => layer.type === 'tilelayer' && layer.data)
    .map((layer) => matchTmjLayerToV2(layer.name)?.v2Name)
    .filter((name): name is string => !!name);
  if (new Set(mappedNames).size !== mappedNames.length) {
    res.status(400).json({ error: 'duplicate_mapped_layer' });
    return null;
  }
  return {
    tmj: parsed.data,
    images: request.files?.images ?? [],
    mode: (req.query.mode as string) === 'merge' ? 'merge' : 'replace',
  };
}

async function persistImport(
  prisma: PrismaClient,
  map: { id: string; meta: unknown },
  tenantId: string,
  parsed: ParsedImport,
) {
  const { tmj, images, mode } = parsed;
  const chunkSize = 32;
  const spawnPoint = extractSpawnFromObjectLayers(tmj.layers);
  const result = await prisma.$transaction(async (tx) => {
    await tx.map.update({
      where: { id: map.id },
      data: { width: tmj.width, height: tmj.height, tileWidth: tmj.tilewidth, tileHeight: tmj.tileheight, chunkSize },
    });
    if (mode === 'replace') await clearExistingMapData(tx, map.id);
    await registerImportedTilesets(tx, map.id, tmj.tilesets, images);
    const layers = await processTileLayers(tx, map.id, tmj, chunkSize);
    const zoneCount = await processZones(tx, map.id, tenantId, tmj.layers, mode);
    if (spawnPoint) {
      const currentMeta = (map.meta as Record<string, unknown>) || {};
      await tx.map.update({ where: { id: map.id }, data: { meta: { ...currentMeta, spawn: spawnPoint } } });
    }
    if (layers.layerCounts.collision !== undefined) {
      await reconcileCollisionTiles(
        tx,
        map.id,
        { chunkSize, tileWidth: tmj.tilewidth, tileHeight: tmj.tileheight },
        rectCollisionTiles({ x0: 0, y0: 0, x1: tmj.width - 1, y1: tmj.height - 1 }, chunkSize),
      );
    }
    return { ...layers, zoneCount };
  });
  return { ...result, spawnPoint };
}

export async function handleTmjImport(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const auth = requireAuth(req);
    if (!auth) return void res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return void res.status(400).json({ error: 'tenant_required' });
    const parsed = parseImport(req, res);
    if (!parsed) return;
    const map = await prisma.map.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
    if (!map) return void res.status(404).json({ error: 'map not found' });
    const result = await persistImport(prisma, map, tenant.id, parsed);
    broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'all', mapId: map.id, mapName: map.name });
    logger.info('[TMJ] import complete', {
      mapId: map.id,
      mapName: map.name,
      tilesets: parsed.tmj.tilesets.length,
      layers: result.layerCounts,
      zones: result.zoneCount,
    });
    res.json({
      ok: true,
      map: { id: map.id, name: map.name, width: parsed.tmj.width, height: parsed.tmj.height },
      tilesets: parsed.tmj.tilesets.length,
      layers: result.layerCounts,
      zones: result.zoneCount,
      spawn: result.spawnPoint,
      warnings: result.warnings,
    });
  } catch (error: unknown) {
    logger.error('[TMJ] import failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
}

export function registerTmjImportRoute(app: express.Application, prisma: PrismaClient): void {
  app.post('/maps/:id/import-tmj', importUpload, (req, res) => handleTmjImport(prisma, req, res));
}
