import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { acquirePackAdvisoryLock } from '../utils/advisoryLocks.js';
import type { MapDb } from '../utils/mapChunkMutations.js';
import { cleanupAssetPackGenerations } from './assetPackGenerationCleanup.js';

const PACK_UUID_PATTERN = /^[a-zA-Z0-9_-]+$/;

type PackReferenceReader = Pick<MapDb, 'mapAutotile' | 'mapObject' | 'mapTileset'>;

/** Tilesets carry no pack column; they reference pack files by URL only. */
export function packTilesetReferenceWhere(packUuid: string): { imageUrl: { contains: string } } {
  return { imageUrl: { contains: `/packs/${packUuid}/` } };
}

/** Every stored URL that may point into this pack's files. */
export async function collectPackReferenceUrls(db: PackReferenceReader, packUuid: string): Promise<string[]> {
  const [autotiles, objects, tilesets] = await Promise.all([
    db.mapAutotile.findMany({ where: { packUuid }, select: { imageUrl: true } }),
    db.mapObject.findMany({ where: { assetPackUuid: packUuid }, select: { dataUrl: true } }),
    db.mapTileset.findMany({ where: packTilesetReferenceWhere(packUuid), select: { imageUrl: true } }),
  ]);
  return [
    ...autotiles.map((row) => row.imageUrl),
    ...objects.map((row) => row.dataUrl),
    ...tilesets.map((row) => row.imageUrl),
  ];
}

/**
 * Removes superseded generations of a pack after the publishing transaction
 * has committed. Runs under the pack lock so no reference can be created
 * between the reference check and the removal.
 */
export async function cleanupPackGenerationsAfterCommit(
  prisma: PrismaClient,
  packsDir: string,
  packUuid: string,
): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await acquirePackAdvisoryLock(tx, packUuid);
    const pack = await tx.assetPack.findUnique({ where: { uuid: packUuid }, select: { currentGeneration: true } });
    if (!pack) return [];
    const references = await collectPackReferenceUrls(tx, packUuid);
    return cleanupAssetPackGenerations(packsDir, packUuid, pack.currentGeneration, references);
  });
}

/**
 * Removes the files of a deleted pack after the deleting transaction has
 * committed. Skips the removal when the pack was uploaded again or gained a
 * reference in the meantime.
 */
export async function removeDeletedPackFilesAfterCommit(
  prisma: PrismaClient,
  packsDir: string,
  packUuid: string,
): Promise<boolean> {
  if (!PACK_UUID_PATTERN.test(packUuid)) throw new Error('invalid asset pack uuid');
  const root = path.resolve(packsDir);
  const packDir = path.resolve(root, packUuid);
  if (path.dirname(packDir) !== root) throw new Error('invalid asset pack directory');
  return prisma.$transaction(async (tx) => {
    await acquirePackAdvisoryLock(tx, packUuid);
    const pack = await tx.assetPack.findUnique({ where: { uuid: packUuid }, select: { id: true } });
    if (pack) return false;
    const references = await collectPackReferenceUrls(tx, packUuid);
    if (references.length > 0) return false;
    await fsp.rm(packDir, { recursive: true, force: true });
    return true;
  });
}
