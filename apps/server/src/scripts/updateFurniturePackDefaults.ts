/**
 * Migration M2 helper (Strang B): backfill the per-object collision defaults
 * (`collide` / `collisionBaseHeight` / `renderLayer`) onto the persisted
 * `pixel-agents-furniture` AssetPack row from the on-disk furniture manifests.
 *
 * WHY THIS EXISTS
 * ---------------
 * `rerasterCollision.ts` reads these three fields per object id from the DB
 * AssetPack (`loadItemDefaults`). On environments seeded before the manifests
 * carried foot-collision heights, the stored pack objects lack the fields (or
 * the objects array is empty), so reraster reports "Loaded 0 item defaults" and
 * would fall back to full-footprint collision. The full seed (`prisma/seed.ts`)
 * already refreshes the pack via its upsert `update` branch, but the seed runs
 * only at initial provisioning and is not part of the deploy/migration flow, so
 * an existing production pack row stays stale.
 *
 * This script performs the narrowest possible repair: it derives the canonical
 * furniture defaults from the SAME manifests the seed reads
 * (apps/web/public/assets/furniture/<GROUP>/manifest.json, present in the server
 * image), then reconciles ONLY the AssetPack.objects JSON:
 *
 *   - Existing objects with a string `id` that matches a manifest item get the
 *     three collision fields overwritten to the manifest-derived values. Every
 *     other field on the object (dataURL, width, height, key, scaleFactor, …)
 *     is preserved verbatim.
 *   - Manifest items whose `id` is not present among the existing string-id
 *     objects are appended.
 *   - Nothing is ever removed. Idless/unknown existing entries are left
 *     untouched (reraster ignores non-string-id entries anyway).
 *
 * No other AssetPack column is touched, and NO MapObject or collision chunk is
 * modified. It is dry-run by default and idempotent: a second run is a no-op.
 *
 * PROD PARITY: compiled to dist/scripts/updateFurniturePackDefaults.js and run
 * via `node` (no tsx on prod), exactly like rerasterCollision.
 *
 *   npx tsx src/scripts/updateFurniturePackDefaults.ts          # dry-run
 *   npx tsx src/scripts/updateFurniturePackDefaults.ts --apply  # write
 *   node dist/scripts/updateFurniturePackDefaults.js [--apply]   # prod
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPrismaClient } from '../db.js';
import type { Prisma } from '../generated/prisma/index.js';

const PACK_UUID = 'pixel-agents-furniture';

type FurnitureDefault = {
  id: string;
  key: string;
  dataURL: string;
  width: number;
  height: number;
  collide: boolean;
  rotationAllowed: boolean;
  scaleFactor: number;
  collisionBaseHeight: number;
  renderLayer: 'floor' | 'sorted' | 'overhead';
};

type ManifestNode = {
  id?: string;
  type?: string;
  file?: string;
  width?: number;
  height?: number;
  footprintW?: number;
  footprintH?: number;
  category?: string;
  collisionBaseHeight?: number;
  members?: ManifestNode[];
};

/**
 * Resolve the on-disk furniture directory. Anchored to this module's own
 * location so it works identically under `src/scripts` (tsx dev) and
 * `dist/scripts` (node prod): four segments up from the scripts dir is the
 * workspace root, where apps/web/public/assets/furniture lives (copied into the
 * server image by the Tiamat server Dockerfile). Override via FURNITURE_DIR.
 */
function resolveFurnitureDir(): string {
  const override = process.env.FURNITURE_DIR;
  if (override && override.length > 0) return override;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = path.resolve(here, '..', '..', '..', '..');
  return path.join(workspaceRoot, 'apps', 'web', 'public', 'assets', 'furniture');
}

/**
 * Derive the canonical furniture defaults from the manifests. This mirrors the
 * exact walk + collide policy in prisma/seed.ts so the produced fields are
 * byte-identical to a fresh seed.
 */
function deriveDefaults(furnitureDir: string): FurnitureDefault[] {
  const items: FurnitureDefault[] = [];
  if (!fs.existsSync(furnitureDir)) {
    throw new Error(`furniture dir not found: ${furnitureDir} (set FURNITURE_DIR to override)`);
  }
  const groups = fs.readdirSync(furnitureDir).sort();
  for (const groupName of groups) {
    const groupDir = path.join(furnitureDir, groupName);
    const manifestPath = path.join(groupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = parsed as ManifestNode;
    const addAsset = (node: ManifestNode) => {
      const fileName = node.file ?? `${node.id ?? manifest.id ?? groupName}.png`;
      const id = node.id ?? manifest.id ?? groupName;
      const w = node.width ?? manifest.width ?? 16;
      const h = node.height ?? manifest.height ?? 16;
      const category = manifest.category ?? 'misc';
      // Collide policy mirrors the map generator's collides_for (B-DP7): wall
      // art, misc surface items (BIN/COFFEE) and desktop electronics (PC) do
      // not block; floor furniture and potted plants do.
      const collides =
        category !== 'wall' &&
        category !== 'misc' &&
        category !== 'electronics' &&
        !id.includes('PAINTING') &&
        !id.includes('CLOCK');
      const collisionBaseHeight = node.collisionBaseHeight ?? manifest.collisionBaseHeight ?? 0;
      const renderLayer: 'floor' | 'sorted' | 'overhead' = category === 'wall' ? 'overhead' : 'sorted';
      items.push({
        id,
        key: id,
        dataURL: `/assets/furniture/${groupName}/${fileName}`,
        width: w,
        height: h,
        collide: collides,
        rotationAllowed: false,
        scaleFactor: 1,
        collisionBaseHeight,
        renderLayer,
      });
    };
    const walk = (node: ManifestNode) => {
      if (node.type === 'asset' || !node.members) {
        addAsset(node);
        return;
      }
      for (const child of node.members ?? []) walk(child);
    };
    walk(manifest);
  }
  return items;
}

type PackUpdatePlan = {
  result: Array<Record<string, unknown>>;
  enrichedIds: string[];
  addedIds: string[];
  presentCount: number;
  idlessKept: number;
};

/**
 * Reconcile the pack's stored objects against the manifest-derived defaults.
 * Pure (no DB, no logging), operates on a deep clone so the diff reflects real
 * changes only: string-id objects matching a manifest item get the three
 * collision fields overwritten; manifest items missing entirely are appended.
 * Nothing is removed and idless entries are preserved verbatim.
 */
function computePackUpdate(existing: Array<Record<string, unknown>>, derived: FurnitureDefault[]): PackUpdatePlan {
  const derivedById = new Map<string, FurnitureDefault>();
  for (const d of derived) derivedById.set(d.id, d);

  const result: Array<Record<string, unknown>> = structuredClone(existing);
  const presentIds = new Set<string>();
  let idlessKept = 0;
  for (const o of result) {
    if (typeof o.id === 'string') presentIds.add(o.id);
    else idlessKept++;
  }

  // 1) Enrich existing string-id objects that match a manifest item.
  const enrichedIds: string[] = [];
  for (const o of result) {
    if (typeof o.id !== 'string') continue;
    const d = derivedById.get(o.id);
    if (!d) continue;
    const changed =
      o.collide !== d.collide || o.collisionBaseHeight !== d.collisionBaseHeight || o.renderLayer !== d.renderLayer;
    if (changed) {
      o.collide = d.collide;
      o.collisionBaseHeight = d.collisionBaseHeight;
      o.renderLayer = d.renderLayer;
      enrichedIds.push(o.id);
    }
  }

  // 2) Append manifest items missing from the pack entirely.
  const addedIds: string[] = [];
  for (const d of derived) {
    if (presentIds.has(d.id)) continue;
    result.push({
      id: d.id,
      key: d.key,
      dataURL: d.dataURL,
      width: d.width,
      height: d.height,
      collide: d.collide,
      rotationAllowed: d.rotationAllowed,
      scaleFactor: d.scaleFactor,
      collisionBaseHeight: d.collisionBaseHeight,
      renderLayer: d.renderLayer,
    });
    addedIds.push(d.id);
  }

  return { result, enrichedIds, addedIds, presentCount: presentIds.size, idlessKept };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const furnitureDir = resolveFurnitureDir();
  const derived = deriveDefaults(furnitureDir);

  console.log(
    `Derived ${derived.length} furniture defaults from ${furnitureDir}. Mode: ${apply ? 'APPLY' : 'DRY-RUN'}.`,
  );

  const prisma = createPrismaClient();
  try {
    const pack = await prisma.assetPack.findUnique({ where: { uuid: PACK_UUID } });
    if (!pack) {
      throw new Error(
        `AssetPack '${PACK_UUID}' not found. This script only UPDATES an existing pack; run the seed to create it.`,
      );
    }

    const existing = (Array.isArray(pack.objects) ? pack.objects : []) as Array<Record<string, unknown>>;
    const { result, enrichedIds, addedIds, presentCount, idlessKept } = computePackUpdate(existing, derived);

    console.log(
      `Pack objects: ${existing.length} existing (${presentCount} with id, ${idlessKept} idless kept). ` +
        `Enrich ${enrichedIds.length}, append ${addedIds.length}. Result would hold ${result.length} objects.`,
    );
    if (enrichedIds.length > 0) console.log(`  enrich: ${enrichedIds.sort().join(', ')}`);
    if (addedIds.length > 0) console.log(`  append: ${addedIds.sort().join(', ')}`);

    if (enrichedIds.length === 0 && addedIds.length === 0) {
      console.log('Pack already carries all manifest collision defaults. No change.');
      return;
    }

    if (!apply) {
      console.log('DRY-RUN: no write. Re-run with --apply to persist.');
      return;
    }

    await prisma.assetPack.update({
      where: { uuid: PACK_UUID },
      // Prisma types the Json column as InputJsonValue; a Record<string,unknown>[]
      // needs the widening cast to satisfy the InputJsonObject index signature.
      data: { objects: result as unknown as Prisma.InputJsonValue },
    });
    console.log(`APPLIED: AssetPack '${PACK_UUID}'.objects updated (${result.length} objects).`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

void main();
