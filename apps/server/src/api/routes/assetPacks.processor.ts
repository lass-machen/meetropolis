import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import path from 'path';
import fsp from 'fs/promises';
import { requireAuth, requireApiToken, requireInternalOwner } from '../utils/authHelpers.js';
import type {
  AssetPackConfig,
  AssetPackConfigRewritten,
  AssetPackTerrainItem,
  AssetPackSpriteItem,
  AssetPackAutotileItem,
  AssetPackItemBase,
  ZipEntry,
} from '../../types/assetPack.js';
import type { RequestWithMulterFile } from '../../types/multer.js';
import {
  ConfigSchema,
  normalizeZipPath,
  isUnsafePath,
  isAllowedAssetExt,
  shortHashHex,
  withoutAssetsPrefix,
} from './assetPacks.schemas.js';

interface DimensionMaps {
  terrainMap: Map<string, AssetPackTerrainItem>;
  structMap: Map<string, AssetPackSpriteItem>;
  objMap: Map<string, AssetPackSpriteItem>;
  autotileMap: Map<string, AssetPackAutotileItem>;
}

function buildDimensionMaps(cfg: AssetPackConfig): DimensionMaps {
  const terrainMap = new Map<string, AssetPackTerrainItem>();
  const structMap = new Map<string, AssetPackSpriteItem>();
  const objMap = new Map<string, AssetPackSpriteItem>();
  const autotileMap = new Map<string, AssetPackAutotileItem>();
  for (const t of cfg.terrain || []) terrainMap.set(t.id, t);
  for (const s of cfg.structures || []) structMap.set(s.id, s);
  for (const o of cfg.objects || []) objMap.set(o.id, o);
  for (const a of cfg.autotiles || []) autotileMap.set(a.id, a);
  return { terrainMap, structMap, objMap, autotileMap };
}

export function dimensionsStable(
  oldCfg: AssetPackConfig,
  newCfg: AssetPackConfig,
): { ok: true } | { ok: false; reason: string; offendingId?: string } {
  const oldMaps = buildDimensionMaps(oldCfg);
  const newMaps = buildDimensionMaps(newCfg);
  const num = (v: number | undefined | null): number => (v == null ? 0 : Number(v));
  for (const [id, oldT] of oldMaps.terrainMap) {
    const n = newMaps.terrainMap.get(id);
    if (!n) continue;
    if (
      num(oldT.tileWidth) !== num(n.tileWidth) ||
      num(oldT.tileHeight) !== num(n.tileHeight) ||
      num(oldT.margin) !== num(n.margin) ||
      num(oldT.spacing) !== num(n.spacing)
    ) {
      return {
        ok: false,
        reason: `terrain dimensions changed: was ${oldT.tileWidth}x${oldT.tileHeight}, now ${n.tileWidth}x${n.tileHeight}`,
        offendingId: id,
      };
    }
  }
  for (const [id, oldS] of oldMaps.structMap) {
    const n = newMaps.structMap.get(id);
    if (!n) continue;
    if (num(oldS.width) !== num(n.width) || num(oldS.height) !== num(n.height)) {
      return {
        ok: false,
        reason: `structure dimensions changed: was ${oldS.width}x${oldS.height}, now ${n.width}x${n.height}`,
        offendingId: id,
      };
    }
  }
  for (const [id, oldO] of oldMaps.objMap) {
    const n = newMaps.objMap.get(id);
    if (!n) continue;
    if (num(oldO.width) !== num(n.width) || num(oldO.height) !== num(n.height)) {
      return {
        ok: false,
        reason: `object dimensions changed: was ${oldO.width}x${oldO.height}, now ${n.width}x${n.height}`,
        offendingId: id,
      };
    }
  }
  for (const [id, oldA] of oldMaps.autotileMap) {
    const n = newMaps.autotileMap.get(id);
    if (!n) continue;
    if (num(oldA.tileWidth) !== num(n.tileWidth) || num(oldA.tileHeight) !== num(n.tileHeight)) {
      return {
        ok: false,
        reason: `autotile dimensions changed: was ${oldA.tileWidth}x${oldA.tileHeight}, now ${n.tileWidth}x${n.tileHeight}`,
        offendingId: id,
      };
    }
  }
  return { ok: true };
}

export async function authenticateAssetPackAdmin(
  prisma: PrismaClient,
  req: express.Request,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const sessionAuth = requireAuth(req);
  const tokenAuth = await requireApiToken(req, prisma);
  const auth = sessionAuth || tokenAuth;
  if (!auth) return { ok: false, status: 401, error: 'unauthorized' };
  const isAdmin = await requireInternalOwner(req, auth.userId, prisma);
  if (!isAdmin) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true };
}

type ZipScanResult =
  | { ok: true; configEntry: ZipEntry; assetEntries: ZipEntry[] }
  | { ok: false; status: number; error: string };

export function scanZipEntries(files: ZipEntry[]): ZipScanResult {
  const allowedRoot = new Set(['config.json']);
  let configEntry: ZipEntry | null = null;
  const assetEntries: ZipEntry[] = [];

  for (const entry of files) {
    const rawPath: string = entry.path || entry.fileName || '';
    const norm = normalizeZipPath(rawPath);
    if (isUnsafePath(norm)) return { ok: false, status: 400, error: 'unsafe entry path' };
    if (norm === 'config.json') {
      configEntry = entry;
      continue;
    }
    if (norm.startsWith('assets/')) {
      if (entry.type && entry.type !== 'File' && entry.type !== 'Directory') {
        return { ok: false, status: 400, error: 'unsupported zip entry type' };
      }
      assetEntries.push(entry);
      continue;
    }
    if (norm !== '' && !allowedRoot.has(norm)) {
      return { ok: false, status: 400, error: 'invalid zip entries' };
    }
  }

  if (!configEntry) return { ok: false, status: 400, error: 'config.json missing' };
  return { ok: true, configEntry, assetEntries };
}

export function buildAssetSet(assetEntries: ZipEntry[]): Set<string> {
  const assetSet = new Set<string>();
  for (const e of assetEntries) {
    const p = normalizeZipPath(e.path || e.fileName || '');
    if (p.endsWith('/')) continue;
    assetSet.add(p);
  }
  return assetSet;
}

type ItemValidationError = { error: string; itemId: string; dataURL: string };

export function validateConfigAssetReferences(cfg: AssetPackConfig, assetSet: Set<string>): ItemValidationError | null {
  const validateItemPath = (p: string): { ok: true; norm: string } | { ok: false } => {
    const norm = normalizeZipPath(p);
    if (!norm.startsWith('assets/')) return { ok: false };
    if (isUnsafePath(norm)) return { ok: false };
    if (!isAllowedAssetExt(norm)) return { ok: false };
    if (!assetSet.has(norm)) return { ok: false };
    return { ok: true, norm };
  };

  const arrays: Array<AssetPackItemBase[]> = [
    cfg.terrain ?? [],
    cfg.structures ?? [],
    cfg.objects ?? [],
    cfg.autotiles ?? [],
  ];
  for (const arr of arrays) {
    for (const it of arr) {
      const r = validateItemPath(it.dataURL);
      if (!r.ok) return { error: 'missing or invalid asset for item', itemId: it.id, dataURL: it.dataURL };
      const directional = (it as AssetPackSpriteItem).directionalImages;
      if (Array.isArray(directional)) {
        for (const di of directional) {
          const dr = validateItemPath(di.dataURL);
          if (!dr.ok)
            return { error: 'missing or invalid asset for directionalImage', itemId: it.id, dataURL: di.dataURL };
        }
      }
    }
  }
  return null;
}

export async function extractAssetsToTmpDir(
  assetEntries: ZipEntry[],
  tmpDir: string,
): Promise<{ ok: true; assetMap: Map<string, string> } | { ok: false; status: number; error: string; path?: string }> {
  const assetMap = new Map<string, string>();
  for (const entry of assetEntries) {
    const p = normalizeZipPath(entry.path || entry.fileName || '');
    if (p.endsWith('/')) continue;
    if (!isAllowedAssetExt(p)) {
      return { ok: false, status: 400, error: 'unsupported asset extension', path: p };
    }
    const content: Buffer = await entry.buffer();
    const h8 = shortHashHex(content, 8);
    const rel = withoutAssetsPrefix(p);
    const dirPart = path.dirname(rel);
    const base = path.basename(rel, path.extname(rel));
    const ext = path.extname(rel).toLowerCase();
    const hashedName = `${base}.${h8}${ext}`;
    const targetRel = dirPart === '.' ? hashedName : `${dirPart}/${hashedName}`;
    const targetAbs = path.resolve(tmpDir, targetRel);
    await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
    await fsp.writeFile(targetAbs, content);
    assetMap.set(p, targetRel);
  }
  return { ok: true, assetMap };
}

export function rewriteConfig(
  cfg: AssetPackConfig,
  uuid: string,
  assetMap: Map<string, string>,
): AssetPackConfigRewritten {
  const rewriteItem = <T extends AssetPackItemBase>(it: T): T & { originalPath?: string } => {
    const original = normalizeZipPath(it.dataURL);
    const mapped = assetMap.get(original);
    if (!mapped) return it;
    const out: T & { originalPath?: string } = { ...it, originalPath: it.dataURL };
    out.dataURL = `/packs/${uuid}/${mapped}`;
    const directional = (it as unknown as AssetPackSpriteItem).directionalImages;
    if (Array.isArray(directional)) {
      (out as unknown as AssetPackSpriteItem).directionalImages = directional.map((di) => {
        const diOriginal = normalizeZipPath(di.dataURL);
        const diMapped = assetMap.get(diOriginal);
        if (!diMapped) return di;
        return { ...di, dataURL: `/packs/${uuid}/${diMapped}` };
      });
    }
    return out;
  };
  return {
    uuid: cfg.uuid,
    name: cfg.name,
    description: cfg.description,
    author: cfg.author,
    version: cfg.version,
    terrain: (cfg.terrain || []).map((t) => rewriteItem(t)),
    structures: (cfg.structures || []).map((s) => rewriteItem(s)),
    objects: (cfg.objects || []).map((o) => rewriteItem(o)),
    autotiles: (cfg.autotiles || []).map((a) => rewriteItem(a)),
  };
}

export async function moveTmpToFinal(tmpDir: string, finalDir: string): Promise<void> {
  try {
    await fsp.rm(finalDir, { recursive: true, force: true });
  } catch {}
  await fsp.mkdir(path.dirname(finalDir), { recursive: true });
  try {
    await fsp.rename(tmpDir, finalDir);
  } catch {
    const copyRecursive = async (src: string, dst: string) => {
      const entries = await fsp.readdir(src, { withFileTypes: true });
      await fsp.mkdir(dst, { recursive: true });
      for (const ent of entries) {
        const s = path.join(src, ent.name);
        const d = path.join(dst, ent.name);
        if (ent.isDirectory()) await copyRecursive(s, d);
        else if (ent.isFile()) await fsp.copyFile(s, d);
      }
    };
    await copyRecursive(tmpDir, finalDir);
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * `tenantId` is deliberately absent from `dataRecord`. On create the column
 * default applies (NULL = platform catalog); on update, naming it at all — even
 * as `tenantId: null` — would reset an ownership assignment made by an operator
 * the next time the pack is re-uploaded. Ownership is assigned operationally
 * (see the cutover runbook), never through this route.
 */
export function persistAssetPackRecord(
  prisma: PrismaClient,
  cfg: AssetPackConfig,
  rewritten: AssetPackConfigRewritten,
  existing: { id: number } | null,
) {
  const dataRecord = {
    uuid: cfg.uuid,
    name: cfg.name,
    description: cfg.description,
    author: cfg.author,
    version: cfg.version,
    terrain: rewritten.terrain as unknown as object,
    structures: rewritten.structures as unknown as object,
    objects: rewritten.objects as unknown as object,
    autotiles: rewritten.autotiles as unknown as object,
  };

  if (existing) {
    return prisma.assetPack.update({ where: { uuid: cfg.uuid }, data: dataRecord });
  }
  return prisma.assetPack.create({ data: dataRecord });
}

export function readUploadedZipBuffer(
  req: express.Request,
): { ok: true; buf: Buffer } | { ok: false; status: number; error: string } {
  const file = (req as RequestWithMulterFile).file;
  if (!file || !file.buffer || !file.size || file.size <= 0) {
    return { ok: false, status: 400, error: 'file required' };
  }
  const buf = file.buffer;
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    return { ok: false, status: 400, error: 'invalid zip' };
  }
  return { ok: true, buf };
}

export async function parseUploadedConfig(
  configEntry: ZipEntry,
): Promise<{ ok: true; cfg: AssetPackConfig } | { ok: false; status: number; error: string; details?: unknown }> {
  const configRaw = await configEntry.buffer();
  let configJson: unknown;
  try {
    configJson = JSON.parse(configRaw.toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: 'invalid config.json' };
  }

  const parsed = ConfigSchema.safeParse(configJson);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'invalid config schema', details: parsed.error.issues };
  }
  return { ok: true, cfg: parsed.data as unknown as AssetPackConfig };
}

export interface ExistingAssetPackRow {
  id: number;
  version: string;
  terrain: unknown;
  structures: unknown;
  objects: unknown;
  autotiles: unknown;
}

export async function checkExistingPackDimensions(
  prisma: PrismaClient,
  uuid: string,
  cfg: AssetPackConfig,
  tmpDir: string,
): Promise<
  | { ok: true; existing: ExistingAssetPackRow | null }
  | { ok: false; status: number; error: string; reason?: string; itemId?: string }
> {
  const existing = (await prisma.assetPack.findUnique({ where: { uuid } })) as ExistingAssetPackRow | null;
  if (existing && existing.version !== cfg.version) {
    const oldCfg: AssetPackConfig = {
      uuid: cfg.uuid,
      name: cfg.name,
      description: cfg.description,
      author: cfg.author,
      version: existing.version,
      terrain: (existing.terrain as AssetPackTerrainItem[]) || [],
      structures: (existing.structures as AssetPackSpriteItem[]) || [],
      objects: (existing.objects as AssetPackSpriteItem[]) || [],
      autotiles: (existing.autotiles as AssetPackAutotileItem[]) || [],
    };
    const check = dimensionsStable(oldCfg, cfg);
    if (!check.ok) {
      try {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      } catch {}
      const failure: { ok: false; status: number; error: string; reason?: string; itemId?: string } = {
        ok: false,
        status: 409,
        error: 'dimension mismatch',
        reason: check.reason,
      };
      if (check.offendingId !== undefined) failure.itemId = check.offendingId;
      return failure;
    }
  }
  return { ok: true, existing };
}
