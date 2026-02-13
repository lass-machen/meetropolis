import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireApiToken } from '../utils/authHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import {
  computeFootprintTiles,
  updateCollisionChunks,
  removeCollisionAndReconcile,
} from '../utils/collisionHelpers.js';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const createObjectSchema = z.object({
  assetPackUuid: z.string().min(1),
  itemId: z.string().min(1),
  category: z.string().min(1),
  tileX: z.number().int(),
  tileY: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  collide: z.boolean(),
  zIndex: z.number().int().optional(),
  rotation: z.number().int().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  scaleFactor: z.number().positive().optional(),
  dataUrl: z.string().min(1),
});

const updateObjectSchema = z.object({
  tileX: z.number().int().optional(),
  tileY: z.number().int().optional(),
  rotation: z.number().int().optional(),
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
  zIndex: z.number().int().optional(),
});

const bulkCreateSchema = z.object({
  objects: z.array(createObjectSchema).min(1).max(500),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMapDimensions(map: { chunkSize: number | null; tileWidth: number | null; tileHeight: number | null }) {
  return {
    chunkSize: map.chunkSize ?? 32,
    tileWidth: map.tileWidth ?? 16,
    tileHeight: map.tileHeight ?? 16,
  };
}

async function applyCollisionForObject(
  prisma: PrismaClient,
  tenantSlug: string,
  mapName: string,
  mapId: string,
  dims: { chunkSize: number; tileWidth: number; tileHeight: number },
  obj: { tileX: number; tileY: number; width: number; height: number; scaleFactor?: number },
) {
  const sf = obj.scaleFactor ?? 1;
  const tiles = computeFootprintTiles(
    obj.tileX, obj.tileY, obj.width * sf, obj.height * sf,
    dims.tileWidth, dims.tileHeight, dims.chunkSize,
  );
  const updates = await updateCollisionChunks(prisma, mapId, dims.chunkSize, tiles, true);
  if (updates.length > 0) {
    broadcastMapUpdate(tenantSlug, 'chunks_updated', {
      map: mapName, layer: 'collision', updates,
    });
  }
}

async function removeCollisionForObject(
  prisma: PrismaClient,
  tenantSlug: string,
  mapName: string,
  mapId: string,
  dims: { chunkSize: number; tileWidth: number; tileHeight: number },
  obj: { tileX: number; tileY: number; width: number; height: number; scaleFactor?: number },
) {
  const sf = obj.scaleFactor ?? 1;
  const updates = await removeCollisionAndReconcile(
    prisma, mapId, dims.chunkSize, dims.tileWidth, dims.tileHeight,
    { tileX: obj.tileX, tileY: obj.tileY, width: obj.width * sf, height: obj.height * sf },
  );
  if (updates.length > 0) {
    broadcastMapUpdate(tenantSlug, 'chunks_updated', {
      map: mapName, layer: 'collision', updates,
    });
  }
}

// ---------------------------------------------------------------------------
// Route Registration
// ---------------------------------------------------------------------------

export function registerMapObjectRoutes(app: express.Application, prisma: PrismaClient) {

  // GET /maps/:name/objects — fetch objects by chunk keys
  app.get('/maps/:name/objects', async (req: express.Request, res: express.Response) => {
    try {
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });

      const name = req.params.name;
      const chunksParam = (req.query.chunks as string) || '';

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      if (!chunksParam) {
        const objects = await prisma.mapObject.findMany({ where: { mapId: map.id } });
        return res.json(objects);
      }

      const chunkKeys = chunksParam.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const orClauses: Array<{ chunkX: number; chunkY: number }> = [];
      for (const k of chunkKeys) {
        const [xs, ys] = k.split(':');
        const x = Number(xs);
        const y = Number(ys);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        orClauses.push({ chunkX: x, chunkY: y });
      }

      if (orClauses.length === 0) return res.json([]);

      const objects = await prisma.mapObject.findMany({
        where: { mapId: map.id, OR: orClauses },
      });
      res.json(objects);
    } catch (e: unknown) {
      logger.error('[MapObjects] GET failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /maps/:name/objects — create single object
  app.post('/maps/:name/objects', async (req: express.Request, res: express.Response) => {
    try {
      const sessionAuth = requireAuth(req);
      const tokenAuth = await requireApiToken(req, prisma);
      const auth = sessionAuth || tokenAuth;
      if (!auth) return res.status(401).json({ error: 'unauthorized' });
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });

      const parse = createObjectSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

      const name = req.params.name;
      const data = parse.data;

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const pack = await prisma.assetPack.findUnique({ where: { uuid: data.assetPackUuid } });
      if (!pack) return res.status(400).json({ error: 'asset_pack_not_found' });

      const dims = getMapDimensions(map);
      const chunkX = Math.floor(data.tileX / dims.chunkSize);
      const chunkY = Math.floor(data.tileY / dims.chunkSize);

      const obj = await prisma.mapObject.create({
        data: {
          mapId: map.id,
          assetPackUuid: data.assetPackUuid,
          itemId: data.itemId,
          category: data.category,
          tileX: data.tileX,
          tileY: data.tileY,
          chunkX,
          chunkY,
          width: data.width,
          height: data.height,
          collide: data.collide,
          zIndex: data.zIndex ?? 0,
          rotation: data.rotation ?? 0,
          flipX: data.flipX ?? false,
          flipY: data.flipY ?? false,
          scaleFactor: data.scaleFactor ?? 1,
          dataUrl: data.dataUrl,
        },
      });

      if (data.collide) {
        await applyCollisionForObject(prisma, tenant.slug, name, map.id, dims, data);
      }

      broadcastMapUpdate(tenant.slug, 'objects_updated', {
        map: name, action: 'add', objects: [obj],
      });

      res.json(obj);
    } catch (e: unknown) {
      logger.error('[MapObjects] POST failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // PATCH /maps/:name/objects/:id — update object
  app.patch('/maps/:name/objects/:id', async (req: express.Request, res: express.Response) => {
    try {
      const sessionAuth = requireAuth(req);
      const tokenAuth = await requireApiToken(req, prisma);
      const auth = sessionAuth || tokenAuth;
      if (!auth) return res.status(401).json({ error: 'unauthorized' });
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });

      const parse = updateObjectSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

      const name = req.params.name;
      const objId = Number(req.params.id);
      if (!Number.isFinite(objId)) return res.status(400).json({ error: 'invalid id' });

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const existing = await prisma.mapObject.findFirst({ where: { id: objId, mapId: map.id } });
      if (!existing) return res.status(404).json({ error: 'object not found' });

      const dims = getMapDimensions(map);
      const updateData = parse.data;

      const positionChanged = (updateData.tileX !== undefined && updateData.tileX !== existing.tileX)
        || (updateData.tileY !== undefined && updateData.tileY !== existing.tileY);

      if (existing.collide && positionChanged) {
        await removeCollisionForObject(prisma, tenant.slug, name, map.id, dims, existing);
      }

      const newTileX = updateData.tileX ?? existing.tileX;
      const newTileY = updateData.tileY ?? existing.tileY;
      const newChunkX = positionChanged ? Math.floor(newTileX / dims.chunkSize) : existing.chunkX;
      const newChunkY = positionChanged ? Math.floor(newTileY / dims.chunkSize) : existing.chunkY;

      const updated = await prisma.mapObject.update({
        where: { id: objId },
        data: { ...updateData, chunkX: newChunkX, chunkY: newChunkY },
      });

      if (existing.collide && positionChanged) {
        await applyCollisionForObject(
          prisma, tenant.slug, name, map.id, dims,
          { tileX: newTileX, tileY: newTileY, width: existing.width, height: existing.height, scaleFactor: existing.scaleFactor },
        );
      }

      broadcastMapUpdate(tenant.slug, 'objects_updated', {
        map: name, action: 'update', objects: [updated],
      });

      res.json(updated);
    } catch (e: unknown) {
      logger.error('[MapObjects] PATCH failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // DELETE /maps/:name/objects/:id — remove object
  app.delete('/maps/:name/objects/:id', async (req: express.Request, res: express.Response) => {
    try {
      const sessionAuth = requireAuth(req);
      const tokenAuth = await requireApiToken(req, prisma);
      const auth = sessionAuth || tokenAuth;
      if (!auth) return res.status(401).json({ error: 'unauthorized' });
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });

      const name = req.params.name;
      const objId = Number(req.params.id);
      if (!Number.isFinite(objId)) return res.status(400).json({ error: 'invalid id' });

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const existing = await prisma.mapObject.findFirst({ where: { id: objId, mapId: map.id } });
      if (!existing) return res.status(404).json({ error: 'object not found' });

      await prisma.mapObject.delete({ where: { id: objId } });

      if (existing.collide) {
        const dims = getMapDimensions(map);
        await removeCollisionForObject(prisma, tenant.slug, name, map.id, dims, existing);
      }

      broadcastMapUpdate(tenant.slug, 'objects_updated', {
        map: name, action: 'remove', objectIds: [objId],
      });

      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error('[MapObjects] DELETE failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /maps/:name/objects/bulk — bulk create
  app.post('/maps/:name/objects/bulk', async (req: express.Request, res: express.Response) => {
    try {
      const sessionAuth = requireAuth(req);
      const tokenAuth = await requireApiToken(req, prisma);
      const auth = sessionAuth || tokenAuth;
      if (!auth) return res.status(401).json({ error: 'unauthorized' });
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });

      const parse = bulkCreateSchema.safeParse(req.body);
      if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

      const name = req.params.name;
      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const dims = getMapDimensions(map);

      // Validate all asset packs exist upfront
      const uuids = [...new Set(parse.data.objects.map(o => o.assetPackUuid))];
      const packs = await prisma.assetPack.findMany({
        where: { uuid: { in: uuids } },
        select: { uuid: true },
      });
      const validUuids = new Set(packs.map(p => p.uuid));
      for (const obj of parse.data.objects) {
        if (!validUuids.has(obj.assetPackUuid)) {
          return res.status(400).json({ error: 'asset_pack_not_found', uuid: obj.assetPackUuid });
        }
      }

      const created: Array<Record<string, unknown>> = [];
      const allCollisionTiles: Array<{ cx: number; cy: number; rx: number; ry: number }> = [];

      for (const data of parse.data.objects) {
        const chunkX = Math.floor(data.tileX / dims.chunkSize);
        const chunkY = Math.floor(data.tileY / dims.chunkSize);

        const obj = await prisma.mapObject.create({
          data: {
            mapId: map.id,
            assetPackUuid: data.assetPackUuid,
            itemId: data.itemId,
            category: data.category,
            tileX: data.tileX,
            tileY: data.tileY,
            chunkX,
            chunkY,
            width: data.width,
            height: data.height,
            collide: data.collide,
            zIndex: data.zIndex ?? 0,
            rotation: data.rotation ?? 0,
            flipX: data.flipX ?? false,
            flipY: data.flipY ?? false,
            scaleFactor: data.scaleFactor ?? 1,
            dataUrl: data.dataUrl,
          },
        });
        created.push(obj);

        if (data.collide) {
          const sf = data.scaleFactor ?? 1;
          const tiles = computeFootprintTiles(
            data.tileX, data.tileY, data.width * sf, data.height * sf,
            dims.tileWidth, dims.tileHeight, dims.chunkSize,
          );
          allCollisionTiles.push(...tiles);
        }
      }

      if (allCollisionTiles.length > 0) {
        const collisionUpdates = await updateCollisionChunks(
          prisma, map.id, dims.chunkSize, allCollisionTiles, true,
        );
        if (collisionUpdates.length > 0) {
          broadcastMapUpdate(tenant.slug, 'chunks_updated', {
            map: name, layer: 'collision', updates: collisionUpdates,
          });
        }
      }

      broadcastMapUpdate(tenant.slug, 'objects_updated', {
        map: name, action: 'add', objects: created,
      });

      res.json({ ok: true, objects: created });
    } catch (e: unknown) {
      logger.error('[MapObjects] bulk POST failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });
}
