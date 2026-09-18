/**
 * Separate legacy collision data into a manual source layer and rebuild the
 * delivered collision layer from all reconstructable sources.
 *
 * Dry-run is the default:
 *   npm -w @meetropolis/server run map:collision-sources:migrate
 *   npm -w @meetropolis/server run map:collision-sources:migrate -- --apply
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../db.js';
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import { computeFootprintTiles } from '../api/utils/collisionHelpers.js';
import {
  DERIVED_COLLISION_LAYER,
  MANUAL_COLLISION_LAYER,
  reconcileCollisionTiles,
  rectCollisionTiles,
} from '../api/utils/collisionReconciler.js';
import { decodeChunk, persistChunk, runSerializable, type StoredChunk } from '../api/utils/mapChunkMutations.js';

interface Summary {
  maps: number;
  pending: number;
  migrated: number;
  unchanged: number;
  conflicts: number;
}

export interface CollisionMigrationMap {
  id: string;
  width: number | null;
  height: number | null;
  tileWidth: number | null;
  tileHeight: number | null;
  chunkSize: number | null;
  autotiles: Array<{ slot: number; collide: boolean }>;
  objects: Array<{
    tileX: number;
    tileY: number;
    width: number;
    height: number;
    collide: boolean;
    scaleFactor: number;
    collisionBaseHeight: number;
  }>;
  layers: Array<{
    id: string;
    name: string;
    chunkSize: number;
    chunks: Array<StoredChunk>;
  }>;
}

function parseApply(args: string[]): boolean {
  let apply = false;
  for (const arg of args) {
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') apply = false;
    else if (arg === '--help' || arg === '-h') throw new Error('usage');
    else throw new Error(`Unknown option '${arg}'.`);
  }
  return apply;
}

function layerValues(map: CollisionMigrationMap, name: string, accept: (value: number) => boolean): Set<string> {
  const layer = map.layers.find((candidate) => candidate.name === name);
  const values = new Set<string>();
  if (!layer) return values;
  const encoding = name === DERIVED_COLLISION_LAYER ? 'rle-bool' : 'rle';
  for (const chunk of layer.chunks) {
    if (chunk.encoding !== encoding) throw new Error(`${name} uses unsupported encoding '${chunk.encoding}'`);
    const decoded = decodeChunk(chunk, layer.chunkSize, encoding);
    for (let index = 0; index < decoded.length; index++) {
      if (!accept(decoded[index])) continue;
      const x = chunk.x * layer.chunkSize + (index % layer.chunkSize);
      const y = chunk.y * layer.chunkSize + Math.floor(index / layer.chunkSize);
      values.add(`${x}:${y}`);
    }
  }
  return values;
}

function objectValues(map: CollisionMigrationMap, chunkSize: number): Set<string> {
  const values = new Set<string>();
  for (const object of map.objects) {
    if (!object.collide) continue;
    const footprint = computeFootprintTiles(
      object.tileX,
      object.tileY,
      object.width * object.scaleFactor,
      object.height * object.scaleFactor,
      map.tileWidth ?? 16,
      map.tileHeight ?? 16,
      chunkSize,
      object.collisionBaseHeight,
    );
    for (const tile of footprint) {
      values.add(`${tile.cx * chunkSize + tile.rx}:${tile.cy * chunkSize + tile.ry}`);
    }
  }
  return values;
}

export function manualCollisionValues(map: CollisionMigrationMap): Set<string> {
  const collision = layerValues(map, DERIVED_COLLISION_LAYER, (value) => value !== 0);
  const walls = layerValues(map, 'walls', (value) => value !== 0);
  const collidingSlots = new Set(map.autotiles.filter((entry) => entry.collide).map((entry) => entry.slot));
  const autotiles = layerValues(map, 'walls_auto', (value) => collidingSlots.has(value));
  const objects = objectValues(map, map.chunkSize ?? 32);
  return new Set(
    [...collision].filter((position) => !walls.has(position) && !autotiles.has(position) && !objects.has(position)),
  );
}

export function planCollisionMigration(
  map: CollisionMigrationMap,
): { status: 'unchanged' } | { status: 'pending'; manual: Set<string> } {
  if (map.layers.some((layer) => layer.name === MANUAL_COLLISION_LAYER)) return { status: 'unchanged' };
  return { status: 'pending', manual: manualCollisionValues(map) };
}

async function persistManualLayer(
  tx: Prisma.TransactionClient,
  map: CollisionMigrationMap,
  manual: Set<string>,
): Promise<void> {
  const chunkSize = map.chunkSize ?? 32;
  const layer = await tx.mapLayer.create({ data: { mapId: map.id, name: MANUAL_COLLISION_LAYER, chunkSize } });
  const byChunk = new Map<string, number[]>();
  for (const position of manual) {
    const [x, y] = position.split(':').map(Number);
    const cx = Math.floor(x / chunkSize);
    const cy = Math.floor(y / chunkSize);
    const key = `${cx}:${cy}`;
    const values = byChunk.get(key) ?? new Array<number>(chunkSize * chunkSize).fill(0);
    const rx = ((x % chunkSize) + chunkSize) % chunkSize;
    const ry = ((y % chunkSize) + chunkSize) % chunkSize;
    values[ry * chunkSize + rx] = 1;
    byChunk.set(key, values);
  }
  for (const [key, values] of byChunk) {
    const [x, y] = key.split(':').map(Number);
    await persistChunk(tx, layer.id, { x, y }, undefined, 'rle-bool', values);
  }
}

export async function migrateCollisionSources(
  prisma: PrismaClient,
  apply: boolean,
  log: (message: string) => void = console.log,
): Promise<Summary> {
  const maps = await prisma.map.findMany({
    where: { layers: { some: { name: DERIVED_COLLISION_LAYER, chunks: { some: {} } } } },
    orderBy: { id: 'asc' },
    include: {
      autotiles: { select: { slot: true, collide: true } },
      objects: true,
      layers: { include: { chunks: true } },
    },
  });
  const summary: Summary = { maps: maps.length, pending: 0, migrated: 0, unchanged: 0, conflicts: 0 };
  for (const map of maps) {
    const plan = planCollisionMigration(map);
    if (plan.status === 'unchanged') {
      summary.unchanged++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${map.id}: manual source already exists`);
      continue;
    }
    try {
      const manual = plan.manual;
      summary.pending++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${map.id}: preserve ${manual.size} manual collision tiles`);
      if (!apply) continue;
      await runSerializable(prisma, async (tx) => {
        await persistManualLayer(tx, map, manual);
        await reconcileCollisionTiles(
          tx,
          map.id,
          { chunkSize: map.chunkSize ?? 32, tileWidth: map.tileWidth ?? 16, tileHeight: map.tileHeight ?? 16 },
          rectCollisionTiles(
            { x0: 0, y0: 0, x1: (map.width ?? 1) - 1, y1: (map.height ?? 1) - 1 },
            map.chunkSize ?? 32,
          ),
        );
      });
      summary.migrated++;
    } catch (error: unknown) {
      summary.conflicts++;
      log(
        `[${apply ? 'APPLY' : 'DRY-RUN'}] ${map.id}: CONFLICT ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  log(`[SUMMARY] mode=${apply ? 'apply' : 'dry-run'} ${JSON.stringify(summary)}`);
  return summary;
}

async function main(): Promise<void> {
  let apply: boolean;
  try {
    apply = parseApply(process.argv.slice(2));
  } catch (error) {
    const usage = 'Usage: npm -w @meetropolis/server run map:collision-sources:migrate -- [--apply|--dry-run]';
    console.error(error instanceof Error && error.message !== 'usage' ? error.message : usage);
    if (error instanceof Error && error.message !== 'usage') console.error(usage);
    process.exitCode = error instanceof Error && error.message === 'usage' ? 0 : 2;
    return;
  }
  const prisma = createPrismaClient();
  try {
    await migrateCollisionSources(prisma, apply);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
