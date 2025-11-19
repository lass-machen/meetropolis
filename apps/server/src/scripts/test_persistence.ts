
import { PrismaClient } from '@prisma/client';

// --- INLINE mapEncoding.ts ---
export type RlePair = [number, number];

export function rleEncodeNumbers(values: number[]): RlePair[] {
  const out: RlePair[] = [];
  if (values.length === 0) return out;
  let current = values[0];
  let count = 1;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    if (v === current) {
      count++;
    } else {
      out.push([current, count]);
      current = v;
      count = 1;
    }
  }
  out.push([current, count]);
  return out;
}

export function rleEncodeBooleans(values: boolean[]): RlePair[] {
  const nums = values.map((b) => (b ? 1 : 0));
  return rleEncodeNumbers(nums);
}

export function encodeRlePairsToBuffer(pairs: RlePair[]): Buffer {
  const json = JSON.stringify(pairs);
  return Buffer.from(json, 'utf8');
}

export function decodeRlePairsFromBuffer(buf: Buffer): RlePair[] {
  if (!buf || buf.length === 0) return [];
  try {
    const s = buf.toString('utf8');
    const arr = JSON.parse(s);
    if (Array.isArray(arr)) return arr as RlePair[];
  } catch {}
  return [];
}

export function rleDecodeToNumbers(pairs: RlePair[], total: number): number[] {
  const out: number[] = new Array(total);
  let i = 0;
  for (const [val, count] of pairs) {
    for (let c = 0; c < count && i < total; c++) {
      out[i++] = val;
    }
    if (i >= total) break;
  }
  while (i < total) out[i++] = 0;
  return out;
}
// --- END INLINE ---

const prisma = new PrismaClient();

async function main() {
  console.log('Start persistence test...');

  // 1. Setup Tenant & Map
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'default' } });
  if (!tenant) {
    console.log('Creating default tenant...');
    tenant = await prisma.tenant.create({ data: { slug: 'default', name: 'Default' } });
  }

  let map = await prisma.map.findFirst({ where: { name: 'office', tenantId: tenant.id } });
  if (!map) {
    console.log('Creating office map...');
    map = await prisma.map.create({ 
      data: { 
        name: 'office', 
        meta: {}, 
        tenantId: tenant.id,
        width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32
      } 
    });
  }

  // 2. Simulate Paint-Rect (Write) on Collision Layer
  const layerName = 'collision';
  let layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } });
  if (!layer) {
    console.log('Creating collision layer...');
    layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: layerName, chunkSize: 32 } });
  }

  const cx = 0;
  const cy = 0;
  const chunkSize = 32;
  const total = chunkSize * chunkSize;
  
  // Simulate painting a collision at (5,5)
  let chunk = await prisma.mapChunk.findUnique({ where: { layerId_x_y: { layerId: layer.id, x: cx, y: cy } } });
  
  let values = new Array(total).fill(0);
  if (chunk) {
    const pairs = decodeRlePairsFromBuffer(Buffer.from(chunk.data));
    values = rleDecodeToNumbers(pairs, total);
  }

  // Paint collision at 5,5
  const idx = 5 * chunkSize + 5;
  // Toggle value: if 0 -> 1, if 1 -> 0 (to ensure change)
  // Force set to 1 to be sure
  values[idx] = 1;

  const pairs = rleEncodeBooleans(values.map(v => v !== 0));
  const buf = encodeRlePairsToBuffer(pairs);
  const u8 = new Uint8Array(buf);

  console.log(`Writing chunk ${cx}:${cy} with value at ${idx} set to 1...`);
  if (!chunk) {
    chunk = await prisma.mapChunk.create({ data: { layerId: layer.id, x: cx, y: cy, version: 1, encoding: 'rle-bool', data: u8 } });
  } else {
    chunk = await prisma.mapChunk.update({ where: { id: chunk.id }, data: { version: chunk.version + 1, encoding: 'rle-bool', data: u8 } });
  }
  console.log('Write successful.');

  // 3. Simulate Chunks Fetch (Read)
  console.log('Reading chunk back...');
  const readChunk = await prisma.mapChunk.findUnique({ where: { layerId_x_y: { layerId: layer.id, x: cx, y: cy } } });
  
  if (!readChunk) {
    console.error('Chunk not found!');
    process.exit(1);
  }

  const readPairs = decodeRlePairsFromBuffer(Buffer.from(readChunk.data));
  const readValues = rleDecodeToNumbers(readPairs, total);

  if (readValues[idx] === 1) {
    console.log('SUCCESS: Persistence verified. Value at 5,5 is 1.');
  } else {
    console.error('FAILURE: Value at 5,5 is', readValues[idx]);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
