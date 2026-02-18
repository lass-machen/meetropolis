import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership, requireApiToken } from '../utils/authHelpers.js';
import { broadcastMapUpdate, broadcastSpawnUpdate } from '../utils/broadcast.js';
import { applyCollisionSideEffect } from '../utils/collisionSideEffect.js';

async function findMapById(prisma: PrismaClient, mapId: string, tenantId: string) {
  const map = await prisma.map.findFirst({ where: { id: mapId, tenantId } });
  return map;
}

export function registerMapRoutes(app: express.Application, prisma: PrismaClient) {
  // Maps list
  app.get('/maps', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const maps = await prisma.map.findMany({ where: { tenantId: tenant.id }, include: { zones: true, rooms: true } });
    res.json(maps);
  });

  // v2 Map State (READ-ONLY)
  app.get('/maps/:id/state-v2', async (req: express.Request, res: express.Response) => {
    try {
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      let map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });

      const defaults = { width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 };

      if (!map.width || !map.height || !map.tileWidth || !map.tileHeight) {
        try {
          map = await prisma.map.update({
            where: { id: map.id },
            data: {
              width: map.width ?? defaults.width,
              height: map.height ?? defaults.height,
              tileWidth: map.tileWidth ?? defaults.tileWidth,
              tileHeight: map.tileHeight ?? defaults.tileHeight,
            }
          });
          logger.info('[Map] Auto-patched map dimensions on state-v2 fetch', { mapId: map.id, tenant: tenant.slug });
        } catch { }
      }

      const tilesets = await prisma.mapTileset.findMany({
        where: { mapId: map.id },
        orderBy: { slot: 'asc' },
        select: { id: true, slot: true, key: true, imageUrl: true, tileWidth: true, tileHeight: true, margin: true, spacing: true, hash: true },
      });

      const layers = await prisma.mapLayer.findMany({ where: { mapId: map.id }, select: { id: true, name: true, chunkSize: true } });
      const layerIndex: Record<string, { keys: string[]; chunkSize: number }> = {};
      for (const layer of layers) {
        const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id }, select: { x: true, y: true } });
        const keys = chunks.map((c: { x: number; y: number }) => `${c.x}:${c.y}`);
        layerIndex[layer.name] = { keys, chunkSize: layer.chunkSize };
      }

      const mapMeta = {
        width: map.width ?? null,
        height: map.height ?? null,
        tileWidth: map.tileWidth ?? null,
        tileHeight: map.tileHeight ?? null,
        chunkSize: map.chunkSize ?? 32,
        version: map.version ?? null,
      };

      res.json({ mapMeta, tilesetRegistry: tilesets, layerIndex });
    } catch (e: unknown) {
      logger.error('[Map] state-v2 failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Chunks fetch
  app.get('/maps/:id/chunks', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ layer: z.string().min(1), keys: z.string().min(1) });
      const parse = schema.safeParse(req.query || {});
      if (!parse.success) return res.status(400).json({ error: 'layer and keys required' });

      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, keys } = parse.data;
      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });
      const layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } });
      if (!layer) {
        return res.json({ chunks: {} });
      }

      const keyList = keys.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      const wanted: Array<{ x: number; y: number; key: string }> = [];
      for (const k of keyList) {
        const [xs, ys] = k.split(':');
        const x = Number(xs);
        const y = Number(ys);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        wanted.push({ x, y, key: k });
      }
      if (wanted.length === 0) return res.json({ chunks: {} });

      const orList = wanted.map((w) => ({ x: w.x, y: w.y }));
      const found = await prisma.mapChunk.findMany({ where: { layerId: layer.id, OR: orList }, select: { x: true, y: true, version: true, encoding: true, data: true } });
      const out: Record<string, { version: number; encoding: string; data: string }> = {};
      for (const c of found) {
        const key = `${c.x}:${c.y}`;
        const dataBuffer = c.data instanceof Buffer ? c.data : Buffer.from(c.data as Uint8Array);
        out[key] = { version: c.version, encoding: c.encoding, data: dataBuffer.toString('base64') };
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.json({ chunks: out });
    } catch (e: unknown) {
      logger.error('[Map] chunks fetch failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Paint-rect (v2 WRITE)
  app.patch('/maps/:id/paint-rect', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({
        layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls', 'walls_auto']),
        rect: z.object({ x0: z.number().int(), y0: z.number().int(), x1: z.number().int(), y1: z.number().int() }),
        tileRefId: z.number().int().optional(),
        values: z.array(z.number().int()).optional(),
        erase: z.boolean().optional(),
      });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) {
        logger.warn('[Paint] invalid payload', parse.error);
        return res.status(400).json({ error: 'invalid payload' });
      }

      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, rect, tileRefId, values: rawValues, erase } = parse.data;

      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) {
        logger.warn('[Paint] map not found', { mapId: req.params.id, tenant: tenant.slug });
        return res.status(404).json({ error: 'map not found' });
      }

      logger.info('[Paint] Request', { mapId: map.id, mapName: map.name, layer: layerName, rect, erase, hasValues: !!rawValues, tileRefId });

      if (!erase && tileRefId === undefined && (!rawValues || rawValues.length === 0)) {
        return res.status(400).json({ error: 'invalid payload: missing tileRefId or values' });
      }

      let layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } });
      if (!layer) {
        layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: layerName, chunkSize: map.chunkSize ?? 32 } });
        logger.info('[Paint] created layer', { layerId: layer.id, name: layerName });
      }

      const chunkSize = layer.chunkSize || 32;
      const chunkCoordsToFetch: { x: number, y: number }[] = [];
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const cx = Math.floor(x / chunkSize);
          const cy = Math.floor(y / chunkSize);
          if (!chunkCoordsToFetch.find(c => c.x === cx && c.y === cy)) {
            chunkCoordsToFetch.push({ x: cx, y: cy });
          }
        }
      }

      const existingChunks = await prisma.mapChunk.findMany({
        where: { layerId: layer.id, OR: chunkCoordsToFetch },
      });

      interface ChunkData {
        id: string;
        x: number;
        y: number;
        version: number;
        encoding: string;
        data: Buffer | Uint8Array;
      }

      interface ChunkUpdate {
        chunk: ChunkData | undefined;
        cx: number;
        cy: number;
        modified: boolean;
        _decoded: number[];
      }

      const chunks = new Map<string, ChunkData>();
      for (const c of existingChunks) {
        chunks.set(`${c.x}:${c.y}`, c as ChunkData);
      }

      const chunkUpdates = new Map<string, ChunkUpdate>();
      const { decodeRlePairsFromBuffer, rleDecodeToNumbers, rleDecodeToBooleans } = await import('../../mapEncoding.js');

      const rectWidth = rect.x1 - rect.x0 + 1;

      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const cx = Math.floor(x / chunkSize);
          const cy = Math.floor(y / chunkSize);
          const chunkKey = `${cx}:${cy}`;

          let chunkData = chunkUpdates.get(chunkKey);
          if (!chunkData) {
            const existingChunk = chunks.get(chunkKey);
            chunkData = { chunk: existingChunk, cx, cy, modified: false, _decoded: [] };
            chunkUpdates.set(chunkKey, chunkData);
          }

          const rx = x % chunkSize;
          const ry = y % chunkSize;
          const idx = ry * chunkSize + rx;

          if (chunkData._decoded.length === 0) {
            const c = chunkData.chunk;
            if (c) {
              const dataBuffer = c.data instanceof Buffer ? c.data : Buffer.from(c.data);
              const pairs = decodeRlePairsFromBuffer(dataBuffer);
              chunkData._decoded = c.encoding === 'rle-bool' ? rleDecodeToBooleans(pairs, chunkSize * chunkSize).map(b => b ? 1 : 0) : rleDecodeToNumbers(pairs, chunkSize * chunkSize);
            } else {
              chunkData._decoded = new Array(chunkSize * chunkSize).fill(0);
            }
          }

          let val = 0;
          if (erase) {
            val = 0;
          } else if (rawValues && rawValues.length > 0) {
            const vy = y - rect.y0;
            const vx = x - rect.x0;
            const vIdx = vy * rectWidth + vx;
            val = rawValues[vIdx] || 0;
          } else {
            val = (tileRefId as number);
          }

          if (chunkData._decoded[idx] !== val) {
            chunkData._decoded[idx] = val;
            chunkData.modified = true;
          }
        }
      }

      interface ChunkUpdateResult {
        key: string;
        version: number;
        encoding: string;
        data: string;
      }

      const updates: ChunkUpdateResult[] = [];
      const { rleEncodeNumbers, rleEncodeBooleans, encodeRlePairsToBuffer } = await import('../../mapEncoding.js');
      const encoding = layerName === 'collision' ? 'rle-bool' : 'rle';

      for (const [key, data] of chunkUpdates.entries()) {
        if (!data.modified) continue;

        const chunkValues = data._decoded;
        const pairs = encoding === 'rle-bool'
          ? rleEncodeBooleans(chunkValues.map((v: number) => v !== 0))
          : rleEncodeNumbers(chunkValues);
        const buf = encodeRlePairsToBuffer(pairs);
        const u8 = new Uint8Array(buf);

        let chunk = chunks.get(key);
        if (!chunk) {
          chunk = await prisma.mapChunk.create({ data: { layerId: layer.id, x: data.cx, y: data.cy, version: 1, encoding, data: u8 } }) as ChunkData;
        } else {
          chunk = await prisma.mapChunk.update({ where: { id: chunk.id }, data: { version: chunk.version + 1, encoding, data: u8 } }) as ChunkData;
        }

        updates.push({ key, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
      }

      if (updates.length > 0) {
        broadcastMapUpdate(tenant.slug, 'chunks_updated', { mapId: map.id, mapName: map.name, layer: layerName, updates });
      }

      // Collision side-effect for walls_auto: set collision=1 where wall>0, collision=0 where wall=0
      let collisionUpdates: ChunkUpdateResult[] | undefined;
      if (layerName === 'walls_auto' && updates.length > 0) {
        collisionUpdates = await applyCollisionSideEffect({
          prisma,
          mapId: map.id,
          defaultChunkSize: map.chunkSize ?? 32,
          rect,
          wallChunkSize: chunkSize,
          wallChunkUpdates: chunkUpdates,
        });
        if (collisionUpdates.length > 0) {
          broadcastMapUpdate(tenant.slug, 'chunks_updated', { mapId: map.id, mapName: map.name, layer: 'collision', updates: collisionUpdates });
        }
      }

      res.json({ updates, collisionUpdates: collisionUpdates && collisionUpdates.length > 0 ? collisionUpdates : undefined });
    } catch (e: unknown) {
      logger.error('[Map] paint-rect failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Tileset registration
  app.post('/maps/:id/tilesets', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ key: z.string().min(1), imageUrl: z.string().min(1), tileWidth: z.number().int().positive(), tileHeight: z.number().int().positive(), margin: z.number().int().nonnegative().optional(), spacing: z.number().int().nonnegative().optional(), hash: z.string().optional() });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });

      const existing = await prisma.mapTileset.findFirst({ where: { mapId: map.id, key: parse.data.key } });
      if (existing) {
        try { logger.debug('[Tilesets] already registered, skipping', { mapId: map.id, key: parse.data.key }); } catch { }
        const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
        return res.json(tilesets);
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
            const map = await findMapById(prisma, req.params.id, tenant.id);
            if (map) {
              const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
              return res.json({ tilesetRegistry: tilesets });
            }
          }
        } catch { }
      }
      logger.error('[Tilesets] add failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Zones list (tenant-scoped)
  app.get('/zones', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const zones = await prisma.zone.findMany({ where: { tenantId: tenant.id } });
    res.json(zones);
  });

  // Editor state GET
  app.get('/maps/:id/editor-state', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const map = await findMapById(prisma, req.params.id, tenant.id);
    if (!map) return res.status(404).json({ error: 'map not found' });
    const meta = (map.meta as any) || {};
    try { logger.debug('[EditorState] GET', { mapId: map.id, tilesets: Array.isArray(meta.tilesets) ? meta.tilesets.length : 0, assets: Array.isArray(meta.assets) ? meta.assets.length : 0 }); } catch { }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
      tilesets: meta.tilesets ?? [],
      assets: meta.assets ?? [],
      zones: await prisma.zone.findMany({ where: { mapId: map.id }, select: { id: true, name: true, capacity: true, polygon: true, type: true, portalTarget: true, portalSpawnX: true, portalSpawnY: true } }),
      backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
      spawn: (meta.spawn && typeof (meta.spawn as any).x === 'number' && typeof (meta.spawn as any).y === 'number') ? meta.spawn : null,
    });
  });

  // Editor state PUT
  app.put('/maps/:id/editor-state', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const editorSchema = z.object({
      tilesets: z.array(z.any()).optional(),
      assets: z.array(z.any()).optional(),
      zones: z.array(z.any()).optional(),
      backgroundColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
      replaceZones: z.boolean().optional(),
      spawn: z.object({ x: z.number(), y: z.number() }).optional(),
    });
    const parse = editorSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid editor payload' });
    const { tilesets, assets, zones, backgroundColor, replaceZones, spawn } = parse.data;
    const map = await findMapById(prisma, req.params.id, tenant.id);
    if (!map) return res.status(404).json({ error: 'map not found' });
    try { logger.debug('[EditorState] PUT', { mapId: map.id, mapName: map.name, tilesets: Array.isArray(tilesets) ? tilesets.length : undefined, assets: Array.isArray(assets) ? assets.length : undefined, zones: Array.isArray(zones) ? zones.length : undefined, spawn: !!spawn }); } catch { }

    let roomForZones = await prisma.room.findFirst({ where: { mapId: map.id }, orderBy: { createdAt: 'asc' } });
    if (!roomForZones) {
      const lobbyId = `${map.id}:lobby`;
      try {
        roomForZones = await prisma.room.create({ data: { id: lobbyId, name: 'lobby', mapId: map.id, tenantId: tenant.id } });
      } catch {
        roomForZones = await prisma.room.findFirst({ where: { mapId: map.id } });
      }
    }

    const currentMeta = (map.meta as any) || {};
    await prisma.map.update({
      where: { id: map.id },
      data: {
        meta: {
          ...currentMeta,
          tilesets: tilesets ?? currentMeta.tilesets ?? [],
          assets: assets ?? currentMeta.assets ?? [],
          backgroundColor: backgroundColor ?? currentMeta.backgroundColor ?? undefined,
          spawn: spawn ?? currentMeta.spawn ?? undefined,
        } as any
      }
    });

    if (Array.isArray(zones)) {
      const prepared = [] as Array<{ name: string; capacity: number | null; polygon: any[]; type: string | null; portalTarget: string | null; portalSpawnX: number | null; portalSpawnY: number | null }>;
      for (const z of zones) {
        const zoneName = (z?.name || 'Zone').toString();
        const anyZ: any = z as any;
        const capacity = typeof anyZ?.capacity === 'number' ? anyZ.capacity : null;
        const zoneType = typeof anyZ?.type === 'string' ? anyZ.type : null;
        const portalTarget = typeof anyZ?.portalTarget === 'string' ? anyZ.portalTarget : null;
        const portalSpawnX = typeof anyZ?.portalSpawnX === 'number' ? anyZ.portalSpawnX : null;
        const portalSpawnY = typeof anyZ?.portalSpawnY === 'number' ? anyZ.portalSpawnY : null;
        let polygon: any = undefined;
        try {
          if (Array.isArray(anyZ?.points)) {
            polygon = anyZ.points;
          } else if (Array.isArray(anyZ?.polygon)) {
            polygon = anyZ.polygon;
          } else if (anyZ?.polygon && Array.isArray(anyZ.polygon.points)) {
            polygon = anyZ.polygon.points;
          }
        } catch { }
        if (Array.isArray(polygon) && polygon.length > 0) {
          prepared.push({ name: zoneName, capacity, polygon, type: zoneType, portalTarget, portalSpawnX, portalSpawnY });
        }
      }
      const shouldUpdate = (zones.length === 0) || (prepared.length > 0) || (replaceZones === true);
      if (shouldUpdate) {
        await prisma.zone.deleteMany({ where: { mapId: map.id } });
        for (const z of prepared) {
          await prisma.zone.create({ data: { name: z.name, capacity: z.capacity ?? undefined, polygon: z.polygon, type: z.type || null, portalTarget: z.portalTarget || null, portalSpawnX: z.portalSpawnX ?? null, portalSpawnY: z.portalSpawnY ?? null, mapId: map.id, roomId: roomForZones?.id as string, tenantId: tenant.id } as any });
        }
      }
    }

    if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
      broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'spawn', pos: spawn });
      broadcastSpawnUpdate(map.id, spawn);
    }

    if (tilesets || assets || zones || backgroundColor || replaceZones) {
      broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'all', mapId: map.id, mapName: map.name });
    }

    res.json({ ok: true });
  });

  // Resize map
  app.patch('/maps/:id/resize', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    const schema = z.object({
      width: z.number().int().min(8).max(512),
      height: z.number().int().min(8).max(512),
      dryRun: z.boolean().optional(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const { width, height, dryRun } = parse.data;

    try {
      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });

      const oldWidth = map.width ?? 32;
      const oldHeight = map.height ?? 32;
      const warnings: string[] = [];

      // Check for data loss when shrinking
      if (width < oldWidth || height < oldHeight) {
        // Count objects outside new bounds
        const objectsOutside = await prisma.mapObject.count({
          where: {
            mapId: map.id,
            OR: [
              { tileX: { gte: width } },
              { tileY: { gte: height } },
            ],
          },
        });
        if (objectsOutside > 0) {
          warnings.push(`${objectsOutside} object(s) will be outside the new map bounds`);
        }

        // Check spawn point
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

        // Check zones
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
      }

      if (dryRun) {
        return res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
      }

      await prisma.map.update({ where: { id: map.id }, data: { width, height } });
      broadcastMapUpdate(tenant.slug, 'map_resized', { mapId: map.id, mapName: map.name, oldWidth, oldHeight, newWidth: width, newHeight: height });
      logger.info('[Map] Resized', { mapId: map.id, mapName: map.name, oldWidth, oldHeight, newWidth: width, newHeight: height });

      res.json({ ok: true, warnings, oldWidth, oldHeight, newWidth: width, newHeight: height });
    } catch (e) {
      logger.error('[Map] resize failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Rename map
  app.patch('/maps/:id/rename', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    const schema = z.object({
      newName: z.string().min(1).max(100).trim(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const { newName } = parse.data;

    try {
      let oldName = '';
      await prisma.$transaction(async (tx) => {
        const map = await tx.map.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
        if (!map) throw new Error('MAP_NOT_FOUND');
        oldName = map.name;

        if (newName === oldName) return;

        const existing = await tx.map.findFirst({ where: { name: newName, tenantId: tenant.id } });
        if (existing) throw new Error('NAME_CONFLICT');

        await tx.map.update({ where: { id: map.id }, data: { name: newName } });

        // Cascade: tenant defaultMapName
        const currentTenant = await tx.tenant.findUnique({ where: { id: tenant.id } });
        if (currentTenant?.defaultMapName === oldName) {
          await tx.tenant.update({ where: { id: tenant.id }, data: { defaultMapName: newName } });
        }

        // Cascade: portal targets
        await tx.zone.updateMany({
          where: { tenantId: tenant.id, portalTarget: oldName },
          data: { portalTarget: newName },
        });

        // Cascade: presence mapName
        await tx.presence.updateMany({
          where: { tenantId: tenant.id, mapName: oldName },
          data: { mapName: newName },
        });

        // Cascade: NPC mapName
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
      if (e?.message === 'MAP_NOT_FOUND') return res.status(404).json({ error: 'map not found' });
      if (e?.message === 'NAME_CONFLICT') return res.status(409).json({ error: 'A map with that name already exists' });
      logger.error('[Map] rename failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Admin: Zones delete
  app.delete('/maps/:id/zones', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden - admin required' });
    }
    const zoneName = req.query.name as string | undefined;
    const zoneId = req.query.id as string | undefined;

    try {
      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });

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
  });

  // Admin: Zones list
  app.get('/maps/:id/zones', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    try {
      const map = await findMapById(prisma, req.params.id, tenant.id);
      if (!map) return res.status(404).json({ error: 'map not found' });

      const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
      res.json(zones.map(z => ({ id: z.id, name: z.name, capacity: z.capacity, polygon: z.polygon, type: z.type, portalTarget: z.portalTarget, portalSpawnX: z.portalSpawnX, portalSpawnY: z.portalSpawnY })));
    } catch (e) {
      logger.error('[Zones] List failed', e);
      res.status(500).json({ error: 'list failed' });
    }
  });
}
