import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { broadcastMapUpdate, broadcastSpawnUpdate } from '../utils/broadcast.js';

export function registerMapRoutes(app: express.Application, prisma: PrismaClient) {
  // Maps list
  app.get('/maps', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const maps = await prisma.map.findMany({ where: { tenantId: tenant.id }, include: { zones: true, rooms: true } });
    res.json(maps);
  });

  // v2 Map State (READ-ONLY)
  app.get('/maps/:name/state-v2', async (req: express.Request, res: express.Response) => {
    try {
      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      let map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });

      const defaults = { width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 };

      if (!map) {
        try {
          map = await prisma.map.create({ data: { name, meta: {}, tenantId: tenant.id, ...defaults } });
          logger.info('[Map] Auto-created map on state-v2 fetch', { name, tenant: tenant.slug });
        } catch (e) {
          return res.status(500).json({ error: 'failed to create map' });
        }
      } else {
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
            logger.info('[Map] Auto-patched map dimensions on state-v2 fetch', { name, tenant: tenant.slug });
          } catch { }
        }
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
  app.get('/maps/:name/chunks', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ layer: z.string().min(1), keys: z.string().min(1) });
      const parse = schema.safeParse(req.query || {});
      if (!parse.success) return res.status(400).json({ error: 'layer and keys required' });

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, keys } = parse.data;
      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
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
  app.patch('/maps/:name/paint-rect', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({
        layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls']),
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

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, rect, tileRefId, values: rawValues, erase } = parse.data;

      logger.info('[Paint] Request', { map: name, layer: layerName, rect, erase, hasValues: !!rawValues, tileRefId });

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) {
        logger.warn('[Paint] map not found', { name, tenant: tenant.slug });
        return res.status(404).json({ error: 'map not found' });
      }

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
        broadcastMapUpdate(tenant.slug, 'chunks_updated', { map: name, layer: layerName, updates });
      }

      res.json({ updates });
    } catch (e: unknown) {
      logger.error('[Map] paint-rect failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // Tileset registration
  app.post('/maps/:name/tilesets', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ key: z.string().min(1), imageUrl: z.string().min(1), tileWidth: z.number().int().positive(), tileHeight: z.number().int().positive(), margin: z.number().int().nonnegative().optional(), spacing: z.number().int().nonnegative().optional(), hash: z.string().optional() });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const existing = await prisma.mapTileset.findFirst({ where: { mapId: map.id, key: parse.data.key } });
      if (existing) {
        try { logger.debug('[Tilesets] already registered, skipping', { map: name, key: parse.data.key }); } catch { }
        const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
        return res.json(tilesets);
      }

      const last = await prisma.mapTileset.findFirst({ where: { mapId: map.id }, orderBy: { slot: 'desc' } });
      const newSlot = last ? last.slot + 1 : 0;
      await prisma.mapTileset.create({ data: { mapId: map.id, slot: newSlot, ...parse.data } });
      try { logger.info('[Tilesets] registry add', { map: name, slot: newSlot, key: parse.data.key, url: parse.data.imageUrl }); } catch { }

      const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });

      broadcastMapUpdate(tenant.slug, 'tileset_registry_updated', { map: name, tilesetRegistry: tilesets });

      res.json({ tilesetRegistry: tilesets });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
        try { logger.warn('[Tilesets] duplicate slot (race condition), returning current registry'); } catch { }
        try {
          const name = req.params.name;
          const tenant = getTenantFromReq(req);
          if (tenant) {
            const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
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
  app.get('/maps/:name/editor-state', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    let map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
    if (!map) {
      map = await prisma.map.create({
        data: { name, meta: {}, tenantId: tenant.id, width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 }
      });
    }
    const meta = (map.meta as any) || {};
    try { logger.debug('[EditorState] GET', { map: name, tilesets: Array.isArray(meta.tilesets) ? meta.tilesets.length : 0, assets: Array.isArray(meta.assets) ? meta.assets.length : 0 }); } catch { }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
      tilesets: meta.tilesets ?? [],
      assets: meta.assets ?? [],
      zones: await prisma.zone.findMany({ where: { mapId: map.id }, select: { id: true, name: true, capacity: true, polygon: true } }),
      backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
      spawn: (meta.spawn && typeof (meta.spawn as any).x === 'number' && typeof (meta.spawn as any).y === 'number') ? meta.spawn : null,
    });
  });

  // Editor state PUT
  app.put('/maps/:name/editor-state', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
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
    try { logger.debug('[EditorState] PUT', { map: name, tilesets: Array.isArray(tilesets) ? tilesets.length : undefined, assets: Array.isArray(assets) ? assets.length : undefined, zones: Array.isArray(zones) ? zones.length : undefined, spawn: !!spawn }); } catch { }
    const found = await prisma.map.findFirst({ where: { name, tenantId: tenant.id }, include: { rooms: true } });
    const map = found ?? await prisma.map.create({
      data: { name, meta: {}, tenantId: tenant.id, width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 }
    });

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
      const prepared = [] as Array<{ name: string; capacity: number | null; polygon: any[] }>;
      for (const z of zones) {
        const zoneName = (z?.name || 'Zone').toString();
        const capacity = typeof (z as any)?.capacity === 'number' ? (z as any).capacity : null;
        let polygon: any = undefined;
        try {
          const anyZ: any = z as any;
          if (Array.isArray(anyZ?.points)) {
            polygon = anyZ.points;
          } else if (Array.isArray(anyZ?.polygon)) {
            polygon = anyZ.polygon;
          } else if (anyZ?.polygon && Array.isArray(anyZ.polygon.points)) {
            polygon = anyZ.polygon.points;
          }
        } catch { }
        if (Array.isArray(polygon) && polygon.length > 0) {
          prepared.push({ name: zoneName, capacity, polygon });
        }
      }
      const shouldUpdate = (zones.length === 0) || (prepared.length > 0) || (replaceZones === true);
      if (shouldUpdate) {
        await prisma.zone.deleteMany({ where: { mapId: map.id } });
        for (const z of prepared) {
          await prisma.zone.create({ data: { name: z.name, capacity: z.capacity ?? undefined, polygon: z.polygon, mapId: map.id, roomId: roomForZones?.id as string, tenantId: tenant.id } as any });
        }
      }
    }

    if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
      broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'spawn', pos: spawn });
      broadcastSpawnUpdate(spawn);
    }

    if (tilesets || assets || zones || backgroundColor || replaceZones) {
      broadcastMapUpdate(tenant.slug, 'editor_update', { type: 'all', map: name });
    }

    res.json({ ok: true });
  });

  // Admin: Zones delete
  app.delete('/maps/:name/zones', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden - admin required' });
    }
    const mapName = req.params.name || 'office';
    const zoneName = req.query.name as string | undefined;
    const zoneId = req.query.id as string | undefined;

    try {
      const map = await prisma.map.findFirst({ where: { name: mapName, tenantId: tenant.id } });
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

      logger.info('[Zones] Deleted zones', { map: mapName, zoneName, zoneId, deleted });
      res.json({ ok: true, deleted });
    } catch (e) {
      logger.error('[Zones] Delete failed', e);
      res.status(500).json({ error: 'delete failed' });
    }
  });

  // Admin: Zones list
  app.get('/maps/:name/zones', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const mapName = req.params.name || 'office';

    try {
      const map = await prisma.map.findFirst({ where: { name: mapName, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
      res.json(zones.map(z => ({ id: z.id, name: z.name, capacity: z.capacity, polygon: z.polygon })));
    } catch (e) {
      logger.error('[Zones] List failed', e);
      res.status(500).json({ error: 'list failed' });
    }
  });
}
