import { PrismaClient } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  rleDecodeToBooleans,
  rleEncodeBooleans,
  encodeRlePairsToBuffer,
} from '../../mapEncoding.js';

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

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface CollisionSideEffectParams {
  prisma: PrismaClient;
  mapId: string;
  defaultChunkSize: number;
  rect: Rect;
  wallChunkSize: number;
  wallChunkUpdates: Map<string, { _decoded: number[] }>;
}

async function getOrCreateCollisionLayer(prisma: PrismaClient, mapId: string, defaultChunkSize: number) {
  let layer = await prisma.mapLayer.findUnique({
    where: { mapId_name: { mapId, name: 'collision' } },
  });
  if (!layer) {
    layer = await prisma.mapLayer.create({
      data: { mapId, name: 'collision', chunkSize: defaultChunkSize },
    });
  }
  return layer;
}

function collectChunkCoords(rect: Rect, chunkSize: number): Array<{ x: number; y: number }> {
  const set = new Set<string>();
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      set.add(`${Math.floor(x / chunkSize)}:${Math.floor(y / chunkSize)}`);
    }
  }
  return [...set].map((k) => {
    const [cx, cy] = k.split(':');
    return { x: Number(cx), y: Number(cy) };
  });
}

function ensureDecoded(cd: ChunkUpdate, colChunkSize: number) {
  if (cd._decoded.length !== 0) return;
  const c = cd.chunk;
  if (c) {
    const dataBuffer = c.data instanceof Buffer ? c.data : Buffer.from(c.data);
    const pairs = decodeRlePairsFromBuffer(dataBuffer);
    cd._decoded = rleDecodeToBooleans(pairs, colChunkSize * colChunkSize).map((b) => (b ? 1 : 0));
  } else {
    cd._decoded = new Array(colChunkSize * colChunkSize).fill(0);
  }
}

function computeCollisionUpdates(params: {
  rect: Rect;
  colChunkSize: number;
  wallChunkSize: number;
  wallChunkUpdates: Map<string, { _decoded: number[] }>;
  existingColChunks: Map<string, ChunkData>;
}): Map<string, ChunkUpdate> {
  const { rect, colChunkSize, wallChunkSize, wallChunkUpdates, existingColChunks } = params;
  const colUpdates = new Map<string, ChunkUpdate>();

  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const cx = Math.floor(x / colChunkSize);
      const cy = Math.floor(y / colChunkSize);
      const chunkKey = `${cx}:${cy}`;

      let cd = colUpdates.get(chunkKey);
      if (!cd) {
        const existing = existingColChunks.get(chunkKey);
        cd = { chunk: existing, cx, cy, modified: false, _decoded: [] };
        colUpdates.set(chunkKey, cd);
      }

      ensureDecoded(cd, colChunkSize);

      const rx = x % colChunkSize;
      const ry = y % colChunkSize;
      const idx = ry * colChunkSize + rx;

      const wallCx = Math.floor(x / wallChunkSize);
      const wallCy = Math.floor(y / wallChunkSize);
      const wallChunkData = wallChunkUpdates.get(`${wallCx}:${wallCy}`);
      const wallRx = x % wallChunkSize;
      const wallRy = y % wallChunkSize;
      const wallIdx = wallRy * wallChunkSize + wallRx;
      const wallVal = wallChunkData?._decoded[wallIdx] ?? 0;
      const colVal = wallVal > 0 ? 1 : 0;

      if (cd._decoded[idx] !== colVal) {
        cd._decoded[idx] = colVal;
        cd.modified = true;
      }
    }
  }
  return colUpdates;
}

async function persistCollisionUpdates(
  prisma: PrismaClient,
  layerId: string,
  colUpdates: Map<string, ChunkUpdate>,
  existingColChunks: Map<string, ChunkData>,
): Promise<ChunkUpdateResult[]> {
  const results: ChunkUpdateResult[] = [];
  for (const [key, data] of colUpdates.entries()) {
    if (!data.modified) continue;
    const pairs = rleEncodeBooleans(data._decoded.map((v: number) => v !== 0));
    const buf = encodeRlePairsToBuffer(pairs);
    const u8 = new Uint8Array(buf);
    let chunk = existingColChunks.get(key);
    if (!chunk) {
      chunk = await prisma.mapChunk.create({
        data: { layerId, x: data.cx, y: data.cy, version: 1, encoding: 'rle-bool', data: u8 },
      });
    } else {
      chunk = await prisma.mapChunk.update({
        where: { id: chunk.id },
        data: { version: chunk.version + 1, encoding: 'rle-bool', data: u8 },
      });
    }
    results.push({ key, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
  }
  return results;
}

/**
 * After painting walls_auto, sync collision layer:
 * collision=1 where wall>0, collision=0 where wall=0.
 */
export async function applyCollisionSideEffect(params: CollisionSideEffectParams): Promise<ChunkUpdateResult[]> {
  const { prisma, mapId, defaultChunkSize, rect, wallChunkSize, wallChunkUpdates } = params;

  const collisionLayer = await getOrCreateCollisionLayer(prisma, mapId, defaultChunkSize);
  const colChunkSize = collisionLayer.chunkSize || 32;

  const colCoords = collectChunkCoords(rect, colChunkSize);
  const existingColChunksList = await prisma.mapChunk.findMany({
    where: { layerId: collisionLayer.id, OR: colCoords },
  });
  const existingColChunks = new Map<string, ChunkData>();
  for (const c of existingColChunksList) {
    existingColChunks.set(`${c.x}:${c.y}`, c);
  }

  const colUpdates = computeCollisionUpdates({
    rect,
    colChunkSize,
    wallChunkSize,
    wallChunkUpdates,
    existingColChunks,
  });

  return persistCollisionUpdates(prisma, collisionLayer.id, colUpdates, existingColChunks);
}
