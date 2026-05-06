import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership, requireApiToken } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate, broadcastSpawnUpdate } from '../utils/broadcast.js';
import { findMapById } from './maps.read.js';

async function authenticateEditor(
  prisma: PrismaClient,
  req: express.Request,
): Promise<{ ok: boolean; auth?: any }> {
  const sessionAuth = requireAuth(req);
  const tokenAuth = await requireApiToken(req, prisma);
  const auth = sessionAuth || tokenAuth;
  if (!auth) return { ok: false };
  return { ok: true, auth };
}

const tilesetSchema = z.object({
  key: z.string().min(1),
  imageUrl: z.string().min(1),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  margin: z.number().int().nonnegative().optional(),
  spacing: z.number().int().nonnegative().optional(),
  hash: z.string().optional(),
});

export async function handleAddTileset(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const parse = tilesetSchema.safeParse(req.body || {});
    if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }

    const tenant = getTenantFromReq(req);
    if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) { res.status(404).json({ error: 'map not found' }); return; }

    const existing = await prisma.mapTileset.findFirst({ where: { mapId: map.id, key: parse.data.key } });
    if (existing) {
      try { logger.debug('[Tilesets] already registered, skipping', { mapId: map.id, key: parse.data.key }); } catch { }
      const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
      res.json(tilesets);
      return;
    }

    const last = await prisma.mapTileset.findFirst({ where: { mapId: map.id }, orderBy: { slot: 'desc' } });
    const newSlot = last ? last.slot + 1 : 0;
    await prisma.mapTileset.create({ data: { mapId: map.id, slot: newSlot, ...parse.data } });
    try { logger.info('[Tilesets] registry add', { mapId: map.id, slot: newSlot, key: parse.data.key, url: parse.data.imageUrl }); } catch { }

    const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
    broadcastMapUpdate(tenant.slug, 'tileset_registry_updated', { mapId: map.id, mapName: map.name, tilesetRegistry: tilesets });
    res.json({ tilesetRegistry: tilesets });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      try { logger.warn('[Tilesets] duplicate slot (race condition), returning current registry'); } catch { }
      try {
        const tenant = getTenantFromReq(req);
        if (tenant) {
          const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
          if (map) {
            const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
            res.json({ tilesetRegistry: tilesets });
            return;
          }
        }
      } catch { }
    }
    logger.error('[Tilesets] add failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

export async function handleEditorStateGet(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
  const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
  if (!map) { res.status(404).json({ error: 'map not found' }); return; }
  const meta = (map.meta as any) || {};
  try { logger.debug('[EditorState] GET', { mapId: map.id, tilesets: Array.isArray(meta.tilesets) ? meta.tilesets.length : 0 }); } catch { }
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    tilesets: meta.tilesets ?? [],
    zones: await prisma.zone.findMany({
      where: { mapId: map.id },
      select: { id: true, name: true, capacity: true, polygon: true, type: true, portalTarget: true, portalSpawnX: true, portalSpawnY: true },
    }),
    backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
    spawn: (meta.spawn && typeof (meta.spawn as any).x === 'number' && typeof (meta.spawn as any).y === 'number') ? meta.spawn : null,
  });
}

const editorStateSchema = z.object({
  tilesets: z.array(z.any()).optional(),
  zones: z.array(z.any()).optional(),
  backgroundColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
  replaceZones: z.boolean().optional(),
  spawn: z.object({ x: z.number(), y: z.number() }).optional(),
});

async function ensureLobbyRoom(prisma: PrismaClient, mapId: string, tenantId: string) {
  let roomForZones = await prisma.room.findFirst({ where: { mapId }, orderBy: { createdAt: 'asc' } });
  if (roomForZones) return roomForZones;
  const lobbyId = `${mapId}:lobby`;
  try {
    return await prisma.room.create({ data: { id: lobbyId, name: 'lobby', mapId, tenantId } });
  } catch {
    return prisma.room.findFirst({ where: { mapId } });
  }
}

function preparedZoneFromInput(z: any) {
  const zoneName = (z?.name || 'Zone').toString();
  const anyZ: any = z as any;
  const capacity = typeof anyZ?.capacity === 'number' ? anyZ.capacity : null;
  const zoneType = typeof anyZ?.type === 'string' ? anyZ.type : null;
  const portalTarget = typeof anyZ?.portalTarget === 'string' ? anyZ.portalTarget : null;
  const portalSpawnX = typeof anyZ?.portalSpawnX === 'number' ? anyZ.portalSpawnX : null;
  const portalSpawnY = typeof anyZ?.portalSpawnY === 'number' ? anyZ.portalSpawnY : null;
  let polygon: any = undefined;
  try {
    if (Array.isArray(anyZ?.points)) polygon = anyZ.points;
    else if (Array.isArray(anyZ?.polygon)) polygon = anyZ.polygon;
    else if (anyZ?.polygon && Array.isArray(anyZ.polygon.points)) polygon = anyZ.polygon.points;
  } catch { }
  if (Array.isArray(polygon) && polygon.length > 0) {
    return { name: zoneName, capacity, polygon, type: zoneType, portalTarget, portalSpawnX, portalSpawnY };
  }
  return null;
}

async function rebuildZones(prisma: PrismaClient, mapId: string, tenantId: string, roomId: string, zones: any[], replaceZones: boolean | undefined) {
  const prepared: NonNullable<ReturnType<typeof preparedZoneFromInput>>[] = [];
  for (const z of zones) {
    const p = preparedZoneFromInput(z);
    if (p) prepared.push(p);
  }
  const shouldUpdate = (zones.length === 0) || (prepared.length > 0) || (replaceZones === true);
  if (!shouldUpdate) return;
  await prisma.zone.deleteMany({ where: { mapId } });
  for (const z of prepared) {
    await prisma.zone.create({
      data: {
        name: z.name, capacity: z.capacity ?? undefined, polygon: z.polygon,
        type: z.type ?? null, portalTarget: z.portalTarget ?? null,
        portalSpawnX: z.portalSpawnX ?? null, portalSpawnY: z.portalSpawnY ?? null,
        mapId, roomId, tenantId,
      } as any,
    });
  }
}

export async function handleEditorStatePut(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
  const parse = editorStateSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid editor payload' }); return; }
  const { tilesets, zones, backgroundColor, replaceZones, spawn } = parse.data;
  const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
  if (!map) { res.status(404).json({ error: 'map not found' }); return; }
  try { logger.debug('[EditorState] PUT', { mapId: map.id, mapName: map.name, tilesets: Array.isArray(tilesets) ? tilesets.length : undefined, zones: Array.isArray(zones) ? zones.length : undefined, spawn: !!spawn }); } catch { }

  const roomForZones = await ensureLobbyRoom(prisma, map.id, tenant.id);

  const currentMeta = (map.meta as any) || {};
  await prisma.map.update({
    where: { id: map.id },
    data: {
      meta: {
        ...currentMeta,
        tilesets: tilesets ?? currentMeta.tilesets ?? [],
        backgroundColor: backgroundColor ?? currentMeta.backgroundColor ?? undefined,
        spawn: spawn ?? currentMeta.spawn ?? undefined,
      } as any,
    },
  });

  if (Array.isArray(zones)) {
    await rebuildZones(prisma, map.id, tenant.id, roomForZones?.id as string, zones, replaceZones);
  }

  if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
    broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'spawn', pos: spawn, mapId: map.id, mapName: map.name });
    broadcastSpawnUpdate(map.id, spawn);
  }

  if (tilesets || zones || backgroundColor || replaceZones) {
    broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'all', mapId: map.id, mapName: map.name });
  }

  res.json({ ok: true });
}

const resizeSchema = z.object({
  width: z.number().int().min(8).max(512),
  height: z.number().int().min(8).max(512),
  dryRun: z.boolean().optional(),
});

async function evaluateResizeImpact(
  prisma: PrismaClient,
  map: any,
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

  const meta = (map.meta as any) || {};
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
    const polygon = zone.polygon as any[];
    if (!Array.isArray(polygon)) continue;
    for (const point of polygon) {
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
  if (!auth.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }

  const parse = resizeSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }
  const { width, height, dryRun } = parse.data;

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) { res.status(404).json({ error: 'map not found' }); return; }

    const oldWidth = map.width ?? 32;
    const oldHeight = map.height ?? 32;
    const warnings = await evaluateResizeImpact(prisma, map, width, height);

    if (dryRun) {
      res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
      return;
    }

    await prisma.map.update({ where: { id: map.id }, data: { width, height } });
    broadcastMapUpdate(tenant.slug, 'map_resized', { mapId: map.id, mapName: map.name, oldWidth, oldHeight, newWidth: width, newHeight: height });
    logger.info('[Map] Resized', { mapId: map.id, mapName: map.name, oldWidth, oldHeight, newWidth: width, newHeight: height });

    res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
  } catch (e) {
    logger.error('[Map] resize failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

const renameSchema = z.object({ newName: z.string().min(1).max(100).trim() });

export async function handleRename(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }

  const parse = renameSchema.safeParse(req.body || {});
  if (!parse.success) { res.status(400).json({ error: 'invalid payload' }); return; }
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
  } catch (e: any) {
    if (e?.message === 'MAP_NOT_FOUND') { res.status(404).json({ error: 'map not found' }); return; }
    if (e?.message === 'NAME_CONFLICT') { res.status(409).json({ error: 'A map with that name already exists' }); return; }
    logger.error('[Map] rename failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}

export async function handleDeleteZones(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const authResult = await authenticateEditor(prisma, req);
  if (!authResult.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
  const membership = await requireMembership(req, authResult.auth.userId, prisma);
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    res.status(403).json({ error: 'forbidden - admin required' });
    return;
  }
  const zoneName = req.query.name as string | undefined;
  const zoneId = req.query.id as string | undefined;

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) { res.status(404).json({ error: 'map not found' }); return; }

    let deleted = 0;
    if (zoneId) {
      const result = await prisma.zone.deleteMany({ where: { id: zoneId, mapId: map.id } });
      deleted = result.count;
    } else if (zoneName) {
      const result = await prisma.zone.deleteMany({ where: { name: zoneName, mapId: map.id } });
      deleted = result.count;
    } else {
      const result = await prisma.zone.deleteMany({ where: { mapId: map.id } });
      deleted = result.count;
    }

    logger.info('[Zones] Deleted zones', { mapId: map.id, mapName: map.name, zoneName, zoneId, deleted });
    res.json({ ok: true, deleted });
  } catch (e) {
    logger.error('[Zones] Delete failed', e);
    res.status(500).json({ error: 'delete failed' });
  }
}

export async function handleListMapZones(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateEditor(prisma, req);
  if (!auth.ok) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) { res.status(404).json({ error: 'map not found' }); return; }

    const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
    res.json(zones.map(z => ({
      id: z.id,
      name: z.name,
      capacity: z.capacity,
      polygon: z.polygon,
      type: z.type,
      portalTarget: z.portalTarget,
      portalSpawnX: z.portalSpawnX,
      portalSpawnY: z.portalSpawnY,
    })));
  } catch (e) {
    logger.error('[Zones] List failed', e);
    res.status(500).json({ error: 'list failed' });
  }
}
