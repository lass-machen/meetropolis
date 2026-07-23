import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { pathParam } from '../utils/requestHelpers.js';
import { broadcastMapUpdate } from '../utils/broadcast.js';
import { applyCollisionSideEffect } from '../utils/collisionSideEffect.js';
import { findMapById } from './maps.read.js';
import { resolveEditorMemberTenant } from './maps.editor.js';
import type { RlePair } from '../../mapEncoding.js';

type DecodePairsFn = (buf: Buffer) => RlePair[];
type RleNumbersFn = (pairs: RlePair[], total: number) => number[];
type RleBoolsFn = (pairs: RlePair[], total: number) => boolean[];

const paintSchema = z.object({
  layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls', 'walls_auto']),
  rect: z.object({ x0: z.number().int(), y0: z.number().int(), x1: z.number().int(), y1: z.number().int() }),
  tileRefId: z.number().int().optional(),
  values: z.array(z.number().int()).optional(),
  erase: z.boolean().optional(),
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

interface ChunkUpdateResult {
  key: string;
  version: number;
  encoding: string;
  data: string;
}

function collectChunkCoords(rect: { x0: number; y0: number; x1: number; y1: number }, chunkSize: number) {
  const out: { x: number; y: number }[] = [];
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const cx = Math.floor(x / chunkSize);
      const cy = Math.floor(y / chunkSize);
      if (!out.find((c) => c.x === cx && c.y === cy)) out.push({ x: cx, y: cy });
    }
  }
  return out;
}

function decodeChunkIntoUpdate(
  cd: ChunkUpdate,
  chunkSize: number,
  decodeRlePairsFromBuffer: DecodePairsFn,
  rleDecodeToNumbers: RleNumbersFn,
  rleDecodeToBooleans: RleBoolsFn,
) {
  if (cd._decoded.length !== 0) return;
  const c = cd.chunk;
  if (c) {
    // Prisma Buffer fields are typed as Buffer<any>; normalize through Uint8Array.
    const raw: unknown = c.data;
    const bytes = raw instanceof Buffer ? new Uint8Array(raw) : (raw as Uint8Array);
    const dataBuffer = Buffer.from(bytes);
    const pairs = decodeRlePairsFromBuffer(dataBuffer);
    cd._decoded =
      c.encoding === 'rle-bool'
        ? rleDecodeToBooleans(pairs, chunkSize * chunkSize).map((b) => (b ? 1 : 0))
        : rleDecodeToNumbers(pairs, chunkSize * chunkSize);
  } else {
    cd._decoded = new Array<number>(chunkSize * chunkSize).fill(0);
  }
}

async function buildChunkUpdates(params: {
  rect: { x0: number; y0: number; x1: number; y1: number };
  chunkSize: number;
  existingChunks: Map<string, ChunkData>;
  tileRefId: number | undefined;
  rawValues: number[] | undefined;
  erase: boolean | undefined;
}) {
  const { rect, chunkSize, existingChunks, tileRefId, rawValues, erase } = params;
  const { decodeRlePairsFromBuffer, rleDecodeToNumbers, rleDecodeToBooleans } = await import('../../mapEncoding.js');

  const chunkUpdates = new Map<string, ChunkUpdate>();
  const rectWidth = rect.x1 - rect.x0 + 1;

  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const cx = Math.floor(x / chunkSize);
      const cy = Math.floor(y / chunkSize);
      const chunkKey = `${cx}:${cy}`;

      let chunkData = chunkUpdates.get(chunkKey);
      if (!chunkData) {
        chunkData = { chunk: existingChunks.get(chunkKey), cx, cy, modified: false, _decoded: [] };
        chunkUpdates.set(chunkKey, chunkData);
      }

      const rx = x % chunkSize;
      const ry = y % chunkSize;
      const idx = ry * chunkSize + rx;

      decodeChunkIntoUpdate(chunkData, chunkSize, decodeRlePairsFromBuffer, rleDecodeToNumbers, rleDecodeToBooleans);

      let val = 0;
      if (erase) {
        val = 0;
      } else if (rawValues && rawValues.length > 0) {
        const vy = y - rect.y0;
        const vx = x - rect.x0;
        const vIdx = vy * rectWidth + vx;
        val = rawValues[vIdx] || 0;
      } else {
        val = tileRefId as number;
      }

      if (chunkData._decoded[idx] !== val) {
        chunkData._decoded[idx] = val;
        chunkData.modified = true;
      }
    }
  }
  return chunkUpdates;
}

async function persistChunkUpdates(
  prisma: PrismaClient,
  layerId: string,
  chunkUpdates: Map<string, ChunkUpdate>,
  existingChunks: Map<string, ChunkData>,
  encoding: 'rle' | 'rle-bool',
): Promise<ChunkUpdateResult[]> {
  const { rleEncodeNumbers, rleEncodeBooleans, encodeRlePairsToBuffer } = await import('../../mapEncoding.js');
  const updates: ChunkUpdateResult[] = [];

  for (const [key, data] of chunkUpdates.entries()) {
    if (!data.modified) continue;

    const chunkValues = data._decoded;
    const pairs =
      encoding === 'rle-bool'
        ? rleEncodeBooleans(chunkValues.map((v: number) => v !== 0))
        : rleEncodeNumbers(chunkValues);
    const buf = encodeRlePairsToBuffer(pairs);
    const u8 = new Uint8Array(buf);

    let chunk = existingChunks.get(key);
    if (!chunk) {
      chunk = await prisma.mapChunk.create({
        data: { layerId, x: data.cx, y: data.cy, version: 1, encoding, data: u8 },
      });
    } else {
      chunk = await prisma.mapChunk.update({
        where: { id: chunk.id },
        data: { version: chunk.version + 1, encoding, data: u8 },
      });
    }

    updates.push({ key, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
  }
  return updates;
}

export async function handlePaintRect(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const tenant = await resolveEditorMemberTenant(prisma, req, res, { requireAdmin: true });
    if (!tenant) return;

    const parse = paintSchema.safeParse(req.body || {});
    if (!parse.success) {
      logger.warn('[Paint] invalid payload', parse.error);
      res.status(400).json({ error: 'invalid payload' });
      return;
    }

    const { layer: layerName, rect, tileRefId, values: rawValues, erase } = parse.data;

    const map = await findMapById(prisma, pathParam(req, 'id'), tenant.id);
    if (!map) {
      logger.warn('[Paint] map not found', { mapId: req.params.id, tenant: tenant.slug });
      res.status(404).json({ error: 'map not found' });
      return;
    }

    logger.info('[Paint] Request', {
      mapId: map.id,
      mapName: map.name,
      layer: layerName,
      rect,
      erase,
      hasValues: !!rawValues,
      tileRefId,
    });

    if (!erase && tileRefId === undefined && (!rawValues || rawValues.length === 0)) {
      res.status(400).json({ error: 'invalid payload: missing tileRefId or values' });
      return;
    }

    let layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } });
    if (!layer) {
      layer = await prisma.mapLayer.create({
        data: { mapId: map.id, name: layerName, chunkSize: map.chunkSize ?? 32 },
      });
      logger.info('[Paint] created layer', { layerId: layer.id, name: layerName });
    }

    const chunkSize = layer.chunkSize || 32;
    const chunkCoordsToFetch = collectChunkCoords(rect, chunkSize);

    const existingChunksList = await prisma.mapChunk.findMany({
      where: { layerId: layer.id, OR: chunkCoordsToFetch },
    });
    const existingChunks = new Map<string, ChunkData>();
    for (const c of existingChunksList) {
      existingChunks.set(`${c.x}:${c.y}`, c);
    }

    const chunkUpdates = await buildChunkUpdates({
      rect,
      chunkSize,
      existingChunks,
      tileRefId,
      rawValues,
      erase,
    });

    const encoding = layerName === 'collision' ? 'rle-bool' : 'rle';
    const updates = await persistChunkUpdates(prisma, layer.id, chunkUpdates, existingChunks, encoding);

    if (updates.length > 0) {
      broadcastMapUpdate(tenant.slug, 'chunks_updated', {
        mapId: map.id,
        mapName: map.name,
        layer: layerName,
        updates,
      });
    }

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
        broadcastMapUpdate(tenant.slug, 'chunks_updated', {
          mapId: map.id,
          mapName: map.name,
          layer: 'collision',
          updates: collisionUpdates,
        });
      }
    }

    res.json({
      updates,
      collisionUpdates: collisionUpdates && collisionUpdates.length > 0 ? collisionUpdates : undefined,
    });
  } catch (e: unknown) {
    logger.error('[Map] paint-rect failed', e);
    res.status(500).json({ error: 'internal_error' });
  }
}
