import type express from 'express';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { z } from 'zod';
import multer from 'multer';
import { logger } from '../../logger.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { rleEncodeNumbers, encodeRlePairsToBuffer } from '../../mapEncoding.js';
import type { RequestWithMulterFile } from '../../types/multer.js';

type TxClient = Prisma.TransactionClient;

type OriginalMapWithRelations = Prisma.MapGetPayload<{
  include: {
    tilesets: { orderBy: { slot: 'asc' } };
    layers: { include: { chunks: true } };
    objects: true;
    rooms: { include: { zones: true } };
  };
}>;

async function resolveCopyName(prisma: PrismaClient, targetTenantId: string, baseName: string): Promise<string> {
  let copyName = baseName;
  let suffix = 1;
  while (await prisma.map.findUnique({ where: { tenantId_name: { tenantId: targetTenantId, name: copyName } } })) {
    suffix++;
    copyName = `${baseName}-${suffix}`;
  }
  return copyName;
}

async function copyTilesets(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const ts of original.tilesets) {
    await tx.mapTileset.create({
      data: {
        mapId: newMapId,
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
}

async function copyLayersAndChunks(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const layer of original.layers) {
    const newLayer = await tx.mapLayer.create({
      data: { mapId: newMapId, name: layer.name, chunkSize: layer.chunkSize },
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
}

async function copyObjects(tx: TxClient, original: OriginalMapWithRelations, newMapId: string): Promise<void> {
  for (const obj of original.objects) {
    await tx.mapObject.create({
      data: {
        mapId: newMapId,
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
}

async function copyRoomsAndZones(
  tx: TxClient,
  original: OriginalMapWithRelations,
  newMapId: string,
  targetTenantId: string,
): Promise<void> {
  for (const room of original.rooms) {
    const newRoom = await tx.room.create({
      data: { name: room.name, tenantId: targetTenantId, mapId: newMapId },
    });
    for (const zone of room.zones) {
      await tx.zone.create({
        data: {
          name: zone.name,
          capacity: zone.capacity,
          polygon: zone.polygon as Prisma.InputJsonValue,
          type: zone.type,
          portalTarget: zone.portalTarget,
          portalSpawnX: zone.portalSpawnX,
          portalSpawnY: zone.portalSpawnY,
          roomId: newRoom.id,
          mapId: newMapId,
          tenantId: targetTenantId,
        },
      });
    }
  }
}

/**
 * Deep-copy a map (with all tilesets, layers, chunks, objects, rooms, zones)
 * to a target tenant. Resolves name collisions by appending `-2`, `-3`, etc.
 */
export async function copyMapToTenant(
  prisma: PrismaClient,
  sourceMapId: string,
  targetTenantId: string,
  newName?: string,
): Promise<{ id: string; name: string }> {
  const original = await prisma.map.findUnique({
    where: { id: sourceMapId },
    include: {
      tilesets: { orderBy: { slot: 'asc' } },
      layers: { include: { chunks: true } },
      objects: true,
      rooms: { include: { zones: true } },
    },
  });
  if (!original) throw new Error('source_map_not_found');

  const baseName = newName || `${original.name}-copy`;
  const copyName = await resolveCopyName(prisma, targetTenantId, baseName);

  const result = await prisma.$transaction(async (tx) => {
    const newMap = await tx.map.create({
      data: {
        tenantId: targetTenantId,
        name: copyName,
        width: original.width,
        height: original.height,
        tileWidth: original.tileWidth,
        tileHeight: original.tileHeight,
        chunkSize: original.chunkSize,
        meta: original.meta as Prisma.InputJsonValue,
      },
    });

    await copyTilesets(tx, original, newMap.id);
    await copyLayersAndChunks(tx, original, newMap.id);
    await copyObjects(tx, original, newMap.id);
    await copyRoomsAndZones(tx, original, newMap.id, targetTenantId);

    return newMap;
  });

  return { id: result.id, name: result.name };
}

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

interface TiledObject {
  id?: number | string;
  name?: unknown;
  type?: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

type TiledLayer = {
  type: string;
  name: string;
  data?: number[];
  width?: number;
  height?: number;
  objects?: TiledObject[];
};
type TiledTileset = {
  firstgid: number;
  name: string;
  image?: string;
  tilewidth?: number;
  tileheight?: number;
  margin?: number;
  spacing?: number;
  tilecount?: number;
};

interface TiledMapJson {
  width?: number;
  height?: number;
  tilewidth?: number;
  tileheight?: number;
  layers?: TiledLayer[];
  tilesets?: TiledTileset[];
}

async function importTilesetsFromTiled(
  tx: TxClient,
  mapId: string,
  tilesets: TiledTileset[],
  tileWidth: number,
  tileHeight: number,
) {
  for (let i = 0; i < tilesets.length; i++) {
    const ts = tilesets[i];
    await tx.mapTileset.create({
      data: {
        mapId,
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
}

function extractChunkData(
  layer: TiledLayer,
  cx: number,
  cy: number,
  chunkSize: number,
  layerWidth: number,
  layerHeight: number,
): number[] {
  const chunkData: number[] = [];
  for (let ty = 0; ty < chunkSize; ty++) {
    for (let tx2 = 0; tx2 < chunkSize; tx2++) {
      const globalX = cx * chunkSize + tx2;
      const globalY = cy * chunkSize + ty;
      if (globalX < layerWidth && globalY < layerHeight) {
        chunkData.push(layer.data![globalY * layerWidth + globalX]);
      } else {
        chunkData.push(0);
      }
    }
  }
  return chunkData;
}

async function importTileLayers(
  tx: TxClient,
  mapId: string,
  layers: TiledLayer[],
  chunkSize: number,
  mapWidth: number,
  mapHeight: number,
) {
  for (const layer of layers) {
    if (layer.type !== 'tilelayer' || !layer.data) continue;

    const newLayer = await tx.mapLayer.create({
      data: { mapId, name: layer.name || 'unnamed', chunkSize },
    });

    const layerWidth = layer.width || mapWidth;
    const layerHeight = layer.height || mapHeight;
    const chunksX = Math.ceil(layerWidth / chunkSize);
    const chunksY = Math.ceil(layerHeight / chunkSize);

    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkData = extractChunkData(layer, cx, cy, chunkSize, layerWidth, layerHeight);
        if (chunkData.every((v) => v === 0)) continue;

        const rlePairs = rleEncodeNumbers(chunkData);
        const buf = encodeRlePairsToBuffer(rlePairs);
        const u8 = new Uint8Array(buf);

        await tx.mapChunk.create({
          data: { layerId: newLayer.id, x: cx, y: cy, version: 1, encoding: 'rle', data: u8 },
        });
      }
    }
  }
}

async function importObjectLayers(
  tx: TxClient,
  mapId: string,
  layers: TiledLayer[],
  tileWidth: number,
  tileHeight: number,
  chunkSize: number,
) {
  for (const layer of layers) {
    if (layer.type !== 'objectgroup' || !Array.isArray(layer.objects)) continue;

    for (const obj of layer.objects) {
      const ox = typeof obj.x === 'number' ? Math.floor(obj.x / tileWidth) : 0;
      const oy = typeof obj.y === 'number' ? Math.floor(obj.y / tileHeight) : 0;
      const ow = typeof obj.width === 'number' ? Math.max(1, Math.ceil(obj.width / tileWidth)) : 1;
      const oh = typeof obj.height === 'number' ? Math.max(1, Math.ceil(obj.height / tileHeight)) : 1;

      await tx.mapObject.create({
        data: {
          mapId,
          assetPackUuid: 'tiled-import',
          itemId:
            (typeof obj.name === 'string' ? obj.name : '') ||
            (typeof obj.type === 'string' ? obj.type : '') ||
            `obj-${typeof obj.id === 'string' || typeof obj.id === 'number' ? obj.id : 0}`,
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

function importTiledMap(prisma: PrismaClient, tenantId: string, mapName: string, json: TiledMapJson) {
  const mapWidth: number = json.width || 32;
  const mapHeight: number = json.height || 32;
  const tileWidth: number = json.tilewidth || 16;
  const tileHeight: number = json.tileheight || 16;
  const chunkSize = 32;

  const tiledLayers: TiledLayer[] = json.layers || [];
  const tiledTilesets: TiledTileset[] = json.tilesets || [];

  return prisma.$transaction(async (tx) => {
    const map = await tx.map.create({
      data: { tenantId, name: mapName, width: mapWidth, height: mapHeight, tileWidth, tileHeight, chunkSize, meta: {} },
    });

    await importTilesetsFromTiled(tx, map.id, tiledTilesets, tileWidth, tileHeight);
    await importTileLayers(tx, map.id, tiledLayers, chunkSize, mapWidth, mapHeight);
    await importObjectLayers(tx, map.id, tiledLayers, tileWidth, tileHeight, chunkSize);

    await tx.room.create({ data: { name: 'lobby', tenantId, mapId: map.id } });

    return map;
  });
}

async function handleImportAdminMap(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const file = (req as RequestWithMulterFile).file;
  if (!file) {
    res.status(400).json({ error: 'no_file' });
    return;
  }

  const body = (req.body ?? {}) as { tenantId?: string; name?: string };
  const tenantId = body.tenantId;
  const mapName = body.name;
  if (!tenantId || !mapName) {
    res.status(400).json({ error: 'missing_tenantId_or_name' });
    return;
  }

  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      res.status(404).json({ error: 'tenant_not_found' });
      return;
    }

    const existing = await prisma.map.findUnique({ where: { tenantId_name: { tenantId, name: mapName } } });
    if (existing) {
      res.status(400).json({ error: 'map_name_exists' });
      return;
    }

    const json = JSON.parse(file.buffer.toString('utf-8')) as TiledMapJson;
    const result = await importTiledMap(prisma, tenantId, mapName, json);

    logger.info({ event: 'admin_maps.imported', mapId: result.id, tenantId, name: mapName });
    res.json({ id: result.id, name: result.name });
  } catch (e: unknown) {
    logger.error({ event: 'admin_maps.import.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'import_failed' });
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
