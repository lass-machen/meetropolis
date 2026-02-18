import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import multer from 'multer';
import { logger } from '../../logger.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';
import { rleEncodeNumbers, encodeRlePairsToBuffer } from '../../mapEncoding.js';

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

export function registerAdminMapRoutes(app: express.Application, prisma: PrismaClient) {
  // GET /admin/maps — list all maps with tenant info and counts
  app.get('/admin/maps', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

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
  });

  // GET /admin/maps/:id — single map detail with all relations
  app.get('/admin/maps/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    try {
      const map = await prisma.map.findUnique({
        where: { id: req.params.id },
        include: {
          tenant: { select: { id: true, slug: true, name: true } },
          rooms: { include: { zones: true } },
          tilesets: { orderBy: { slot: 'asc' } },
          layers: { include: { _count: { select: { chunks: true } } } },
          _count: { select: { objects: true } },
        },
      });
      if (!map) return res.status(404).json({ error: 'map_not_found' });
      res.json(map);
    } catch (e: unknown) {
      logger.error({ event: 'admin_maps.get.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /admin/maps — create a new map with default room
  app.post('/admin/maps', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    const parse = createMapSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { tenantId, name, width, height, tileWidth, tileHeight } = parse.data;

      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const existing = await prisma.map.findUnique({ where: { tenantId_name: { tenantId, name } } });
      if (existing) return res.status(400).json({ error: 'map_name_exists' });

      const result = await prisma.$transaction(async (tx) => {
        const map = await tx.map.create({
          data: {
            tenantId,
            name,
            width,
            height,
            tileWidth,
            tileHeight,
            chunkSize: 32,
            meta: {},
          },
        });

        // Create default "lobby" room
        await tx.room.create({
          data: { name: 'lobby', tenantId, mapId: map.id },
        });

        return map;
      });

      logger.info({ event: 'admin_maps.created', mapId: result.id, tenantId, name });
      res.json({ id: result.id, name: result.name });
    } catch (e: unknown) {
      logger.error({ event: 'admin_maps.create.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // DELETE /admin/maps/:id — cascade delete a map
  app.delete('/admin/maps/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    try {
      const map = await prisma.map.findUnique({ where: { id: req.params.id } });
      if (!map) return res.status(404).json({ error: 'map_not_found' });

      // Check if this map is the default for its tenant
      const tenant = await prisma.tenant.findUnique({ where: { id: map.tenantId } });
      if (tenant?.defaultMapName === map.name) {
        return res.status(400).json({ error: 'cannot_delete_default_map', message: 'This map is set as the tenant default. Change the default first.' });
      }

      await prisma.$transaction(async (tx) => {
        // Delete MapObjects
        await tx.mapObject.deleteMany({ where: { mapId: map.id } });
        // Delete MapChunks (via layers)
        const layers = await tx.mapLayer.findMany({ where: { mapId: map.id }, select: { id: true } });
        const layerIds = layers.map((l) => l.id);
        if (layerIds.length > 0) {
          await tx.mapChunk.deleteMany({ where: { layerId: { in: layerIds } } });
        }
        // Delete MapLayers
        await tx.mapLayer.deleteMany({ where: { mapId: map.id } });
        // Delete MapTilesets
        await tx.mapTileset.deleteMany({ where: { mapId: map.id } });
        // Delete Presences for rooms of this map
        const rooms = await tx.room.findMany({ where: { mapId: map.id }, select: { id: true } });
        const roomIds = rooms.map((r) => r.id);
        if (roomIds.length > 0) {
          await tx.presence.deleteMany({ where: { roomId: { in: roomIds } } });
        }
        // Delete Zones
        await tx.zone.deleteMany({ where: { mapId: map.id } });
        // Delete Rooms
        await tx.room.deleteMany({ where: { mapId: map.id } });
        // Delete Map
        await tx.map.delete({ where: { id: map.id } });
      });

      logger.info({ event: 'admin_maps.deleted', mapId: map.id, deletedBy: admin.userId });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin_maps.delete.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /admin/maps/:id/copy — deep copy a map to a (possibly different) tenant
  app.post('/admin/maps/:id/copy', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    const parse = copyMapSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.errors });

    try {
      const { targetTenantId, newName } = parse.data;

      const targetTenant = await prisma.tenant.findUnique({ where: { id: targetTenantId } });
      if (!targetTenant) return res.status(404).json({ error: 'target_tenant_not_found' });

      // Load original map with all relations
      const original = await prisma.map.findUnique({
        where: { id: req.params.id },
        include: {
          tilesets: { orderBy: { slot: 'asc' } },
          layers: { include: { chunks: true } },
          objects: true,
          rooms: { include: { zones: true } },
        },
      });
      if (!original) return res.status(404).json({ error: 'map_not_found' });

      const copyName = newName || `${original.name}-copy`;

      // Check name uniqueness
      const existing = await prisma.map.findUnique({ where: { tenantId_name: { tenantId: targetTenantId, name: copyName } } });
      if (existing) return res.status(400).json({ error: 'map_name_exists' });

      const result = await prisma.$transaction(async (tx) => {
        // 1. Create new map
        const newMap = await tx.map.create({
          data: {
            tenantId: targetTenantId,
            name: copyName,
            width: original.width,
            height: original.height,
            tileWidth: original.tileWidth,
            tileHeight: original.tileHeight,
            chunkSize: original.chunkSize,
            meta: original.meta as object,
          },
        });

        // 2. Copy MapTilesets
        for (const ts of original.tilesets) {
          await tx.mapTileset.create({
            data: {
              mapId: newMap.id,
              slot: ts.slot,
              key: ts.key,
              imageUrl: ts.imageUrl,
              tileWidth: ts.tileWidth,
              tileHeight: ts.tileHeight,
              margin: ts.margin,
              spacing: ts.spacing,
              hash: ts.hash,
              tileCount: ts.tileCount,
            },
          });
        }

        // 3. Copy MapLayers + MapChunks
        for (const layer of original.layers) {
          const newLayer = await tx.mapLayer.create({
            data: { mapId: newMap.id, name: layer.name, chunkSize: layer.chunkSize },
          });
          for (const chunk of layer.chunks) {
            await tx.mapChunk.create({
              data: {
                layerId: newLayer.id,
                x: chunk.x,
                y: chunk.y,
                version: chunk.version,
                encoding: chunk.encoding,
                data: chunk.data,
              },
            });
          }
        }

        // 4. Copy MapObjects
        for (const obj of original.objects) {
          await tx.mapObject.create({
            data: {
              mapId: newMap.id,
              assetPackUuid: obj.assetPackUuid,
              itemId: obj.itemId,
              category: obj.category,
              tileX: obj.tileX,
              tileY: obj.tileY,
              chunkX: obj.chunkX,
              chunkY: obj.chunkY,
              width: obj.width,
              height: obj.height,
              collide: obj.collide,
              zIndex: obj.zIndex,
              rotation: obj.rotation,
              flipX: obj.flipX,
              flipY: obj.flipY,
              scaleFactor: obj.scaleFactor,
              dataUrl: obj.dataUrl,
            },
          });
        }

        // 5. Copy Rooms + Zones (NOT presences)
        for (const room of original.rooms) {
          const newRoom = await tx.room.create({
            data: { name: room.name, tenantId: targetTenantId, mapId: newMap.id },
          });
          for (const zone of room.zones) {
            await tx.zone.create({
              data: {
                name: zone.name,
                capacity: zone.capacity,
                polygon: zone.polygon as object,
                roomId: newRoom.id,
                mapId: newMap.id,
                tenantId: targetTenantId,
              },
            });
          }
        }

        return newMap;
      });

      logger.info({ event: 'admin_maps.copied', sourceId: req.params.id, newMapId: result.id, targetTenantId });
      res.json({ id: result.id, name: result.name });
    } catch (e: unknown) {
      logger.error({ event: 'admin_maps.copy.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // POST /admin/maps/import — import a Tiled JSON map
  app.post('/admin/maps/import', importUpload.single('file'), async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no_file' });

    const tenantId = req.body?.tenantId;
    const mapName = req.body?.name;
    if (!tenantId || !mapName) return res.status(400).json({ error: 'missing_tenantId_or_name' });

    try {
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) return res.status(404).json({ error: 'tenant_not_found' });

      const existing = await prisma.map.findUnique({ where: { tenantId_name: { tenantId, name: mapName } } });
      if (existing) return res.status(400).json({ error: 'map_name_exists' });

      const json = JSON.parse(file.buffer.toString('utf-8'));
      const mapWidth: number = json.width || 32;
      const mapHeight: number = json.height || 32;
      const tileWidth: number = json.tilewidth || 16;
      const tileHeight: number = json.tileheight || 16;
      const chunkSize = 32;

      const tiledLayers: Array<{ type: string; name: string; data?: number[]; width?: number; height?: number; objects?: Array<Record<string, unknown>> }> = json.layers || [];
      const tiledTilesets: Array<{ firstgid: number; name: string; image?: string; tilewidth?: number; tileheight?: number; margin?: number; spacing?: number; tilecount?: number }> = json.tilesets || [];

      const result = await prisma.$transaction(async (tx) => {
        // 1. Create Map record
        const map = await tx.map.create({
          data: {
            tenantId,
            name: mapName,
            width: mapWidth,
            height: mapHeight,
            tileWidth,
            tileHeight,
            chunkSize,
            meta: {},
          },
        });

        // 2. Create MapTilesets
        for (let i = 0; i < tiledTilesets.length; i++) {
          const ts = tiledTilesets[i];
          await tx.mapTileset.create({
            data: {
              mapId: map.id,
              slot: i,
              key: ts.name || `tileset-${i}`,
              imageUrl: ts.image || '',
              tileWidth: ts.tilewidth || tileWidth,
              tileHeight: ts.tileheight || tileHeight,
              margin: ts.margin ?? null,
              spacing: ts.spacing ?? null,
              tileCount: ts.tilecount ?? null,
            },
          });
        }

        // 3. Create MapLayers + Chunks for tile layers
        for (const layer of tiledLayers) {
          if (layer.type === 'tilelayer' && layer.data) {
            const newLayer = await tx.mapLayer.create({
              data: { mapId: map.id, name: layer.name || 'unnamed', chunkSize },
            });

            const layerWidth = layer.width || mapWidth;
            const layerHeight = layer.height || mapHeight;
            const chunksX = Math.ceil(layerWidth / chunkSize);
            const chunksY = Math.ceil(layerHeight / chunkSize);

            for (let cy = 0; cy < chunksY; cy++) {
              for (let cx = 0; cx < chunksX; cx++) {
                // Extract tile data for this chunk
                const chunkData: number[] = [];
                for (let ty = 0; ty < chunkSize; ty++) {
                  for (let tx2 = 0; tx2 < chunkSize; tx2++) {
                    const globalX = cx * chunkSize + tx2;
                    const globalY = cy * chunkSize + ty;
                    if (globalX < layerWidth && globalY < layerHeight) {
                      chunkData.push(layer.data[globalY * layerWidth + globalX]);
                    } else {
                      chunkData.push(0);
                    }
                  }
                }

                // Skip all-zero chunks
                if (chunkData.every((v) => v === 0)) continue;

                const rlePairs = rleEncodeNumbers(chunkData);
                const buf = encodeRlePairsToBuffer(rlePairs);
                const u8 = new Uint8Array(buf);

                await tx.mapChunk.create({
                  data: {
                    layerId: newLayer.id,
                    x: cx,
                    y: cy,
                    version: 1,
                    encoding: 'rle',
                    data: u8,
                  },
                });
              }
            }
          }
        }

        // 4. Create MapObjects from object layers
        for (const layer of tiledLayers) {
          if (layer.type === 'objectgroup' && Array.isArray(layer.objects)) {
            for (const obj of layer.objects) {
              const ox = typeof obj.x === 'number' ? Math.floor((obj.x as number) / tileWidth) : 0;
              const oy = typeof obj.y === 'number' ? Math.floor((obj.y as number) / tileHeight) : 0;
              const ow = typeof obj.width === 'number' ? Math.max(1, Math.ceil((obj.width as number) / tileWidth)) : 1;
              const oh = typeof obj.height === 'number' ? Math.max(1, Math.ceil((obj.height as number) / tileHeight)) : 1;

              await tx.mapObject.create({
                data: {
                  mapId: map.id,
                  assetPackUuid: 'tiled-import',
                  itemId: (typeof obj.name === 'string' ? obj.name : '') || (typeof obj.type === 'string' ? obj.type : '') || `obj-${obj.id || 0}`,
                  category: 'objects',
                  tileX: ox,
                  tileY: oy,
                  chunkX: Math.floor(ox / chunkSize),
                  chunkY: Math.floor(oy / chunkSize),
                  width: ow,
                  height: oh,
                  collide: false,
                  zIndex: 0,
                  dataUrl: '',
                },
              });
            }
          }
        }

        // 5. Default room "lobby"
        await tx.room.create({
          data: { name: 'lobby', tenantId, mapId: map.id },
        });

        return map;
      });

      logger.info({ event: 'admin_maps.imported', mapId: result.id, tenantId, name: mapName });
      res.json({ id: result.id, name: result.name });
    } catch (e: unknown) {
      logger.error({ event: 'admin_maps.import.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'import_failed' });
    }
  });
}
