import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate, broadcastSpawnUpdate } from '../utils/broadcast.js';
import { findMapById } from './maps.read.js';
import { authenticateEditor, type MapMeta } from './maps.editor.js';

export interface ZoneInput {
  name?: string;
  capacity?: number;
  type?: string;
  portalTarget?: string;
  portalSpawnX?: number;
  portalSpawnY?: number;
  points?: Array<{ x: number; y: number }>;
  polygon?: Array<{ x: number; y: number }> | { points?: Array<{ x: number; y: number }> };
}

export interface PreparedZone {
  name: string;
  capacity: number | null;
  polygon: Array<{ x: number; y: number }>;
  type: string | null;
  portalTarget: string | null;
  portalSpawnX: number | null;
  portalSpawnY: number | null;
}

export async function handleEditorStateGet(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
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
  const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
  if (!map) {
    res.status(404).json({ error: 'map not found' });
    return;
  }
  const meta: MapMeta = (map.meta as MapMeta | null) || {};
  try {
    logger.debug('[EditorState] GET', {
      mapId: map.id,
      tilesets: Array.isArray(meta.tilesets) ? meta.tilesets.length : 0,
    });
  } catch {}
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    tilesets: meta.tilesets ?? [],
    zones: await prisma.zone.findMany({
      where: { mapId: map.id },
      select: {
        id: true,
        name: true,
        capacity: true,
        polygon: true,
        type: true,
        portalTarget: true,
        portalSpawnX: true,
        portalSpawnY: true,
      },
    }),
    backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
    spawn: meta.spawn && typeof meta.spawn.x === 'number' && typeof meta.spawn.y === 'number' ? meta.spawn : null,
  });
}

const editorStateSchema = z.object({
  tilesets: z.array(z.any()).optional(),
  zones: z.array(z.any()).optional(),
  backgroundColor: z
    .string()
    .regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
    .optional(),
  replaceZones: z.boolean().optional(),
  spawn: z.object({ x: z.number(), y: z.number() }).optional(),
});

async function ensureLobbyRoom(prisma: PrismaClient, mapId: string, tenantId: string) {
  const roomForZones = await prisma.room.findFirst({ where: { mapId }, orderBy: { createdAt: 'asc' } });
  if (roomForZones) return roomForZones;
  const lobbyId = `${mapId}:lobby`;
  try {
    return await prisma.room.create({ data: { id: lobbyId, name: 'lobby', mapId, tenantId } });
  } catch {
    return prisma.room.findFirst({ where: { mapId } });
  }
}

function preparedZoneFromInput(z: ZoneInput | null | undefined): PreparedZone | null {
  if (!z) return null;
  const zoneName = (z.name || 'Zone').toString();
  const capacity = typeof z.capacity === 'number' ? z.capacity : null;
  const zoneType = typeof z.type === 'string' ? z.type : null;
  const portalTarget = typeof z.portalTarget === 'string' ? z.portalTarget : null;
  const portalSpawnX = typeof z.portalSpawnX === 'number' ? z.portalSpawnX : null;
  const portalSpawnY = typeof z.portalSpawnY === 'number' ? z.portalSpawnY : null;
  let polygon: Array<{ x: number; y: number }> | undefined;
  try {
    if (Array.isArray(z.points)) polygon = z.points;
    else if (Array.isArray(z.polygon)) polygon = z.polygon;
    else if (z.polygon && !Array.isArray(z.polygon) && Array.isArray(z.polygon.points)) polygon = z.polygon.points;
  } catch {}
  if (Array.isArray(polygon) && polygon.length > 0) {
    return { name: zoneName, capacity, polygon, type: zoneType, portalTarget, portalSpawnX, portalSpawnY };
  }
  return null;
}

async function rebuildZones(
  prisma: PrismaClient,
  mapId: string,
  tenantId: string,
  roomId: string,
  zones: ZoneInput[],
  replaceZones: boolean | undefined,
) {
  const prepared: PreparedZone[] = [];
  for (const z of zones) {
    const p = preparedZoneFromInput(z);
    if (p) prepared.push(p);
  }
  const shouldUpdate = zones.length === 0 || prepared.length > 0 || replaceZones === true;
  if (!shouldUpdate) return;
  await prisma.zone.deleteMany({ where: { mapId } });
  for (const z of prepared) {
    await prisma.zone.create({
      data: {
        name: z.name,
        capacity: z.capacity ?? undefined,
        polygon: z.polygon,
        type: z.type ?? null,
        portalTarget: z.portalTarget ?? null,
        portalSpawnX: z.portalSpawnX ?? null,
        portalSpawnY: z.portalSpawnY ?? null,
        mapId,
        roomId,
        tenantId,
      },
    });
  }
}

export async function handleEditorStatePut(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
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
  const parse = editorStateSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid editor payload' });
    return;
  }
  const { tilesets, zones, backgroundColor, replaceZones, spawn } = parse.data;
  const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
  if (!map) {
    res.status(404).json({ error: 'map not found' });
    return;
  }
  try {
    logger.debug('[EditorState] PUT', {
      mapId: map.id,
      mapName: map.name,
      tilesets: Array.isArray(tilesets) ? tilesets.length : undefined,
      zones: Array.isArray(zones) ? zones.length : undefined,
      spawn: !!spawn,
    });
  } catch {}

  const roomForZones = await ensureLobbyRoom(prisma, map.id, tenant.id);

  const currentMeta: MapMeta = (map.meta as MapMeta | null) || {};
  await prisma.map.update({
    where: { id: map.id },
    data: {
      meta: {
        ...currentMeta,
        tilesets: tilesets ?? currentMeta.tilesets ?? [],
        backgroundColor: backgroundColor ?? currentMeta.backgroundColor ?? undefined,
        spawn: spawn ?? currentMeta.spawn ?? undefined,
      },
    },
  });

  if (Array.isArray(zones) && roomForZones) {
    await rebuildZones(prisma, map.id, tenant.id, roomForZones.id, zones as ZoneInput[], replaceZones);
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

export async function handleDeleteZones(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const authResult = await authenticateEditor(prisma, req);
  if (!authResult.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  const membership = await requireMembership(req, authResult.auth.userId, prisma);
  if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
    res.status(403).json({ error: 'forbidden - admin required' });
    return;
  }
  const zoneName = req.query.name as string | undefined;
  const zoneId = req.query.id as string | undefined;

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

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

export async function handleListMapZones(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
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

  try {
    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      res.status(404).json({ error: 'map not found' });
      return;
    }

    const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
    res.json(
      zones.map((z) => ({
        id: z.id,
        name: z.name,
        capacity: z.capacity,
        polygon: z.polygon,
        type: z.type,
        portalTarget: z.portalTarget,
        portalSpawnX: z.portalSpawnX,
        portalSpawnY: z.portalSpawnY,
      })),
    );
  } catch (e) {
    logger.error('[Zones] List failed', e);
    res.status(500).json({ error: 'list failed' });
  }
}
