/**
 * Migration M2 (Strang B): re-raster every tenant map's collision layer from
 * walls + object FEET, and backfill each object's collisionBaseHeight /
 * renderLayer / collide from the pixel-agents furniture asset-pack defaults.
 *
 * Existing tenant maps are verbatim copies of the pre-B generated template:
 * their baked collision layer is `walls ∪ object-FULL-footprints`. This script
 * turns that into `walls ∪ object-FEET` so plants block only their pot.
 *
 * SAFETY (B-DP2): a full rebuild is lossy for hand-painted collision tiles
 * (indistinguishable from object-derived ones). So the script first verifies,
 * per map, that the current collision layer is EXACTLY reproducible from
 * `walls ∪ object-full-footprints`. If a map has extra ("hand-painted") tiles,
 * that map is REPORTED and SKIPPED — never overwritten.
 *
 * Dry-run by default (safety report only). Pass `--apply` to write. Optionally
 * `--map <mapId>` to limit to one map.
 *
 *   npx tsx src/scripts/rerasterCollision.ts            # dry-run, all maps
 *   npx tsx src/scripts/rerasterCollision.ts --apply    # migrate all safe maps
 */
import { createPrismaClient } from '../db.js';
import { PrismaClient } from '../generated/prisma/index.js';
import { decodeRlePairsFromBuffer, rleDecodeToNumbers, rleDecodeToBooleans } from '../mapEncoding.js';
import { computeFootprintTiles, updateCollisionChunks, type CollisionTile } from '../api/utils/collisionHelpers.js';

type ItemDefault = { collisionBaseHeight: number; renderLayer: string; collide: boolean };

function tileKey(x: number, y: number): string {
  return `${x}:${y}`;
}
function toCollisionTile(x: number, y: number, chunkSize: number): CollisionTile {
  return {
    cx: Math.floor(x / chunkSize),
    cy: Math.floor(y / chunkSize),
    rx: ((x % chunkSize) + chunkSize) % chunkSize,
    ry: ((y % chunkSize) + chunkSize) % chunkSize,
  };
}

/** Decode a tile layer (Walls = rle numbers, Collision = rle-bool) into the set
 * of global tile coords that are non-empty / solid. */
async function loadLayerTiles(
  prisma: PrismaClient,
  mapId: string,
  layerName: string,
  chunkSize: number,
  boolLayer: boolean,
): Promise<Set<string>> {
  const set = new Set<string>();
  const layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId, name: layerName } } });
  if (!layer) return set;
  const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id } });
  const total = chunkSize * chunkSize;
  for (const c of chunks) {
    const raw: unknown = c.data;
    const bytes = raw instanceof Buffer ? new Uint8Array(raw) : (raw as Uint8Array);
    const pairs = decodeRlePairsFromBuffer(Buffer.from(bytes));
    const values = boolLayer
      ? rleDecodeToBooleans(pairs, total).map((b) => (b ? 1 : 0))
      : rleDecodeToNumbers(pairs, total);
    for (let i = 0; i < total; i++) {
      if (values[i]) set.add(tileKey(c.x * chunkSize + (i % chunkSize), c.y * chunkSize + Math.floor(i / chunkSize)));
    }
  }
  return set;
}

async function loadItemDefaults(prisma: PrismaClient): Promise<Map<string, ItemDefault>> {
  const pack = await prisma.assetPack.findUnique({ where: { uuid: 'pixel-agents-furniture' } });
  const map = new Map<string, ItemDefault>();
  const objects = (pack?.objects ?? []) as Array<Record<string, unknown>>;
  for (const o of objects) {
    if (typeof o.id !== 'string') continue;
    map.set(o.id, {
      collisionBaseHeight: typeof o.collisionBaseHeight === 'number' ? o.collisionBaseHeight : 0,
      renderLayer: typeof o.renderLayer === 'string' ? o.renderLayer : 'sorted',
      collide: typeof o.collide === 'boolean' ? o.collide : false,
    });
  }
  return map;
}

type MapObjectRow = {
  id: number;
  itemId: string;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  scaleFactor: number;
  collide: boolean;
  collisionBaseHeight: number;
  renderLayer: string;
};

function footprintTilesFor(o: MapObjectRow, base: number, dims: Dims): CollisionTile[] {
  const sf = o.scaleFactor ?? 1;
  return computeFootprintTiles(
    o.tileX,
    o.tileY,
    o.width * sf,
    o.height * sf,
    dims.tileWidth,
    dims.tileHeight,
    dims.chunkSize,
    base,
  );
}

type Dims = { chunkSize: number; tileWidth: number; tileHeight: number };

async function processMap(
  prisma: PrismaClient,
  map: {
    id: string;
    name: string;
    tenantSlug: string;
    chunkSize: number | null;
    tileWidth: number | null;
    tileHeight: number | null;
  },
  defaults: Map<string, ItemDefault>,
  apply: boolean,
): Promise<void> {
  const dims: Dims = {
    chunkSize: map.chunkSize ?? 32,
    tileWidth: map.tileWidth ?? 16,
    tileHeight: map.tileHeight ?? 16,
  };
  const walls = await loadLayerTiles(prisma, map.id, 'walls', dims.chunkSize, false);
  const collision = await loadLayerTiles(prisma, map.id, 'collision', dims.chunkSize, true);
  const objects = (await prisma.mapObject.findMany({ where: { mapId: map.id } })) as unknown as MapObjectRow[];

  // Expected OLD collision = walls ∪ every currently-colliding object's FULL footprint.
  const expectedOld = new Set(walls);
  for (const o of objects) {
    if (!o.collide) continue;
    for (const t of footprintTilesFor(o, 0, dims))
      expectedOld.add(tileKey(t.cx * dims.chunkSize + t.rx, t.cy * dims.chunkSize + t.ry));
  }
  const extra = [...collision].filter((k) => !expectedOld.has(k)); // hand-painted candidates
  const missing = [...expectedOld].filter((k) => !collision.has(k));

  const tag = `[${map.tenantSlug}/${map.name}]`;
  if (extra.length > 0) {
    console.warn(
      `${tag} SKIP: ${extra.length} collision tiles not reproducible from walls+object-footprints (hand-painted?). First: ${extra.slice(0, 8).join(', ')}`,
    );
    return;
  }
  console.log(
    `${tag} safe: collision fully reproducible (walls=${walls.size}, collide-objs, missing=${missing.length}).`,
  );

  if (!apply) return;

  // Target NEW collision = walls ∪ FEET of objects that collide per the defaults.
  const target = new Set(walls);
  for (const o of objects) {
    const def = defaults.get(o.itemId);
    const collide = def ? def.collide : o.collide;
    const base = def ? def.collisionBaseHeight : o.collisionBaseHeight;
    if (!collide) continue;
    for (const t of footprintTilesFor(o, base, dims))
      target.add(tileKey(t.cx * dims.chunkSize + t.rx, t.cy * dims.chunkSize + t.ry));
  }

  // Backfill object fields from the manifest defaults.
  let updated = 0;
  for (const o of objects) {
    const def = defaults.get(o.itemId);
    if (!def) continue;
    if (
      o.collide === def.collide &&
      o.collisionBaseHeight === def.collisionBaseHeight &&
      o.renderLayer === def.renderLayer
    )
      continue;
    await prisma.mapObject.update({
      where: { id: o.id },
      data: { collide: def.collide, collisionBaseHeight: def.collisionBaseHeight, renderLayer: def.renderLayer },
    });
    updated++;
  }

  // Diff the collision layer and apply.
  const toSet = [...target].filter((k) => !collision.has(k)).map((k) => k.split(':').map(Number));
  const toClear = [...collision].filter((k) => !target.has(k)).map((k) => k.split(':').map(Number));
  const setTiles = toSet.map(([x, y]) => toCollisionTile(x, y, dims.chunkSize));
  const clearTiles = toClear.map(([x, y]) => toCollisionTile(x, y, dims.chunkSize));
  if (clearTiles.length > 0) await updateCollisionChunks(prisma, map.id, dims.chunkSize, clearTiles, false);
  if (setTiles.length > 0) await updateCollisionChunks(prisma, map.id, dims.chunkSize, setTiles, true);
  console.log(
    `${tag} APPLIED: objects updated=${updated}, collision +${setTiles.length}/-${clearTiles.length} tiles (now ${target.size}).`,
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const mapArgIdx = process.argv.indexOf('--map');
  const onlyMap = mapArgIdx >= 0 ? process.argv[mapArgIdx + 1] : undefined;
  const prisma = createPrismaClient();
  try {
    const defaults = await loadItemDefaults(prisma);
    console.log(
      `Loaded ${defaults.size} item defaults from pixel-agents-furniture. Mode: ${apply ? 'APPLY' : 'DRY-RUN'}.`,
    );
    const maps = await prisma.map.findMany({
      where: onlyMap ? { id: onlyMap } : {},
      select: {
        id: true,
        name: true,
        chunkSize: true,
        tileWidth: true,
        tileHeight: true,
        tenant: { select: { slug: true } },
      },
    });
    for (const m of maps) {
      await processMap(prisma, { ...m, tenantSlug: m.tenant.slug }, defaults, apply);
    }
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

void main();
