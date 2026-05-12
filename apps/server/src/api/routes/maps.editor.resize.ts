import type express from 'express';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { getTenantFromReq } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import { findMapById } from './maps.read.js';
import { authenticateEditor, type MapMeta } from './maps.editor.js';

const resizeSchema = z.object({
  width: z.number().int().min(8).max(512),
  height: z.number().int().min(8).max(512),
  dryRun: z.boolean().optional(),
});

type MapRow = Prisma.MapGetPayload<Record<string, never>>;

async function evaluateResizeImpact(
  prisma: PrismaClient,
  map: MapRow,
  width: number,
  height: number,
): Promise<string[]> {
  const warnings: string[] = [];
  const oldWidth = map.width ?? 32;
  const oldHeight = map.height ?? 32;
  if (!(width < oldWidth || height < oldHeight)) return warnings;

  const objectsOutside = await prisma.mapObject.count({
    where: {
      mapId: map.id,
      OR: [{ tileX: { gte: width } }, { tileY: { gte: height } }],
    },
  });
  if (objectsOutside > 0) {
    warnings.push(`${objectsOutside} object(s) will be outside the new map bounds`);
  }

  const meta: MapMeta = (map.meta as MapMeta | null) || {};
  if (meta.spawn) {
    const tileWidth = map.tileWidth || 16;
    const tileHeight = map.tileHeight || 16;
    const spawnTileX = Math.floor(meta.spawn.x / tileWidth);
    const spawnTileY = Math.floor(meta.spawn.y / tileHeight);
    if (spawnTileX >= width || spawnTileY >= height) {
      warnings.push('Spawn point will be outside the new map bounds');
    }
  }

  const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
  const pixelMaxX = width * (map.tileWidth || 16);
  const pixelMaxY = height * (map.tileHeight || 16);
  for (const zone of zones) {
    const polygon = zone.polygon;
    if (!Array.isArray(polygon)) continue;
    for (const rawPoint of polygon) {
      const point = (rawPoint && typeof rawPoint === 'object' ? rawPoint : {}) as { x?: unknown; y?: unknown };
      const px = typeof point.x === 'number' ? point.x : 0;
      const py = typeof point.y === 'number' ? point.y : 0;
      if (px >= pixelMaxX || py >= pixelMaxY) {
        warnings.push(`Zone "${zone.name}" has vertices outside the new map bounds`);
        break;
      }
    }
  }
  return warnings;
}

export async function handleResize(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const parse = resizeSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const { width, height, dryRun } = parse.data;

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

    const oldWidth = map.width ?? 32;
    const oldHeight = map.height ?? 32;
    const warnings = await evaluateResizeImpact(prisma, map, width, height);

    if (dryRun) {
      res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
      return;
    }

    await prisma.map.update({ where: { id: map.id }, data: { width, height } });
    broadcastMapUpdate(tenant.slug, 'map_resized', {
      mapId: map.id,
      mapName: map.name,
      oldWidth,
      oldHeight,
      newWidth: width,
      newHeight: height,
    });
    logger.info('[Map] Resized', {
      mapId: map.id,
      mapName: map.name,
      oldWidth,
      oldHeight,
      newWidth: width,
      newHeight: height,
    });

    res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
  } catch (e) {
    logger.error('[Map] resize failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

const renameSchema = z.object({ newName: z.string().min(1).max(100).trim() });

export async function handleRename(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const parse = renameSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  const { newName } = parse.data;

  try {
    let oldName = '';
    await prisma.$transaction(async (tx) => {
      const map = await tx.map.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
      if (!map) throw new Error('MAP_NOT_FOUND');
      oldName = map.name;

      if (newName === oldName) return;

      const existing = await tx.map.findFirst({ where: { name: newName, tenantId: tenant.id } });
      if (existing) throw new Error('NAME_CONFLICT');

      await tx.map.update({ where: { id: map.id }, data: { name: newName } });

      const currentTenant = await tx.tenant.findUnique({ where: { id: tenant.id } });
      if (currentTenant?.defaultMapName === oldName) {
        await tx.tenant.update({ where: { id: tenant.id }, data: { defaultMapName: newName } });
      }

      await tx.zone.updateMany({
        where: { tenantId: tenant.id, portalTarget: oldName },
        data: { portalTarget: newName },
      });

      await tx.presence.updateMany({
        where: { tenantId: tenant.id, mapName: oldName },
        data: { mapName: newName },
      });

      await tx.npc.updateMany({
        where: { tenantId: tenant.id, mapName: oldName },
        data: { mapName: newName },
      });
    });

    if (newName !== oldName) {
      broadcastMapUpdate(tenant.slug, 'map_renamed', { mapId: req.params.id, oldName, newName });
      logger.info('[Map] Renamed', { mapId: req.params.id, oldName, newName, tenant: tenant.slug });
    }

    res.json({ ok: true, oldName, newName });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '';
    if (msg === 'MAP_NOT_FOUND') {
      res.status(404).json({ error: 'map not found' });
      return;
    }
    if (msg === 'NAME_CONFLICT') {
      res.status(409).json({ error: 'A map with that name already exists' });
      return;
    }
    logger.error('[Map] rename failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}
