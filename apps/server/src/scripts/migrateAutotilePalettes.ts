/**
 * Reconstruct map-local palettes for legacy walls_auto chunks.
 *
 * WARNING: The result is provably correct only when the set and contents of
 * visible global packs have not changed since every affected cell was painted.
 * The legacy client derived slots from that mutable pack set. Always perform a
 * visual review of every migrated map before accepting an --apply run.
 *
 * Dry-run is the default:
 *   npm -w @meetropolis/server run map:autotiles:migrate
 *   npm -w @meetropolis/server run map:autotiles:migrate -- --apply
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../db.js';
import { Prisma, type PrismaClient } from '../generated/prisma/index.js';
import { decodeRlePairsFromBuffer, rleDecodeToNumbers } from '../mapEncoding.js';
import { StoredAutotileItemSchema } from '../api/routes/assetPacks.schemas.js';
import { contentHashFromAssetUrl } from '../api/utils/mapAutotilePalette.js';

interface LegacyAutotile {
  slot: number;
  packUuid: string;
  autotileId: string;
  key: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
  gridHeight: number;
  variants: Prisma.InputJsonValue;
  collide: boolean;
  placement: string;
  hash: string | null;
}

interface MigrationSummary {
  maps: number;
  pending: number;
  migrated: number;
  unchanged: number;
  conflicts: number;
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

export function buildLegacyPalette(packs: Array<{ uuid: string; autotiles: Prisma.JsonValue }>): LegacyAutotile[] {
  const palette: LegacyAutotile[] = [];
  for (const pack of [...packs].sort((left, right) => left.uuid.localeCompare(right.uuid))) {
    if (!Array.isArray(pack.autotiles)) throw new Error(`Global pack '${pack.uuid}' has invalid autotiles JSON.`);
    const items = pack.autotiles.map((value, index) => {
      const parsed = StoredAutotileItemSchema.safeParse(value);
      if (!parsed.success) throw new Error(`Global pack '${pack.uuid}' has invalid autotile at index ${index}.`);
      return parsed.data;
    });
    items.sort((left, right) => left.id.localeCompare(right.id));
    for (const item of items) {
      palette.push({
        slot: palette.length + 1,
        packUuid: pack.uuid,
        autotileId: item.id,
        key: item.key,
        imageUrl: item.dataURL,
        tileWidth: item.tileWidth,
        tileHeight: item.tileHeight,
        gridHeight: item.gridHeight,
        variants: item.variants,
        collide: item.collide,
        placement: item.placement,
        hash: contentHashFromAssetUrl(item.dataURL),
      });
    }
  }
  return palette;
}

function usedSlots(chunks: Array<{ encoding: string; data: Uint8Array | Buffer }>, chunkSize: number): Set<number> {
  const slots = new Set<number>();
  for (const chunk of chunks) {
    if (chunk.encoding !== 'rle') throw new Error(`Unsupported walls_auto encoding '${chunk.encoding}'.`);
    const values = rleDecodeToNumbers(decodeRlePairsFromBuffer(Buffer.from(chunk.data)), chunkSize * chunkSize);
    for (const value of values) if (value > 0) slots.add(value);
  }
  return slots;
}

function paletteConflict(
  expected: LegacyAutotile[],
  existing: Array<{ slot: number; packUuid: string; autotileId: string }>,
): string | null {
  for (const entry of expected) {
    const atSlot = existing.find((candidate) => candidate.slot === entry.slot);
    if (atSlot && (atSlot.packUuid !== entry.packUuid || atSlot.autotileId !== entry.autotileId)) {
      return `slot ${entry.slot} already belongs to ${atSlot.packUuid}:${atSlot.autotileId}`;
    }
    const atIdentity = existing.find(
      (candidate) => candidate.packUuid === entry.packUuid && candidate.autotileId === entry.autotileId,
    );
    if (atIdentity && atIdentity.slot !== entry.slot) {
      return `${entry.packUuid}:${entry.autotileId} already uses slot ${atIdentity.slot}`;
    }
  }
  return null;
}

export async function migrateAutotilePalettes(
  prisma: PrismaClient,
  apply: boolean,
  log: (message: string) => void = console.log,
): Promise<MigrationSummary> {
  const packs = await prisma.assetPack.findMany({
    where: { tenantId: null, archived: false },
    orderBy: { uuid: 'asc' },
    select: { uuid: true, autotiles: true },
  });
  const legacy = buildLegacyPalette(packs);
  const layers = await prisma.mapLayer.findMany({
    where: { name: 'walls_auto', chunks: { some: {} } },
    orderBy: { mapId: 'asc' },
    select: {
      mapId: true,
      chunkSize: true,
      map: { select: { nextAutotileSlot: true } },
      chunks: { select: { encoding: true, data: true } },
    },
  });
  const summary: MigrationSummary = { maps: layers.length, pending: 0, migrated: 0, unchanged: 0, conflicts: 0 };

  for (const layer of layers) {
    const used = usedSlots(layer.chunks, layer.chunkSize);
    if (used.size === 0) {
      summary.unchanged++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${layer.mapId}: no non-empty walls_auto cells`);
      continue;
    }
    const unresolved = [...used].filter((slot) => !legacy.some((entry) => entry.slot === slot));
    const existing = await prisma.mapAutotile.findMany({
      where: { mapId: layer.mapId },
      select: { id: true, slot: true, packUuid: true, autotileId: true, hash: true },
    });
    const conflict =
      unresolved.length > 0 ? `unresolved legacy slots ${unresolved.join(', ')}` : paletteConflict(legacy, existing);
    if (conflict) {
      summary.conflicts++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${layer.mapId}: CONFLICT ${conflict}`);
      continue;
    }
    const missing = legacy.filter((entry) => !existing.some((candidate) => candidate.slot === entry.slot));
    const hashRepairs = existing.flatMap((entry) => {
      if (entry.hash) return [];
      const expected = legacy.find(
        (candidate) => candidate.packUuid === entry.packUuid && candidate.autotileId === entry.autotileId,
      );
      return expected?.hash ? [{ id: entry.id, hash: expected.hash }] : [];
    });
    const nextAutotileSlot = Math.max(
      1,
      ...legacy.map((entry) => entry.slot + 1),
      ...existing.map((entry) => entry.slot + 1),
    );
    const repairCounter = layer.map.nextAutotileSlot < nextAutotileSlot;
    if (missing.length === 0 && hashRepairs.length === 0 && !repairCounter) {
      summary.unchanged++;
      log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${layer.mapId}: palette already complete; used=${[...used].join(',')}`);
      continue;
    }
    summary.pending++;
    const action = `add ${missing.length} entries; repair ${hashRepairs.length} hashes${repairCounter ? `; set next slot to ${nextAutotileSlot}` : ''}`;
    log(`[${apply ? 'APPLY' : 'DRY-RUN'}] ${layer.mapId}: ${action}; used=${[...used].join(',')}`);
    if (!apply) continue;
    await prisma.$transaction(async (tx) => {
      for (const entry of missing) {
        await tx.mapAutotile.create({ data: { mapId: layer.mapId, ...entry } });
      }
      for (const repair of hashRepairs) {
        await tx.mapAutotile.update({ where: { id: repair.id }, data: { hash: repair.hash } });
      }
      await tx.map.updateMany({
        where: { id: layer.mapId, nextAutotileSlot: { lt: nextAutotileSlot } },
        data: { nextAutotileSlot },
      });
    });
    summary.migrated++;
  }
  log(`[SUMMARY] mode=${apply ? 'apply' : 'dry-run'} ${JSON.stringify(summary)}`);
  log('[REVIEW REQUIRED] Visually inspect every affected map; legacy reconstruction depends on unchanged packs.');
  return summary;
}

async function main(): Promise<void> {
  let apply: boolean;
  try {
    apply = parseApply(process.argv.slice(2));
  } catch (error) {
    const usage = 'Usage: npm -w @meetropolis/server run map:autotiles:migrate -- [--apply|--dry-run]';
    console.error(error instanceof Error && error.message !== 'usage' ? error.message : usage);
    if (error instanceof Error && error.message !== 'usage') console.error(usage);
    process.exitCode = error instanceof Error && error.message === 'usage' ? 0 : 2;
    return;
  }
  const prisma = createPrismaClient();
  try {
    await migrateAutotilePalettes(prisma, apply);
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
