import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import unzipper from 'unzipper';
import { logger } from '../../logger.js';
import { requireAuth, requireApiToken, requireInternalOwner } from '../utils/authHelpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Zod Schemas according to ASSET_PACKS_SPEC.md
const idStr = z.string().min(1).max(200);
const relPath = z.string().min(1).regex(/^assets\/[A-Za-z0-9_\-\/.]+$/);

const DirectionalImage = z.object({
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  dataURL: relPath,
}).strict();

const BaseItem = z.object({
  id: idStr,
  key: z.string().min(1).max(200),
  category: z.enum(['terrain', 'structure', 'objects']),
  dataURL: relPath,
  collide: z.boolean().default(false),
  placement: z.enum(['any', 'floor', 'wall']).default('any'),
  anchor: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).partial().optional(),
  zIndex: z.number().int().optional(),
  rotationAllowed: z.boolean().optional(),
  flipAllowed: z.boolean().optional(),
  scaleFactor: z.number().positive().optional(),
}).strict();

const TerrainItem = BaseItem.extend({
  category: z.literal('terrain'),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  margin: z.number().int().nonnegative().default(0),
  spacing: z.number().int().nonnegative().default(0),
}).strict();

const SpriteItem = BaseItem.extend({
  category: z.enum(['structure', 'objects']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  directionalImages: z.array(DirectionalImage).max(4).optional(),
}).strict();

const AutotileVariant = z.object({
  col: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
}).strict();

const AutotileItem = z.object({
  id: idStr,
  key: z.string().min(1).max(200),
  category: z.literal('autotile'),
  dataURL: relPath,
  placement: z.enum(['any', 'floor', 'wall']).default('wall'),
  collide: z.boolean().default(true),
  tileWidth: z.number().int().positive(),
  tileHeight: z.number().int().positive(),
  gridHeight: z.number().int().positive().default(1),
  autotileType: z.enum(['4bit', '8bit']).default('4bit'),
  variants: z.record(z.string(), AutotileVariant),
  scaleFactor: z.number().positive().optional(),
}).strict();

const ConfigSchema = z.object({
  uuid: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  version: z.string().min(1),
  terrain: z.array(TerrainItem).default([]),
  structures: z.array(SpriteItem).default([]),
  objects: z.array(SpriteItem).default([]),
  autotiles: z.array(AutotileItem).default([]),
}).strict();

// Helper functions
function normalizeZipPath(p: string): string {
  const s = p.replace(/\\/g, '/');
  return path.posix.normalize(s);
}

function isUnsafePath(p: string): boolean {
  if (p.startsWith('/') || p.startsWith('\\')) return true;
  if (p.includes('..')) return true;
  if (p.includes(':')) return true;
  return false;
}

function isAllowedAssetExt(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return ext === '.png' || ext === '.webp';
}

function shortHashHex(buf: Buffer, len = 8): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, len);
}

function withoutAssetsPrefix(p: string): string {
  return p.replace(/^assets\//, '');
}

function buildDimensionMaps(cfg: any) {
  const terrainMap = new Map<string, any>();
  const structMap = new Map<string, any>();
  const objMap = new Map<string, any>();
  const autotileMap = new Map<string, any>();
  for (const t of cfg.terrain || []) terrainMap.set(t.id, t);
  for (const s of cfg.structures || []) structMap.set(s.id, s);
  for (const o of cfg.objects || []) objMap.set(o.id, o);
  for (const a of cfg.autotiles || []) autotileMap.set(a.id, a);
  return { terrainMap, structMap, objMap, autotileMap };
}

function dimensionsStable(oldCfg: any, newCfg: any): { ok: true } | { ok: false; reason: string; offendingId?: string } {
  const oldMaps = buildDimensionMaps(oldCfg);
  const newMaps = buildDimensionMaps(newCfg);
  const num = (v: any) => (v == null ? 0 : Number(v));
  for (const [id, oldT] of oldMaps.terrainMap) {
    const n = newMaps.terrainMap.get(id);
    if (!n) continue;
    if (num(oldT.tileWidth) !== num(n.tileWidth) || num(oldT.tileHeight) !== num(n.tileHeight) || num(oldT.margin) !== num(n.margin) || num(oldT.spacing) !== num(n.spacing)) {
      return { ok: false, reason: `terrain dimensions changed: was ${oldT.tileWidth}x${oldT.tileHeight}, now ${n.tileWidth}x${n.tileHeight}`, offendingId: id };
    }
  }
  for (const [id, oldS] of oldMaps.structMap) {
    const n = newMaps.structMap.get(id);
    if (!n) continue;
    if (num(oldS.width) !== num(n.width) || num(oldS.height) !== num(n.height)) {
      return { ok: false, reason: `structure dimensions changed: was ${oldS.width}x${oldS.height}, now ${n.width}x${n.height}`, offendingId: id };
    }
  }
  for (const [id, oldO] of oldMaps.objMap) {
    const n = newMaps.objMap.get(id);
    if (!n) continue;
    if (num(oldO.width) !== num(n.width) || num(oldO.height) !== num(n.height)) {
      return { ok: false, reason: `object dimensions changed: was ${oldO.width}x${oldO.height}, now ${n.width}x${n.height}`, offendingId: id };
    }
  }
  for (const [id, oldA] of oldMaps.autotileMap) {
    const n = newMaps.autotileMap.get(id);
    if (!n) continue;
    if (num(oldA.tileWidth) !== num(n.tileWidth) || num(oldA.tileHeight) !== num(n.tileHeight)) {
      return { ok: false, reason: `autotile dimensions changed: was ${oldA.tileWidth}x${oldA.tileHeight}, now ${n.tileWidth}x${n.tileHeight}`, offendingId: id };
    }
  }
  return { ok: true };
}

async function authenticateAssetPackAdmin(
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
  | { ok: true; configEntry: any; assetEntries: any[] }
  | { ok: false; status: number; error: string };

function scanZipEntries(files: any[]): ZipScanResult {
  const allowedRoot = new Set(['config.json']);
  let configEntry: any = null;
  const assetEntries: any[] = [];

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

function buildAssetSet(assetEntries: any[]): Set<string> {
  const assetSet = new Set<string>();
  for (const e of assetEntries) {
    const p = normalizeZipPath(e.path || e.fileName);
    if (p.endsWith('/')) continue;
    assetSet.add(p);
  }
  return assetSet;
}

type ItemValidationError = { error: string; itemId: any; dataURL: any };

function validateConfigAssetReferences(cfg: any, assetSet: Set<string>): ItemValidationError | null {
  const validateItemPath = (p: string): { ok: true; norm: string } | { ok: false } => {
    const norm = normalizeZipPath(p);
    if (!norm.startsWith('assets/')) return { ok: false };
    if (isUnsafePath(norm)) return { ok: false };
    if (!isAllowedAssetExt(norm)) return { ok: false };
    if (!assetSet.has(norm)) return { ok: false };
    return { ok: true, norm };
  };

  for (const arrName of ['terrain', 'structures', 'objects', 'autotiles'] as const) {
    for (const it of (cfg[arrName] as any[]) || []) {
      const r = validateItemPath(it.dataURL);
      if (!r.ok) return { error: 'missing or invalid asset for item', itemId: it.id, dataURL: it.dataURL };
      if (Array.isArray(it.directionalImages)) {
        for (const di of it.directionalImages) {
          const dr = validateItemPath(di.dataURL);
          if (!dr.ok) return { error: 'missing or invalid asset for directionalImage', itemId: it.id, dataURL: di.dataURL };
        }
      }
    }
  }
  return null;
}

async function extractAssetsToTmpDir(
  assetEntries: any[],
  tmpDir: string,
): Promise<{ ok: true; assetMap: Map<string, string> } | { ok: false; status: number; error: string; path?: string }> {
  const assetMap = new Map<string, string>();
  for (const entry of assetEntries) {
    const p = normalizeZipPath(entry.path || entry.fileName);
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

function rewriteConfig(cfg: any, uuid: string, assetMap: Map<string, string>) {
  const rewriteItem = (it: any) => {
    const original = normalizeZipPath(it.dataURL);
    const mapped = assetMap.get(original);
    if (!mapped) return it;
    const out = { ...it } as any;
    out.originalPath = it.dataURL;
    out.dataURL = `/packs/${uuid}/${mapped}`;
    if (Array.isArray(it.directionalImages)) {
      out.directionalImages = it.directionalImages.map((di: any) => {
        const diOriginal = normalizeZipPath(di.dataURL);
        const diMapped = assetMap.get(diOriginal);
        if (!diMapped) return di;
        return { ...di, dataURL: `/packs/${uuid}/${diMapped}` };
      });
    }
    return out;
  };
  return {
    ...cfg,
    terrain: (cfg.terrain || []).map(rewriteItem),
    structures: (cfg.structures || []).map(rewriteItem),
    objects: (cfg.objects || []).map(rewriteItem),
    autotiles: (cfg.autotiles || []).map(rewriteItem),
  };
}

async function moveTmpToFinal(tmpDir: string, finalDir: string): Promise<void> {
  try { await fsp.rm(finalDir, { recursive: true, force: true }); } catch { }
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
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { }
  }
}

async function persistAssetPackRecord(prisma: PrismaClient, cfg: any, rewritten: any, existing: any) {
  const dataRecord = {
    uuid: cfg.uuid,
    name: cfg.name,
    description: cfg.description,
    author: cfg.author,
    version: cfg.version,
    terrain: rewritten.terrain as any,
    structures: rewritten.structures as any,
    objects: rewritten.objects as any,
    autotiles: rewritten.autotiles as any,
  } as const;

  if (existing) {
    return prisma.assetPack.update({ where: { uuid: cfg.uuid } as any, data: dataRecord as any });
  }
  return prisma.assetPack.create({ data: dataRecord as any });
}

function readUploadedZipBuffer(req: express.Request): { ok: true; buf: Buffer } | { ok: false; status: number; error: string } {
  const file = (req as any).file as any as { buffer?: Buffer; size?: number } | undefined;
  if (!file || !file.buffer || !file.size || file.size <= 0) {
    return { ok: false, status: 400, error: 'file required' };
  }
  const buf = file.buffer as Buffer;
  if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
    return { ok: false, status: 400, error: 'invalid zip' };
  }
  return { ok: true, buf };
}

async function parseUploadedConfig(configEntry: any): Promise<{ ok: true; cfg: any } | { ok: false; status: number; error: string; details?: any }> {
  const configRaw = await configEntry.buffer();
  let configJson: any;
  try { configJson = JSON.parse(configRaw.toString('utf8')); }
  catch { return { ok: false, status: 400, error: 'invalid config.json' }; }

  const parsed = ConfigSchema.safeParse(configJson);
  if (!parsed.success) {
    return { ok: false, status: 400, error: 'invalid config schema', details: parsed.error.errors };
  }
  return { ok: true, cfg: parsed.data as any };
}

async function checkExistingPackDimensions(
  prisma: PrismaClient,
  uuid: string,
  cfg: any,
  tmpDir: string,
): Promise<{ ok: true; existing: any } | { ok: false; status: number; error: string; reason?: any; itemId?: any }> {
  const existing = await prisma.assetPack.findUnique({ where: { uuid } as any });
  if (existing && existing.version !== cfg.version) {
    const check = dimensionsStable({
      terrain: (existing.terrain as any) || [],
      structures: (existing.structures as any) || [],
      objects: (existing.objects as any) || [],
      autotiles: (existing.autotiles as any) || [],
    }, cfg);
    if (!check.ok) {
      try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { }
      return { ok: false, status: 409, error: 'dimension mismatch', reason: (check as any).reason, itemId: (check as any).offendingId };
    }
  }
  return { ok: true, existing };
}

async function handleAssetPackUpload(
  prisma: PrismaClient,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAssetPackAdmin(prisma, req);
  if (!auth.ok) { res.status(auth.status!).json({ error: auth.error! }); return; }
  try {
    try { logger.info('[AssetPacks] upload request received'); } catch { }

    const zipResult = readUploadedZipBuffer(req);
    if (!zipResult.ok) { res.status(zipResult.status).json({ error: zipResult.error }); return; }

    const zip = await unzipper.Open.buffer(zipResult.buf);
    if (!zip || !Array.isArray((zip as any).files)) {
      res.status(400).json({ error: 'invalid zip structure' });
      return;
    }

    const scan = scanZipEntries((zip as any).files as any[]);
    if (!scan.ok) { res.status(scan.status).json({ error: scan.error }); return; }
    const { configEntry, assetEntries } = scan;

    const cfgResult = await parseUploadedConfig(configEntry);
    if (!cfgResult.ok) { res.status(cfgResult.status).json({ error: cfgResult.error, details: cfgResult.details }); return; }
    const cfg = cfgResult.cfg;
    try { logger.info('[AssetPacks] parsed config.json', { uuid: cfg?.uuid, name: cfg?.name, v: cfg?.version, nTerrain: (cfg?.terrain || []).length, nStruct: (cfg?.structures || []).length, nObjects: (cfg?.objects || []).length, nAutotiles: (cfg?.autotiles || []).length }); } catch { }

    const assetSet = buildAssetSet(assetEntries);
    const validationError = validateConfigAssetReferences(cfg, assetSet);
    if (validationError) { res.status(400).json(validationError); return; }

    const uuid = cfg.uuid as string;
    const tmpDir = path.resolve(packsDir, `.tmp-${uuid}-${Date.now()}`);
    await fsp.mkdir(tmpDir, { recursive: true });

    const extracted = await extractAssetsToTmpDir(assetEntries, tmpDir);
    if (!extracted.ok) {
      res.status(extracted.status).json({ error: extracted.error, path: extracted.path });
      return;
    }

    const rewritten = rewriteConfig(cfg, uuid, extracted.assetMap);

    const existCheck = await checkExistingPackDimensions(prisma, uuid, cfg, tmpDir);
    if (!existCheck.ok) {
      res.status(existCheck.status).json({ error: existCheck.error, reason: existCheck.reason, itemId: existCheck.itemId });
      return;
    }

    const finalDir = path.resolve(packsDir, uuid);
    await moveTmpToFinal(tmpDir, finalDir);

    const rec = await persistAssetPackRecord(prisma, cfg, rewritten, existCheck.existing);
    try { logger.info('[AssetPacks] upload success', { id: rec.id, uuid: rec.uuid, version: rec.version }); } catch { }

    res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
  } catch (e: unknown) {
    logger.error('[AssetPacks] upload failed', e);
    res.status(500).json({ error: 'upload failed' });
  }
}

async function handleListAssetPacks(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  const list = await prisma.assetPack.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(list);
}

async function handleGetAssetPack(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const pack = await prisma.assetPack.findUnique({ where: { id } });
  if (!pack) { res.status(404).json({ error: 'not found' }); return; }
  res.json(pack);
}

async function handleDeleteAssetPack(
  prisma: PrismaClient,
  packsDir: string,
  fallbackUrl: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAssetPackAdmin(prisma, req);
  if (!auth.ok) { res.status(auth.status!).json({ error: auth.error! }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const pack = await prisma.assetPack.findUnique({ where: { id } });
  if (!pack) { res.status(404).json({ error: 'not found' }); return; }
  try {
    const dir = path.resolve(packsDir, pack.uuid);
    await fsp.rm(dir, { recursive: true, force: true });
  } catch { }
  await prisma.assetPack.delete({ where: { id } });
  res.json({ ok: true, fallback: fallbackUrl });
}

export function registerAssetPackRoutes(app: express.Application, prisma: PrismaClient) {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');
  try {
    fs.mkdirSync(packsDir, { recursive: true });
  } catch { }
  const FALLBACK_ASSET_URL = process.env.FALLBACK_ASSET_URL || '/packs/__fallback__/missing.png';

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post('/asset-packs/upload', upload.single('file'), (req, res) => handleAssetPackUpload(prisma, packsDir, req, res));
  app.get('/asset-packs', (req, res) => handleListAssetPacks(prisma, req, res));
  app.get('/asset-packs/:id', (req, res) => handleGetAssetPack(prisma, req, res));
  app.delete('/asset-packs/:id', (req, res) => handleDeleteAssetPack(prisma, packsDir, FALLBACK_ASSET_URL, req, res));
}
