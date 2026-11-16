import { existsSync, promises as fsp, type Dirent } from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { customAvatarDir, customAvatarPacksDir } from '../avatarComposer.js';
import { npcMediaDir } from '../../api/routes/npcMedia.js';
import { importedTilesetsDir } from '../../api/routes/tmj.import.js';
import { TenantExportError } from './sink.js';
import type { TenantExportSink } from './types.js';

/** Storage roots of the tenant files, resolved like the routes that write them. */
export interface FileRoots {
  packsDir: string;
  npcMediaDir: string;
  tilesetsDir: string;
}

/** Resolves the file storage roots through the existing resolvers. */
export function resolveFileRoots(): FileRoots {
  return {
    packsDir: customAvatarPacksDir(),
    npcMediaDir: npcMediaDir(),
    tilesetsDir: importedTilesetsDir(),
  };
}

/** File references of one tenant, read from the database. */
export interface TenantFileRows {
  assetPackUuids: string[];
  avatarPackUuids: string[];
  customAvatarUuids: string[];
  npcMediaPaths: string[];
  tilesetImageUrls: string[];
}

/** Reads every file reference of the tenant, one query per model. */
export async function loadTenantFileRows(prisma: PrismaClient, tenantId: string): Promise<TenantFileRows> {
  const [assetPacks, avatarPacks, customAvatars, npcMedia, tilesets] = await Promise.all([
    prisma.assetPack.findMany({ where: { tenantId }, select: { uuid: true } }),
    prisma.avatarPack.findMany({ where: { tenantId }, select: { uuid: true } }),
    prisma.customAvatar.findMany({ where: { tenantId }, select: { uuid: true } }),
    prisma.npcMediaFile.findMany({ where: { npc: { tenantId } }, select: { storagePath: true } }),
    prisma.mapTileset.findMany({ where: { map: { tenantId } }, select: { imageUrl: true } }),
  ]);
  return {
    assetPackUuids: assetPacks.map((pack) => pack.uuid),
    avatarPackUuids: avatarPacks.map((pack) => pack.uuid),
    customAvatarUuids: customAvatars.map((avatar) => avatar.uuid),
    npcMediaPaths: npcMedia.map((file) => file.storagePath),
    tilesetImageUrls: tilesets.map((tileset) => tileset.imageUrl),
  };
}

/** Planned copy: directories are copied recursively, files one by one. */
export interface FilePlan {
  dirs: { relDir: string; sourceDir: string }[];
  files: { relPath: string; source: string }[];
  tilesetsNotFound: string[];
}

const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Rejects one path segment that could escape its storage root. */
function assertSegment(name: string): void {
  if (name.length === 0 || name === '.' || name === '..' || !SEGMENT_PATTERN.test(name)) {
    throw new TenantExportError('unsafe_path');
  }
}

/** Rejects a resolved path that is not strictly below its root. */
function assertInside(root: string, resolved: string): void {
  const relative = path.relative(path.resolve(root), resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TenantExportError('unsafe_path');
  }
}

/** Plans one directory copy below `root`, keyed by a single validated segment. */
function planDir(dirs: Map<string, { relDir: string; sourceDir: string }>, root: string, relDir: string, sourceDir: string): void {
  assertInside(root, sourceDir);
  if (!dirs.has(relDir)) {
    dirs.set(relDir, { relDir, sourceDir });
  }
}

/** Plans one file copy below `root`. */
function planFile(files: Map<string, { relPath: string; source: string }>, root: string, relPath: string, source: string): void {
  assertInside(root, source);
  if (!files.has(relPath)) {
    files.set(relPath, { relPath, source });
  }
}

/**
 * Plans where every tenant file lands in the export. Throws `unsafe_path`
 * when a name is not a plain segment or a source escapes its storage root.
 * Tileset URLs outside `/assets/tilesets/` are ignored; missing tileset
 * files are reported in `tilesetsNotFound` instead of failing the export.
 */
export function planTenantFiles(
  rows: TenantFileRows,
  roots: FileRoots,
  tenantSlug: string,
  exists: (path: string) => boolean,
): FilePlan {
  assertSegment(tenantSlug);
  const dirs = new Map<string, { relDir: string; sourceDir: string }>();
  const files = new Map<string, { relPath: string; source: string }>();
  const tilesetsNotFound: string[] = [];

  for (const uuid of rows.assetPackUuids) {
    assertSegment(uuid);
    planDir(dirs, roots.packsDir, `files/packs/${uuid}`, path.resolve(roots.packsDir, uuid));
  }
  for (const uuid of rows.avatarPackUuids) {
    assertSegment(uuid);
    planDir(dirs, roots.packsDir, `files/avatars/${uuid}`, path.resolve(roots.packsDir, 'avatars', uuid));
  }
  const customDir = customAvatarDir(path.resolve(roots.packsDir));
  for (const uuid of rows.customAvatarUuids) {
    assertSegment(uuid);
    planFile(files, roots.packsDir, `files/custom-avatars/${uuid}.png`, path.resolve(customDir, `${uuid}.png`));
    planFile(files, roots.packsDir, `files/custom-avatars/${uuid}_p.png`, path.resolve(customDir, `${uuid}_p.png`));
  }
  planNpcMedia(files, roots, tenantSlug, rows.npcMediaPaths);
  planTilesets(files, roots, rows.tilesetImageUrls, exists, tilesetsNotFound);

  return { dirs: [...dirs.values()], files: [...files.values()], tilesetsNotFound };
}

/** Plans the NPC media copies; every source must stay below the tenant folder. */
function planNpcMedia(
  files: Map<string, { relPath: string; source: string }>,
  roots: FileRoots,
  tenantSlug: string,
  storagePaths: string[],
): void {
  const npcRoot = path.resolve(roots.npcMediaDir);
  const tenantBase = path.resolve(npcRoot, tenantSlug);
  for (const storagePath of storagePaths) {
    const segments = storagePath.split('/');
    for (const segment of segments) {
      assertSegment(segment);
    }
    const source = path.resolve(npcRoot, ...segments);
    assertInside(tenantBase, source);
    planFile(files, roots.npcMediaDir, `files/npc-media/${storagePath}`, source);
  }
}

/** Plans the tileset copies; foreign URLs are ignored, missing files reported. */
function planTilesets(
  files: Map<string, { relPath: string; source: string }>,
  roots: FileRoots,
  imageUrls: string[],
  exists: (path: string) => boolean,
  tilesetsNotFound: string[],
): void {
  const seen = new Set<string>();
  for (const imageUrl of imageUrls) {
    if (!imageUrl.startsWith('/assets/tilesets/')) {
      continue;
    }
    const baseName = path.posix.basename(imageUrl);
    assertSegment(baseName);
    if (seen.has(baseName)) {
      continue;
    }
    seen.add(baseName);
    const source = path.resolve(roots.tilesetsDir, baseName);
    assertInside(roots.tilesetsDir, source);
    if (exists(source)) {
      planFile(files, roots.tilesetsDir, `files/tilesets/${baseName}`, source);
    } else {
      tilesetsNotFound.push(baseName);
    }
  }
}

/** Copies one planned directory recursively, skipping symlinks. */
async function copyPlannedDir(sink: TenantExportSink, relDir: string, sourceDir: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await sink.copyFile(relDir, sourceDir);
      return;
    }
    throw error;
  }
  const names = entries.map((entry) => entry.name).sort();
  for (const name of names) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry || entry.isSymbolicLink()) {
      continue;
    }
    const relPath = `${relDir}/${name}`;
    const fullPath = path.join(sourceDir, name);
    if (entry.isDirectory()) {
      await copyPlannedDir(sink, relPath, fullPath);
    } else if (entry.isFile()) {
      await sink.copyFile(relPath, fullPath);
    }
  }
}

/**
 * Copies every planned file through the sink. Missing directories are
 * recorded as missing; symlinks are never followed.
 */
export async function copyPlannedFiles(plan: FilePlan, sink: TenantExportSink): Promise<void> {
  for (const dir of plan.dirs) {
    await copyPlannedDir(sink, dir.relDir, dir.sourceDir);
  }
  for (const file of plan.files) {
    await sink.copyFile(file.relPath, file.source);
  }
}

/**
 * Copies every file of the tenant into the export. Returns the tileset
 * basenames that were referenced but not found on disk.
 */
export async function collectTenantFiles(
  prisma: PrismaClient,
  tenant: { id: string; slug: string },
  sink: TenantExportSink,
  roots: FileRoots = resolveFileRoots(),
): Promise<{ tilesetsNotFound: string[] }> {
  const rows = await loadTenantFileRows(prisma, tenant.id);
  const plan = planTenantFiles(rows, roots, tenant.slug, existsSync);
  await copyPlannedFiles(plan, sink);
  return { tilesetsNotFound: plan.tilesetsNotFound };
}
