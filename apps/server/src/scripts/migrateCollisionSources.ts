/**
 * Preserve legacy collision data as a manual source and rebuild the delivered
 * collision layer from every source.
 *
 * Every blocked legacy cell is copied to `collision_manual`, including cells
 * that currently overlap a wall, autotile, or object. Their original hand-made
 * provenance cannot be reconstructed. Keeping the overlap can leave a visible
 * stale blocker after another source is removed, but an operator can repair
 * that in the editor. Subtracting reconstructable sources would silently lose
 * blockers later, which is the unsafe and irreversible direction.
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
} from '../api/utils/collisionReconciler.js';
import {
  chunkKey,
  decodeChunk,
  loadChunks,
  persistChunk,
  runSerializable,
  type StoredChunk,
} from '../api/utils/mapChunkMutations.js';
import { acquireMapAdvisoryLock } from '../api/utils/advisoryLocks.js';

export interface Summary {
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
  collisionSourcesMigratedAt: Date | null;
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
  return layerValues(map, DERIVED_COLLISION_LAYER, (value) => value !== 0);
}

function affectedCollisionValues(map: CollisionMigrationMap): Set<string> {
  const affected = manualCollisionValues(map);
  const walls = layerValues(map, 'walls', (value) => value !== 0);
  const collidingSlots = new Set(map.autotiles.filter((entry) => entry.collide).map((entry) => entry.slot));
  const autotiles = layerValues(map, 'walls_auto', (value) => collidingSlots.has(value));
  const objects = objectValues(map, map.chunkSize ?? 32);
  for (const source of [walls, autotiles, objects]) {
    for (const position of source) affected.add(position);
  }
  return affected;
}

export function planCollisionMigration(
  map: CollisionMigrationMap,
): { status: 'unchanged' } | { status: 'pending'; manual: Set<string>; affected: Set<string> } {
  if (map.collisionSourcesMigratedAt) return { status: 'unchanged' };
  return { status: 'pending', manual: manualCollisionValues(map), affected: affectedCollisionValues(map) };
}

async function persistManualLayer(
  tx: Prisma.TransactionClient,
  map: CollisionMigrationMap,
  manual: Set<string>,
): Promise<void> {
  const chunkSize = map.chunkSize ?? 32;
  const existingLayer = map.layers.find((candidate) => candidate.name === MANUAL_COLLISION_LAYER);
  const layer =
    existingLayer ?? (await tx.mapLayer.create({ data: { mapId: map.id, name: MANUAL_COLLISION_LAYER, chunkSize } }));
  const storageChunkSize = layer.chunkSize;
  const byChunk = new Map<string, number[]>();
  for (const position of manual) {
    const [x, y] = position.split(':').map(Number);
    const cx = Math.floor(x / storageChunkSize);
    const cy = Math.floor(y / storageChunkSize);
    const key = `${cx}:${cy}`;
    const positions = byChunk.get(key) ?? [];
    positions.push(x, y);
    byChunk.set(key, positions);
  }
  const coords = [...byChunk].map(([key]) => {
    const [x, y] = key.split(':').map(Number);
    return { x, y };
  });
  const chunks = await loadChunks(tx, layer.id, coords);
  for (const [key, positions] of byChunk) {
    const coord = coords.find((candidate) => chunkKey(candidate.x, candidate.y) === key)!;
    const existing = chunks.get(key);
    const values = decodeChunk(existing, layer.chunkSize, 'rle-bool');
    let modified = false;
    for (let index = 0; index < positions.length; index += 2) {
      const x = positions[index];
      const y = positions[index + 1];
      const rx = ((x % layer.chunkSize) + layer.chunkSize) % layer.chunkSize;
      const ry = ((y % layer.chunkSize) + layer.chunkSize) % layer.chunkSize;
      const valueIndex = ry * layer.chunkSize + rx;
      if (values[valueIndex] === 1) continue;
      values[valueIndex] = 1;
      modified = true;
    }
    if (modified || !existing) await persistChunk(tx, layer.id, coord, existing, 'rle-bool', values);
  }
}

function collisionTiles(values: Set<string>, chunkSize: number) {
  return [...values].map((position) => {
    const [x, y] = position.split(':').map(Number);
    return {
      cx: Math.floor(x / chunkSize),
      cy: Math.floor(y / chunkSize),
      rx: ((x % chunkSize) + chunkSize) % chunkSize,
      ry: ((y % chunkSize) + chunkSize) % chunkSize,
    };
  });
}

export class CollisionMigrationConflictsError extends Error {
  constructor(readonly summary: Summary) {
    super(`collision source migration finished with ${summary.conflicts} conflict(s)`);
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
    select: { id: true },
  });
  const summary: Summary = { maps: maps.length, pending: 0, migrated: 0, unchanged: 0, conflicts: 0 };
  for (const candidate of maps) {
    try {
      const result = await runSerializable(prisma, async (tx) => {
        await acquireMapAdvisoryLock(tx, candidate.id);
        const map = await tx.map.findUnique({
          where: { id: candidate.id },
          include: {
            autotiles: { select: { slot: true, collide: true } },
            objects: true,
            layers: { include: { chunks: true } },
          },
        });
        if (!map) return { status: 'unchanged' as const };
        const plan = planCollisionMigration(map);
        if (plan.status === 'unchanged' || !apply) return plan;
        await persistManualLayer(tx, map, plan.manual);
        const chunkSize = map.chunkSize ?? 32;
        await reconcileCollisionTiles(
          tx,
          map.id,
          { chunkSize, tileWidth: map.tileWidth ?? 16, tileHeight: map.tileHeight ?? 16 },
          collisionTiles(plan.affected, chunkSize),
        );
        await tx.map.update({ where: { id: map.id }, data: { collisionSourcesMigratedAt: new Date() } });
        return plan;
      });
      if (result.status === 'unchanged') {
        summary.unchanged++;
        log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${candidate.id}: explicit migration marker already exists`);
        continue;
      }
      summary.pending++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${candidate.id}: preserve ${result.manual.size} collision tiles`);
      if (apply) summary.migrated++;
    } catch (error: unknown) {
      summary.conflicts++;
      log(
        `[${apply ? 'APPLY' : 'DRY-RUN'}] ${candidate.id}: CONFLICT ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  log(`[SUMMARY] mode=${apply ? 'apply' : 'dry-run'} ${JSON.stringify(summary)}`);
  if (summary.conflicts > 0) throw new CollisionMigrationConflictsError(summary);
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
