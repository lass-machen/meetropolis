import type express from 'express';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { logger } from '../../logger.js';
import { requireSuperAdmin } from '../utils/authHelpers.js';
import { rleEncodeNumbers, encodeRlePairsToBuffer } from '../../mapEncoding.js';
import type { RequestWithMulterFile } from '../../types/multer.js';

type TxClient = Prisma.TransactionClient;

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

export async function handleImportAdminMap(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
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
