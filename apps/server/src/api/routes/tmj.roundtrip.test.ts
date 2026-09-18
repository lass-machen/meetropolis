import type express from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Tenant } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  encodeRlePairsToBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
} from '../../mapEncoding.js';
import { setAuthResolution } from '../utils/authState.js';
import { handleTmjExport, handleTmjImport } from './tmj.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../utils/broadcast.js', () => ({ broadcastMapUpdate: vi.fn() }));

const TENANT = { id: 'tenant', slug: 'tenant', name: 'Tenant' } as Tenant;
const MAP = {
  id: 'map',
  tenantId: TENANT.id,
  name: 'office',
  meta: {},
  width: 2,
  height: 2,
  tileWidth: 16,
  tileHeight: 16,
  chunkSize: 2,
};

interface LayerRow {
  id: string;
  mapId: string;
  name: string;
  chunkSize: number;
}

interface ChunkRow {
  id: string;
  layerId: string;
  x: number;
  y: number;
  version: number;
  encoding: string;
  data: Uint8Array;
}

function boolData(values: number[]): Uint8Array {
  return new Uint8Array(encodeRlePairsToBuffer(rleEncodeBooleans(values.map(Boolean))));
}

function createTmjPrisma() {
  const layers: LayerRow[] = [
    { id: 'derived', mapId: MAP.id, name: 'collision', chunkSize: 2 },
    { id: 'manual', mapId: MAP.id, name: 'collision_manual', chunkSize: 2 },
  ];
  const chunks: ChunkRow[] = [
    {
      id: 'derived-chunk',
      layerId: 'derived',
      x: 0,
      y: 0,
      version: 1,
      encoding: 'rle-bool',
      data: boolData([1, 0, 0, 0]),
    },
    {
      id: 'manual-chunk',
      layerId: 'manual',
      x: 0,
      y: 0,
      version: 1,
      encoding: 'rle-bool',
      data: boolData([1, 0, 0, 0]),
    },
  ];
  let nextLayer = 1;
  let nextChunk = 1;
  let failLayerCreate = false;

  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    map: {
      findFirst: vi.fn().mockResolvedValue(MAP),
      update: vi.fn().mockResolvedValue(MAP),
    },
    mapTileset: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
    },
    mapLayer: {
      findMany: vi.fn(({ where }: { where: { name?: { notIn?: string[] } } }) =>
        layers.filter((layer) => !where.name?.notIn?.includes(layer.name)),
      ),
      findUnique: vi.fn(({ where }: { where: { mapId_name: { name: string } } }) =>
        layers.find((layer) => layer.name === where.mapId_name.name),
      ),
      create: vi.fn(({ data }: { data: { mapId: string; name: string; chunkSize: number } }) => {
        if (failLayerCreate) throw new Error('injected layer failure');
        const layer = { id: `new-layer-${nextLayer++}`, ...data };
        layers.push(layer);
        return layer;
      }),
      deleteMany: vi.fn(() => {
        const count = layers.length;
        layers.splice(0);
        return { count };
      }),
    },
    mapChunk: {
      findMany: vi.fn(({ where }: { where: { layerId: string; OR?: Array<{ x: number; y: number }> } }) =>
        chunks.filter(
          (chunk) =>
            chunk.layerId === where.layerId &&
            (!where.OR || where.OR.some((coord) => coord.x === chunk.x && coord.y === chunk.y)),
        ),
      ),
      create: vi.fn(({ data }: { data: Omit<ChunkRow, 'id'> }) => {
        const chunk = { id: `new-chunk-${nextChunk++}`, ...data };
        chunks.push(chunk);
        return chunk;
      }),
      updateMany: vi.fn(
        ({ where, data }: { where: { id: string; version: number }; data: Record<string, unknown> }) => {
          const chunk = chunks.find((candidate) => candidate.id === where.id && candidate.version === where.version);
          if (!chunk) return { count: 0 };
          chunk.version += 1;
          chunk.encoding = String(data.encoding);
          chunk.data = data.data as Uint8Array;
          return { count: 1 };
        },
      ),
      deleteMany: vi.fn(({ where }: { where: { layerId: string } }) => {
        const retained = chunks.filter((chunk) => chunk.layerId !== where.layerId);
        const count = chunks.length - retained.length;
        chunks.splice(0, chunks.length, ...retained);
        return { count };
      }),
    },
    mapAutotile: { findMany: vi.fn().mockResolvedValue([]) },
    mapObject: { findMany: vi.fn().mockResolvedValue([]) },
    zone: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      const savedLayers = layers.map((layer) => ({ ...layer }));
      const savedChunks = chunks.map((chunk) => ({ ...chunk, data: new Uint8Array(chunk.data) }));
      try {
        return await work(db);
      } catch (error) {
        layers.splice(0, layers.length, ...savedLayers);
        chunks.splice(0, chunks.length, ...savedChunks);
        throw error;
      }
    }),
  };
  return {
    prisma: db as unknown as PrismaClient,
    layers,
    chunks,
    mapUpdate: db.map.update,
    failNextLayerCreate: () => {
      failLayerCreate = true;
    },
  };
}

function routeRequest(body?: unknown): express.Request {
  const req = {
    headers: {},
    params: { id: MAP.id },
    query: {},
    body,
  } as unknown as express.Request;
  req.tenant = TENANT;
  setAuthResolution(req, { auth: { userId: 'user', sessionId: 'session', tokenHash: 'hash' } });
  return req;
}

function routeResponse(): express.Response & { body?: unknown; statusCode: number } {
  const res = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader: vi.fn(),
  } as unknown as express.Response & { body?: unknown; statusCode: number };
  return res;
}

function importRequest(tmj: unknown): express.Request {
  const req = routeRequest() as express.Request & {
    files: { file: Array<{ buffer: Buffer }>; images: never[] };
  };
  req.files = { file: [{ buffer: Buffer.from(JSON.stringify(tmj)) }], images: [] };
  return req;
}

describe('TMJ route roundtrip', () => {
  it('hides the internal manual layer and reimports exported collision atomically as a manual source', async () => {
    const state = createTmjPrisma();
    const exportResponse = routeResponse();
    await handleTmjExport(state.prisma, routeRequest(), exportResponse);

    expect(exportResponse.statusCode).toBe(200);
    const exported = exportResponse.body as { layers: Array<{ name: string }> };
    expect(exported.layers.map((layer) => layer.name)).toEqual(['collision']);

    const importResponse = routeResponse();
    await handleTmjImport(state.prisma, importRequest(exported), importResponse);

    expect(importResponse.statusCode).toBe(200);
    expect(state.layers.map((layer) => layer.name).sort()).toEqual(['collision', 'collision_manual']);
    const derived = state.layers.find((layer) => layer.name === 'collision')!;
    const derivedChunk = state.chunks.find((chunk) => chunk.layerId === derived.id)!;
    expect(rleDecodeToBooleans(decodeRlePairsFromBuffer(Buffer.from(derivedChunk.data)), 4)[0]).toBe(true);
  });

  it('rolls a replace import back when a post-delete write fails', async () => {
    const state = createTmjPrisma();
    state.failNextLayerCreate();
    const tmj = {
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [],
      layers: [{ name: 'collision', type: 'tilelayer', width: 2, height: 2, data: [1, 0, 0, 0] }],
    };

    const response = routeResponse();
    await handleTmjImport(state.prisma, importRequest(tmj), response);

    expect(response.statusCode).toBe(500);
    expect(state.layers.map((layer) => layer.name).sort()).toEqual(['collision', 'collision_manual']);
    expect(state.chunks).toHaveLength(2);
  });

  it('rejects walls_auto before the first mutation', async () => {
    const state = createTmjPrisma();
    const tmj = {
      width: 2,
      height: 2,
      tilewidth: 16,
      tileheight: 16,
      tilesets: [],
      layers: [{ name: 'walls_auto', type: 'tilelayer', width: 2, height: 2, data: [1, 0, 0, 0] }],
    };

    const response = routeResponse();
    await handleTmjImport(state.prisma, importRequest(tmj), response);

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({ error: 'reserved_layer', layer: 'walls_auto' });
    expect(state.mapUpdate).not.toHaveBeenCalled();
  });
});
