import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import {
  TmjSchema,
  buildGidToSlotMapping,
  flatGidsToTileRefIds,
  matchTmjLayerToV2,
  chunkAndEncode,
  extractZonesFromObjectLayers,
  extractSpawnFromObjectLayers,
  buildTmjFromV2,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTileCount(t: { tilecount?: number; imagewidth?: number; imageheight?: number; tilewidth: number; tileheight: number; margin?: number; spacing?: number }): number | null {
  if (t.tilecount) return t.tilecount;
  if (t.imagewidth && t.imageheight) {
    const m = t.margin ?? 0;
    const s = t.spacing ?? 0;
    const cols = Math.max(1, Math.floor((t.imagewidth - m * 2 + s) / (t.tilewidth + s)));
    const rows = Math.max(1, Math.floor((t.imageheight - m * 2 + s) / (t.tileheight + s)));
    return cols * rows;
  }
  return null;
}

function saveTilesetImage(images: Array<{ originalname: string; buffer: Buffer }>, tilesetImage: string): string | null {
  const baseName = path.basename(tilesetImage);
  const file = images.find(f => f.originalname === baseName);
  if (!file) return null;
  const tilesetsDir = path.resolve(__dirname, '../../../../public/assets/tilesets');
  if (!fs.existsSync(tilesetsDir)) fs.mkdirSync(tilesetsDir, { recursive: true });
  const dest = path.join(tilesetsDir, baseName);
  fs.writeFileSync(dest, file.buffer);
  return `/assets/tilesets/${baseName}`;
}

// ---------------------------------------------------------------------------
// Helpers used by import/export route handlers
// ---------------------------------------------------------------------------

async function clearExistingMapData(prisma: PrismaClient, mapId: string): Promise<void> {
  const existingLayers = await prisma.mapLayer.findMany({ where: { mapId } });
  for (const l of existingLayers) {
    await prisma.mapChunk.deleteMany({ where: { layerId: l.id } });
  }
  await prisma.mapLayer.deleteMany({ where: { mapId } });
  await prisma.mapTileset.deleteMany({ where: { mapId } });
}

async function registerImportedTilesets(
  prisma: PrismaClient,
  mapId: string,
  tmjTilesets: import('../../services/tmjService.js').Tmj['tilesets'],
  images: Array<{ originalname: string; buffer: Buffer }>,
): Promise<void> {
  for (let i = 0; i < tmjTilesets.length; i++) {
    const t = tmjTilesets[i];
    const uploadedUrl = saveTilesetImage(images, t.image);
    await prisma.mapTileset.create({
      data: {
        mapId, slot: i, key: t.name,
        imageUrl: uploadedUrl ?? t.image,
        tileWidth: t.tilewidth, tileHeight: t.tileheight,
        margin: t.margin ?? 0, spacing: t.spacing ?? 0,
        tileCount: computeTileCount(t),
      },
    });
  }
}

async function processTileLayers(
  prisma: PrismaClient,
  mapId: string,
  tmj: import('../../services/tmjService.js').Tmj,
  chunkSize: number,
): Promise<{ warnings: string[]; layerCounts: Record<string, number> }> {
  const warnings: string[] = [];
  const layerCounts: Record<string, number> = {};
  const slotAssignments = tmj.tilesets.map((t, i) => ({ firstgid: t.firstgid, slot: i }));
  const { firstGids, toSlot } = buildGidToSlotMapping(slotAssignments);

  for (const tmjLayer of tmj.layers) {
    if (tmjLayer.type !== 'tilelayer' || !tmjLayer.data) continue;
    const match = matchTmjLayerToV2(tmjLayer.name);
    if (!match) {
      warnings.push(`Layer '${tmjLayer.name}' übersprungen: kein V2-Mapping`);
      continue;
    }

    const width = tmjLayer.width || tmj.width;
    const height = tmjLayer.height || tmj.height;
    const tileRefs = flatGidsToTileRefIds(tmjLayer.data, match.encoding, firstGids, toSlot);
    const chunks = chunkAndEncode(tileRefs, width, height, chunkSize, match.encoding);

    const layer = await prisma.mapLayer.create({
      data: { mapId, name: match.v2Name, chunkSize },
    });
    for (const chunk of chunks) {
      await prisma.mapChunk.create({
        data: {
          layerId: layer.id, x: chunk.cx, y: chunk.cy,
          version: 1, encoding: chunk.encoding,
          data: new Uint8Array(chunk.data),
        },
      });
    }
    layerCounts[match.v2Name] = chunks.length;
  }

  return { warnings, layerCounts };
}

async function processZones(
  prisma: PrismaClient,
  mapId: string,
  tenantId: string,
  layers: import('../../services/tmjService.js').Tmj['layers'],
  mode: 'merge' | 'replace',
): Promise<number> {
  const extractedZones = extractZonesFromObjectLayers(layers);
  if (extractedZones.length === 0) return 0;

  let roomForZones = await prisma.room.findFirst({
    where: { mapId }, orderBy: { createdAt: 'asc' },
  });
  if (!roomForZones) {
    const lobbyId = `${mapId}:lobby`;
    try {
      roomForZones = await prisma.room.create({
        data: { id: lobbyId, name: 'lobby', mapId, tenantId },
      });
    } catch {
      roomForZones = await prisma.room.findFirst({ where: { mapId } });
    }
  }
  if (!roomForZones) return 0;

  if (mode === 'replace') {
    await prisma.zone.deleteMany({ where: { mapId } });
  }
  let zoneCount = 0;
  for (const z of extractedZones) {
    await prisma.zone.create({
      data: {
        name: z.name, capacity: z.capacity ?? undefined,
        polygon: z.polygon, mapId,
        roomId: roomForZones.id, tenantId,
      } as any,
    });
    zoneCount++;
  }
  return zoneCount;
}

async function handleTmjImport(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const auth = requireAuth(req);
    if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
    const tenant = getTenantFromReq(req);
    if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }

    const fileBuffer = ((req as any).files as any)?.file?.[0]?.buffer as Buffer | undefined;
    if (!fileBuffer) { res.status(400).json({ error: 'file_required' }); return; }

    let json: unknown;
    try { json = JSON.parse(fileBuffer.toString('utf8')); } catch {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }

    const parse = TmjSchema.safeParse(json);
    if (!parse.success) { res.status(400).json({ error: 'invalid_tmj', details: parse.error.errors }); return; }
    const tmj = parse.data;

    const mode = (req.query.mode as string) === 'merge' ? 'merge' : 'replace';
    const chunkSize = 32;

    const map = await prisma.map.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
    if (!map) { res.status(404).json({ error: 'map not found' }); return; }

    await prisma.map.update({
      where: { id: map.id },
      data: {
        width: tmj.width, height: tmj.height,
        tileWidth: tmj.tilewidth, tileHeight: tmj.tileheight,
        chunkSize,
      },
    });

    if (mode === 'replace') {
      await clearExistingMapData(prisma, map.id);
    }

    const images = (((req as any).files as any)?.images ?? []) as Array<{ originalname: string; buffer: Buffer }>;
    await registerImportedTilesets(prisma, map.id, tmj.tilesets, images);

    const { warnings, layerCounts } = await processTileLayers(prisma, map.id, tmj, chunkSize);
    const zoneCount = await processZones(prisma, map.id, tenant.id, tmj.layers, mode);

    const spawnPoint = extractSpawnFromObjectLayers(tmj.layers);
    if (spawnPoint) {
      const currentMeta = (map.meta as any) || {};
      await prisma.map.update({
        where: { id: map.id },
        data: { meta: { ...currentMeta, spawn: spawnPoint } as any },
      });
    }

    broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'all', mapId: map.id, mapName: map.name });

    logger.info('[TMJ] import complete', { mapId: map.id, mapName: map.name, tilesets: tmj.tilesets.length, layers: layerCounts, zones: zoneCount });
    res.json({
      ok: true,
      map: { id: map.id, name: map.name, width: tmj.width, height: tmj.height },
      tilesets: tmj.tilesets.length,
      layers: layerCounts,
      zones: zoneCount,
      spawn: spawnPoint,
      warnings,
    });
  } catch (e: any) {
    logger.error('[TMJ] import failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

async function loadLayersWithChunks(prisma: PrismaClient, mapId: string) {
  const dbLayers = await prisma.mapLayer.findMany({ where: { mapId } });
  const layersWithChunks: Array<{ name: string; encoding: string; chunks: Array<{ x: number; y: number; encoding: string; data: Buffer }>; chunkSize: number }> = [];
  for (const layer of dbLayers) {
    const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id } });
    layersWithChunks.push({
      name: layer.name,
      encoding: chunks[0]?.encoding ?? 'rle',
      chunks: chunks.map((c: any) => ({
        x: c.x, y: c.y,
        encoding: c.encoding,
        data: Buffer.from(c.data as any),
      })),
      chunkSize: layer.chunkSize,
    });
  }
  return layersWithChunks;
}

async function handleTmjExport(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const auth = requireAuth(req);
    if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
    const tenant = getTenantFromReq(req);
    if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }

    const includeZones = req.query.includeZones === 'true';
    const includeSpawn = req.query.includeSpawn === 'true';

    const map = await prisma.map.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
    if (!map) { res.status(404).json({ error: 'map_not_found' }); return; }

    const mapWidth = map.width ?? 32;
    const mapHeight = map.height ?? 32;
    const tileWidth = map.tileWidth ?? 16;
    const tileHeight = map.tileHeight ?? 16;

    const tilesets = await prisma.mapTileset.findMany({
      where: { mapId: map.id }, orderBy: { slot: 'asc' },
    });
    for (const ts of tilesets) {
      if (!ts.tileCount) {
        logger.warn('[TMJ Export] Tileset missing tileCount, using fallback 1024', { key: ts.key, slot: ts.slot });
      }
    }

    const layersWithChunks = await loadLayersWithChunks(prisma, map.id);

    let zones: Array<{ name: string; capacity: number | null; polygon: Array<{ x: number; y: number }> }> | undefined;
    if (includeZones) {
      const dbZones = await prisma.zone.findMany({ where: { mapId: map.id } });
      zones = dbZones.map((z: any) => ({
        name: z.name,
        capacity: z.capacity,
        polygon: z.polygon as Array<{ x: number; y: number }>,
      }));
    }

    let spawn: { x: number; y: number } | null = null;
    if (includeSpawn) {
      const meta = (map.meta as any) || {};
      if (meta.spawn && typeof meta.spawn.x === 'number' && typeof meta.spawn.y === 'number') {
        spawn = { x: meta.spawn.x, y: meta.spawn.y };
      }
    }

    const tmj = buildTmjFromV2({
      mapWidth, mapHeight, tileWidth, tileHeight,
      tilesets: tilesets.map((ts: any) => ({
        slot: ts.slot, key: ts.key,
        imageUrl: ts.imageUrl,
        tileWidth: ts.tileWidth, tileHeight: ts.tileHeight,
        margin: ts.margin, spacing: ts.spacing,
        tileCount: ts.tileCount,
      })),
      layers: layersWithChunks,
      zones,
      spawn,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${map.name}.tmj"`);
    res.json(tmj);
  } catch (e: any) {
    logger.error('[TMJ] export failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerTmjRoutes(app: express.Application, prisma: PrismaClient) {
  app.post('/maps/:id/import-tmj', importUpload, (req, res) => handleTmjImport(prisma, req, res));
  app.get('/maps/:id/export-tmj', (req, res) => handleTmjExport(prisma, req, res));
}
