import { PrismaClient } from '../generated/prisma/index.js';
import fs from 'fs/promises';
import path from 'path';
import { encodeRlePairsToBuffer, rleEncodeBooleans, rleEncodeNumbers, tileRefIdFrom } from '../mapEncoding.js';

type Tmj = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: Array<{ firstgid: number; name: string; image: string; tilewidth: number; tileheight: number; margin?: number; spacing?: number; tilecount?: number }>;
  layers: Array<{ name: string; type: string; data?: number[]; width?: number; height?: number; }>
};

const prisma = new PrismaClient();

async function main() {
  const mapName = process.env.IMPORT_MAP_NAME || 'office';
  const tmjPath = process.env.IMPORT_TMJ_PATH || path.resolve(process.cwd(), 'apps/web/public/maps/office.json');
  const chunkSize = Number(process.env.IMPORT_CHUNK_SIZE || 32);
  const tenantSlug = process.env.IMPORT_TENANT_SLUG || 'default';

  const raw = await fs.readFile(tmjPath, 'utf8');
  const tmj: Tmj = JSON.parse(raw);

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new Error(`Tenant '${tenantSlug}' not found. Set IMPORT_TENANT_SLUG or create tenant first.`);
  }

  const map = await prisma.map.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: mapName } as any },
    create: { name: mapName, meta: {}, width: tmj.width, height: tmj.height, tileWidth: tmj.tilewidth, tileHeight: tmj.tileheight, chunkSize, tenant: { connect: { id: tenant.id } } as any },
    update: { width: tmj.width, height: tmj.height, tileWidth: tmj.tilewidth, tileHeight: tmj.tileheight, chunkSize },
  });

  // Tileset registry by TMJ order -> slot = index
  // Map image to server path under /packs or public path passed in tmj (assumed already server-hostable)
  // For now, use tmj image path as-is under web public.
  await prisma.mapTileset.deleteMany({ where: { mapId: map.id } });
  for (let i = 0; i < tmj.tilesets.length; i++) {
    const t = tmj.tilesets[i];
    await prisma.mapTileset.create({
      data: {
        mapId: map.id,
        slot: i,
        key: t.name,
        imageUrl: t.image, // should be server URL; for dev we keep relative path
        tileWidth: t.tilewidth,
        tileHeight: t.tileheight,
        margin: t.margin ?? 0,
        spacing: t.spacing ?? 0,
        tileCount: t.tilecount ?? null,
      }
    });
  }

  // Build firstgid -> slot mapping
  const sortedByFirstGid = [...tmj.tilesets].sort((a, b) => a.firstgid - b.firstgid);
  const firstGids = sortedByFirstGid.map(ts => ts.firstgid);
  const toSlot: Array<{ firstgid: number; slot: number }> = sortedByFirstGid.map(ts => ({ firstgid: ts.firstgid, slot: tmj.tilesets.findIndex(t => t.firstgid === ts.firstgid) }));

  function gidToTileRefId(gid: number): number {
    if (!gid || gid <= 0) return 0;
    // find tileset by firstgid
    let chosen = -1;
    for (let i = 0; i < firstGids.length; i++) {
      const fg = firstGids[i];
      const next = firstGids[i + 1] ?? Number.MAX_SAFE_INTEGER;
      if (gid >= fg && gid < next) { chosen = i; break; }
    }
    if (chosen < 0) return 0;
    const base = firstGids[chosen];
    const slot = toSlot[chosen].slot;
    const tileIndex = gid - base;
    return tileRefIdFrom(slot, tileIndex);
  }

  const layersWanted = new Map<string, 'rle' | 'rle-bool'>([
    ['ground', 'rle'],
    ['walls', 'rle'],
    ['collision', 'rle-bool'],
  ]);

  // Remove existing v2 layers for idempotency
  const existingLayers = await prisma.mapLayer.findMany({ where: { mapId: map.id } });
  for (const l of existingLayers) {
    await prisma.mapChunk.deleteMany({ where: { layerId: l.id } });
  }
  await prisma.mapLayer.deleteMany({ where: { mapId: map.id } });

  for (const [layerName, enc] of layersWanted) {
    // Find TMJ layer by name (case-insensitive contains)
    const tmjLayer = tmj.layers.find(l => (l.name || '').toLowerCase().includes(layerName));
    const layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: layerName, chunkSize } });
    if (!tmjLayer || !Array.isArray(tmjLayer.data)) continue;

    const width = tmjLayer.width || tmj.width;
    const height = tmjLayer.height || tmj.height;
    const total = width * height;
    const tileRefs: number[] = new Array(total).fill(0);
    for (let i = 0; i < total; i++) {
      const gid = tmjLayer.data[i] || 0;
      if (enc === 'rle') tileRefs[i] = gidToTileRefId(gid);
      else tileRefs[i] = gid > 0 ? 1 : 0;
    }

    // Chunking row-major
    const chunksX = Math.ceil(width / chunkSize);
    const chunksY = Math.ceil(height / chunkSize);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const values: number[] = [];
        for (let y = 0; y < chunkSize; y++) {
          const gy = cy * chunkSize + y;
          if (gy >= height) { for (let x = 0; x < chunkSize; x++) values.push(0); continue; }
          for (let x = 0; x < chunkSize; x++) {
            const gx = cx * chunkSize + x;
            if (gx >= width) { values.push(0); continue; }
            const idx = gy * width + gx;
            values.push(tileRefs[idx] || 0);
          }
        }

        const pairs = enc === 'rle' ? rleEncodeNumbers(values) : rleEncodeBooleans(values.map(v => v === 1));
        const buf = encodeRlePairsToBuffer(pairs);
        const u8 = new Uint8Array(buf);
        await prisma.mapChunk.create({ data: { layerId: layer.id, x: cx, y: cy, version: 1, encoding: enc, data: u8 } });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('Import v2 complete for map:', mapName);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});




