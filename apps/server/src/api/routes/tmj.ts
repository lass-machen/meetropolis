import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { INTERNAL_MAP_LAYER_NAMES } from '../utils/mapLayerPolicy.js';
import { buildTmjFromV2 } from '../../services/tmjService.js';
import { handleTmjImport, registerTmjImportRoute } from './tmj.import.js';

export { handleTmjImport };

async function loadLayersWithChunks(prisma: PrismaClient, mapId: string) {
  const dbLayers = await prisma.mapLayer.findMany({
    where: { mapId, name: { notIn: [...INTERNAL_MAP_LAYER_NAMES] } },
  });
  const layersWithChunks: Array<{
    name: string;
    encoding: string;
    chunks: Array<{ x: number; y: number; encoding: string; data: Buffer }>;
    chunkSize: number;
  }> = [];
  for (const layer of dbLayers) {
    const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id } });
    layersWithChunks.push({
      name: layer.name,
      encoding: chunks[0]?.encoding ?? 'rle',
      chunks: chunks.map((chunk) => ({
        x: chunk.x,
        y: chunk.y,
        encoding: chunk.encoding,
        data: Buffer.from(chunk.data),
      })),
      chunkSize: layer.chunkSize,
    });
  }
  return layersWithChunks;
}

export async function handleTmjExport(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const auth = requireAuth(req);
    if (!auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const tenant = getTenantFromReq(req);
    if (!tenant) {
      res.status(400).json({ error: 'tenant_required' });
      return;
    }

    const includeZones = req.query.includeZones === 'true';
    const includeSpawn = req.query.includeSpawn === 'true';
    const map = await prisma.map.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
    if (!map) {
      res.status(404).json({ error: 'map_not_found' });
      return;
    }

    const mapWidth = map.width ?? 32;
    const mapHeight = map.height ?? 32;
    const tileWidth = map.tileWidth ?? 16;
    const tileHeight = map.tileHeight ?? 16;
    const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
    for (const tileset of tilesets) {
      if (!tileset.tileCount) {
        logger.warn('[TMJ Export] Tileset missing tileCount, using fallback 1024', {
          key: tileset.key,
          slot: tileset.slot,
        });
      }
    }
    const layers = await loadLayersWithChunks(prisma, map.id);
    const dbZones = includeZones ? await prisma.zone.findMany({ where: { mapId: map.id } }) : [];
    const zones = includeZones
      ? dbZones.map((zone) => ({
          name: zone.name,
          capacity: zone.capacity,
          polygon: zone.polygon as Array<{ x: number; y: number }>,
        }))
      : undefined;
    const meta = (map.meta as { spawn?: { x?: unknown; y?: unknown } } | null) || {};
    const spawn =
      includeSpawn && meta.spawn && typeof meta.spawn.x === 'number' && typeof meta.spawn.y === 'number'
        ? { x: meta.spawn.x, y: meta.spawn.y }
        : null;

    const tmj = buildTmjFromV2({
      mapWidth,
      mapHeight,
      tileWidth,
      tileHeight,
      tilesets: tilesets.map((tileset) => ({
        slot: tileset.slot,
        key: tileset.key,
        imageUrl: tileset.imageUrl,
        tileWidth: tileset.tileWidth,
        tileHeight: tileset.tileHeight,
        margin: tileset.margin,
        spacing: tileset.spacing,
        tileCount: tileset.tileCount,
      })),
      layers,
      zones,
      spawn,
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${map.name}.tmj"`);
    res.json(tmj);
  } catch (error: unknown) {
    logger.error('[TMJ] export failed', error);
    res.status(500).json({ error: 'internal_error' });
  }
}

export function registerTmjRoutes(app: express.Application, prisma: PrismaClient): void {
  registerTmjImportRoute(app, prisma);
  app.get('/maps/:id/export-tmj', (req, res) => handleTmjExport(prisma, req, res));
}
