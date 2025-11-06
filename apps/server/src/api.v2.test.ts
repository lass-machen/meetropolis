import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal in-memory prisma for v2 endpoints
type MapRec = { id: string; name: string; tenantId: string; meta: any; chunkSize?: number; width?: number; height?: number; tileWidth?: number; tileHeight?: number; version?: number };
type LayerRec = { id: string; mapId: string; name: string; chunkSize: number };
type ChunkRec = { id: string; layerId: string; x: number; y: number; version: number; encoding: string; data: Uint8Array };
type TilesetRec = { id: string; mapId: string; slot: number; key: string; imageUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number; hash?: string };

const mem = {
  maps: [] as MapRec[],
  layers: [] as LayerRec[],
  chunks: [] as ChunkRec[],
  tilesets: [] as TilesetRec[],
  zones: [] as any[],
};

vi.mock('@prisma/client', () => {
  class PrismaClientMock {
    map = {
      async findFirst({ where }: any) {
        return mem.maps.find(m => m.name === where.name && m.tenantId === where.tenantId) || null;
      },
      async create({ data }: any) {
        const rec: MapRec = { id: `m_${Math.random().toString(36).slice(2,8)}`, meta: {}, ...data };
        mem.maps.push(rec);
        return rec as any;
      },
      async update({ where, data }: any) {
        const m = mem.maps.find(mm => mm.id === where.id);
        if (!m) throw new Error('map not found');
        Object.assign(m, data);
        return m as any;
      }
    };
    mapLayer = {
      async findMany({ where }: any) {
        return mem.layers.filter(l => l.mapId === where.mapId) as any;
      },
      async findUnique({ where }: any) {
        const { mapId, name } = where.mapId_name;
        return mem.layers.find(l => l.mapId === mapId && l.name === name) || null;
      },
      async create({ data }: any) {
        const rec: LayerRec = { id: `l_${Math.random().toString(36).slice(2,8)}`, ...data };
        mem.layers.push(rec);
        return rec as any;
      },
    };
    mapChunk = {
      async findMany({ where, select }: any) {
        const list = mem.chunks.filter(c => c.layerId === where.layerId && (!where.OR || where.OR.some((k: any) => k.x === c.x && k.y === c.y)));
        return list.map(c => ({ x: c.x, y: c.y, version: c.version, encoding: c.encoding, data: c.data })) as any;
      },
      async findUnique({ where }: any) {
        const { layerId, x, y } = where.layerId_x_y;
        return mem.chunks.find(c => c.layerId === layerId && c.x === x && c.y === y) || null;
      },
      async create({ data }: any) {
        const rec: ChunkRec = { id: `c_${Math.random().toString(36).slice(2,8)}`, ...data };
        mem.chunks.push(rec);
        return rec as any;
      },
      async update({ where, data }: any) {
        const c = mem.chunks.find(cc => cc.id === where.id);
        if (!c) throw new Error('chunk not found');
        Object.assign(c, data);
        return c as any;
      },
    };
    mapTileset = {
      async findMany({ where, orderBy, select }: any) {
        const list = mem.tilesets.filter(t => t.mapId === where.mapId);
        list.sort((a,b) => a.slot - b.slot);
        return list.map(t => ({ id: t.id, slot: t.slot, key: t.key, imageUrl: t.imageUrl, tileWidth: t.tileWidth, tileHeight: t.tileHeight, margin: t.margin, spacing: t.spacing, hash: t.hash })) as any;
      },
      async findFirst({ where, orderBy }: any) {
        const list = mem.tilesets.filter(t => t.mapId === where.mapId);
        list.sort((a,b) => b.slot - a.slot);
        return list[0] || null;
      },
      async create({ data }: any) {
        const rec: TilesetRec = { id: `ts_${Math.random().toString(36).slice(2,8)}`, ...data };
        mem.tilesets.push(rec);
        return rec as any;
      },
    };
    zone = {
      async findMany({ where, select }: any) { return [] as any; },
      async deleteMany() { return; },
      async create() { return {} as any; },
    };
    tenant = { async findUnique() { return { id: 't1', slug: 'default' } as any; }, async create({ data }: any) { return { id: 't1', slug: data.slug } as any; } };
    membership = { async findUnique() { return null; } };
    apiToken = { async findUnique() { return null; }, async update() { return; } };
  }
  return { PrismaClient: PrismaClientMock };
});

import { registerApi } from './api.js';

function createApp() {
  const app = express();
  app.use(cookieParser() as any);
  app.use(express.json() as any);
  app.use(express.urlencoded({ extended: true }) as any);
  // Attach a default tenant for tests
  app.use((req, _res, next) => { (req as any).tenant = { id: 't1', slug: 'default' }; next(); });
  registerApi(app as any);
  // Seed one map and tileset registry entry
  if (!mem.maps.find(m => m.name === 'test')) mem.maps.push({ id: 'm_test', name: 'test', tenantId: 't1', meta: {}, chunkSize: 32, width: 64, height: 64, tileWidth: 16, tileHeight: 16 });
  if (!mem.tilesets.find(t => t.mapId === 'm_test')) mem.tilesets.push({ id: 'ts1', mapId: 'm_test', slot: 0, key: 'office_tiles', imageUrl: '/tiles.png', tileWidth: 16, tileHeight: 16 });
  return app;
}

describe('v2 map editing', () => {
  beforeEach(() => {
    mem.layers = [];
    mem.chunks = [];
  });

  it('paints a ground rect and returns chunk from /chunks', async () => {
    const app = createApp();
    const patch = await request(app)
      .patch('/maps/test/paint-rect')
      .set('x-tenant', 'default')
      .send({ layer: 'ground', rect: { x0: 0, y0: 0, x1: 1, y1: 0 }, tileRefId: ((0 << 16) | 2) });
    expect(patch.status).toBe(200);
    const chunks = patch.body.updates;
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks[0].encoding).toBe('rle');

    const get = await request(app)
      .get('/maps/test/chunks')
      .set('x-tenant', 'default')
      .query({ layer: 'ground', keys: '0:0' });
    expect(get.status).toBe(200);
    const payload = get.body.chunks['0:0'];
    expect(payload).toBeTruthy();
    expect(payload.encoding).toBe('rle');
    expect(typeof payload.data).toBe('string');
  });

  it('paints and erases collision using rle-bool', async () => {
    const app = createApp();
    const setRes = await request(app)
      .patch('/maps/test/paint-rect')
      .set('x-tenant', 'default')
      .send({ layer: 'collision', rect: { x0: 2, y0: 2, x1: 3, y1: 2 }, erase: false, tileRefId: 1 });
    expect(setRes.status).toBe(200);
    const setChunk = setRes.body.updates[0];
    expect(setChunk.encoding).toBe('rle-bool');

    const delRes = await request(app)
      .patch('/maps/test/paint-rect')
      .set('x-tenant', 'default')
      .send({ layer: 'collision', rect: { x0: 2, y0: 2, x1: 3, y1: 2 }, erase: true });
    expect(delRes.status).toBe(200);
    const get = await request(app)
      .get('/maps/test/chunks')
      .set('x-tenant', 'default')
      .query({ layer: 'collision', keys: '0:0' });
    expect(get.status).toBe(200);
    const payload = get.body.chunks['0:0'];
    expect(payload).toBeTruthy();
    expect(payload.encoding).toBe('rle-bool');
  });
});


