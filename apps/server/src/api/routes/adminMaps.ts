import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import multer from 'multer';
import { logger } from '../../logger.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { copyMapToTenant } from './adminMaps.copy.js';
import { handleImportAdminMap } from './adminMaps.tiledImport.js';

export { copyMapToTenant } from './adminMaps.copy.js';

const createMapSchema = z.object({
  tenantId: z.string().min(1),
  name: z.string().min(1),
  width: z.number().int().positive().default(32),
  height: z.number().int().positive().default(32),
  tileWidth: z.number().int().positive().default(16),
  tileHeight: z.number().int().positive().default(16),
});

const copyMapSchema = z.object({
  targetTenantId: z.string().min(1),
  newName: z.string().min(1).optional(),
});

const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function handleListAdminMaps(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    const maps = await prisma.map.findMany({
      include: {
        tenant: { select: { id: true, slug: true, name: true } },
        _count: { select: { rooms: true, zones: true, tilesets: true, layers: true, objects: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const out = maps.map((m) => ({
      id: m.id,
      name: m.name,
      tenantId: m.tenantId,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      width: m.width,
      height: m.height,
      tileWidth: m.tileWidth,
      tileHeight: m.tileHeight,
      counts: m._count,
      createdAt: m.createdAt,
    }));
    res.json(out);
  } catch (e: unknown) {
    logger.error({ event: 'admin_maps.list.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'internal_error' });
  }
}

async function handleGetAdminMap(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    const map = await prisma.map.findUnique({
      where: { id: pathParam(req, 'id') },
      include: {
        tenant: { select: { id: true, slug: true, name: true } },
        rooms: { include: { zones: true } },
        tilesets: { orderBy: { slot: 'asc' } },
        layers: { include: { _count: { select: { chunks: true } } } },
        _count: { select: { objects: true } },
      },
    });
    if (!map) {
      res.status(404).json({ error: 'map_not_found' });
      return;
    }
    res.json(map);
  } catch (e: unknown) {
    logger.error({ event: 'admin_maps.get.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'internal_error' });
  }
}

async function handleCreateAdminMap(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const parse = createMapSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload', details: parse.error.issues });
    return;
  }

  try {
    const { tenantId, name, width, height, tileWidth, tileHeight } = parse.data;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found' });
      return;
    }

    const existing = await prisma.map.findUnique({ where: { tenantId_name: { tenantId, name } } });
    if (existing) {
      res.status(400).json({ error: 'map_name_exists' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const map = await tx.map.create({
        data: { tenantId, name, width, height, tileWidth, tileHeight, chunkSize: 32, meta: {} },
      });
      await tx.room.create({ data: { name: 'lobby', tenantId, mapId: map.id } });
      return map;
    });

    logger.info({ event: 'admin_maps.created', mapId: result.id, tenantId, name });
    res.json({ id: result.id, name: result.name });
  } catch (e: unknown) {
    logger.error({ event: 'admin_maps.create.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'internal_error' });
  }
}

async function deleteMapCascade(prisma: PrismaClient, mapId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.mapObject.deleteMany({ where: { mapId } });
    const layers = await tx.mapLayer.findMany({ where: { mapId }, select: { id: true } });
    const layerIds = layers.map((l) => l.id);
    if (layerIds.length > 0) {
      await tx.mapChunk.deleteMany({ where: { layerId: { in: layerIds } } });
    }
    await tx.mapLayer.deleteMany({ where: { mapId } });
    await tx.mapTileset.deleteMany({ where: { mapId } });
    const rooms = await tx.room.findMany({ where: { mapId }, select: { id: true } });
    const roomIds = rooms.map((r) => r.id);
    if (roomIds.length > 0) {
      await tx.presence.deleteMany({ where: { roomId: { in: roomIds } } });
    }
    await tx.zone.deleteMany({ where: { mapId } });
    await tx.room.deleteMany({ where: { mapId } });
    await tx.map.delete({ where: { id: mapId } });
  });
}

async function handleDeleteAdminMap(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    const map = await prisma.map.findUnique({ where: { id: pathParam(req, 'id') } });
    if (!map) {
      res.status(404).json({ error: 'map_not_found' });
      return;
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: map.tenantId } });
    if (tenant?.defaultMapName === map.name) {
      res.status(400).json({
        error: 'cannot_delete_default_map',
        message: 'This map is set as the tenant default. Change the default first.',
      });
      return;
    }

    await deleteMapCascade(prisma, map.id);

    logger.info({ event: 'admin_maps.deleted', mapId: map.id, deletedBy: admin.userId });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'admin_maps.delete.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'internal_error' });
  }
}

async function handleCopyAdminMap(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const parse = copyMapSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload', details: parse.error.issues });
    return;
  }

  try {
    const { targetTenantId, newName } = parse.data;
    const targetTenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
    if (!targetTenant) {
      res.status(404).json({ error: 'target_tenant_not_found' });
      return;
    }

    const sourceId = pathParam(req, 'id');
    const result = await copyMapToTenant(prisma, sourceId, targetTenantId, newName);

    logger.info({ event: 'admin_maps.copied', sourceId, newMapId: result.id, targetTenantId });
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'source_map_not_found') {
      res.status(404).json({ error: 'map_not_found' });
      return;
    }
    logger.error({ event: 'admin_maps.copy.error', error: msg });
    res.status(500).json({ error: 'internal_error' });
  }
}

export function registerAdminMapRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/admin/maps', (req, res) => handleListAdminMaps(prisma, req, res));
  app.get('/admin/maps/:id', (req, res) => handleGetAdminMap(prisma, req, res));
  app.post('/admin/maps', (req, res) => handleCreateAdminMap(prisma, req, res));
  app.delete('/admin/maps/:id', (req, res) => handleDeleteAdminMap(prisma, req, res));
  app.post('/admin/maps/:id/copy', (req, res) => handleCopyAdminMap(prisma, req, res));
  app.post('/admin/maps/import', importUpload.single('file'), (req, res) => handleImportAdminMap(prisma, req, res));
}
