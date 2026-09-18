import { Prisma, type PrismaClient } from '../../generated/prisma/index.js';
import {
  decodeRlePairsFromBuffer,
  encodeRlePairsToBuffer,
  rleDecodeToBooleans,
  rleDecodeToNumbers,
  rleEncodeBooleans,
  rleEncodeNumbers,
} from '../../mapEncoding.js';

export type MapDb = Prisma.TransactionClient;
export type ChunkEncoding = 'rle' | 'rle-bool';
export type ChunkCoord = { x: number; y: number };
export type TileRect = { x0: number; y0: number; x1: number; y1: number };

export interface StoredChunk {
  id: string;
  x: number;
  y: number;
  version: number;
  encoding: string;
  data: Buffer | Uint8Array;
}

export interface ChunkUpdateResult {
  key: string;
  version: number;
  encoding: string;
  data: string;
}

export class MapChunkWriteConflict extends Error {
  constructor() {
    super('map_chunk_write_conflict');
  }
}

export function chunkKey(x: number, y: number): string {
  return `${x}:${y}`;
}

export function collectChunkCoords(rect: TileRect, chunkSize: number): ChunkCoord[] {
  const coords = new Map<string, ChunkCoord>();
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const coord = { x: Math.floor(x / chunkSize), y: Math.floor(y / chunkSize) };
      coords.set(chunkKey(coord.x, coord.y), coord);
    }
  }
  return [...coords.values()];
}

export async function getOrCreateMapLayer(db: MapDb, mapId: string, name: string, chunkSize: number) {
  const existing = await db.mapLayer.findUnique({ where: { mapId_name: { mapId, name } } });
  if (existing) return existing;
  return db.mapLayer.create({ data: { mapId, name, chunkSize } });
}

export async function loadChunks(db: MapDb, layerId: string, coords: ChunkCoord[]): Promise<Map<string, StoredChunk>> {
  if (coords.length === 0) return new Map();
  const chunks = await db.mapChunk.findMany({ where: { layerId, OR: coords } });
  return new Map(chunks.map((chunk) => [chunkKey(chunk.x, chunk.y), chunk]));
}

export function decodeChunk(chunk: StoredChunk | undefined, chunkSize: number, encoding: ChunkEncoding): number[] {
  if (!chunk) return new Array<number>(chunkSize * chunkSize).fill(0);
  const pairs = decodeRlePairsFromBuffer(Buffer.from(chunk.data));
  if (encoding === 'rle-bool') {
    return rleDecodeToBooleans(pairs, chunkSize * chunkSize).map((value) => (value ? 1 : 0));
  }
  return rleDecodeToNumbers(pairs, chunkSize * chunkSize);
}

function encodeChunk(values: number[], encoding: ChunkEncoding): Buffer {
  const pairs =
    encoding === 'rle-bool' ? rleEncodeBooleans(values.map((value) => value !== 0)) : rleEncodeNumbers(values);
  return encodeRlePairsToBuffer(pairs);
}

export async function persistChunk(
  db: MapDb,
  layerId: string,
  coord: ChunkCoord,
  existing: StoredChunk | undefined,
  encoding: ChunkEncoding,
  values: number[],
): Promise<ChunkUpdateResult> {
  const buffer = encodeChunk(values, encoding);
  if (!existing) {
    await db.mapChunk.create({
      data: { layerId, ...coord, version: 1, encoding, data: new Uint8Array(buffer) },
    });
    return { key: chunkKey(coord.x, coord.y), version: 1, encoding, data: buffer.toString('base64') };
  }

  const result = await db.mapChunk.updateMany({
    where: { id: existing.id, version: existing.version },
    data: { version: { increment: 1 }, encoding, data: new Uint8Array(buffer) },
  });
  if (result.count !== 1) throw new MapChunkWriteConflict();
  return {
    key: chunkKey(coord.x, coord.y),
    version: existing.version + 1,
    encoding,
    data: buffer.toString('base64'),
  };
}

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof MapChunkWriteConflict) return true;
  return !!error && typeof error === 'object' && 'code' in error && (error.code === 'P2002' || error.code === 'P2034');
}

export async function runSerializable<T>(prisma: PrismaClient, work: (tx: MapDb) => Promise<T>): Promise<T> {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error: unknown) {
      if (!isRetryableTransactionError(error) || attempt === attempts - 1) throw error;
    }
  }
  throw new Error('serializable_transaction_exhausted');
}
