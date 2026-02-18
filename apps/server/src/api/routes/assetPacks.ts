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
import { requireAuth, requireApiToken, getTenantFromReq, requireInternalOwner } from '../utils/authHelpers.js';
import { parseMajorVersion } from '../utils/packAccess.js';

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
  for (const [id, oldT] of oldMaps.terrainMap) {
    const n = newMaps.terrainMap.get(id);
    if (!n) continue;
    if (oldT.tileWidth !== n.tileWidth || oldT.tileHeight !== n.tileHeight || (oldT.margin ?? 0) !== (n.margin ?? 0) || (oldT.spacing ?? 0) !== (n.spacing ?? 0)) {
      return { ok: false, reason: 'terrain dimensions changed', offendingId: id };
    }
  }
  for (const [id, oldS] of oldMaps.structMap) {
    const n = newMaps.structMap.get(id);
    if (!n) continue;
    if (oldS.width !== n.width || oldS.height !== n.height) {
      return { ok: false, reason: 'structure sprite dimensions changed', offendingId: id };
    }
  }
  for (const [id, oldO] of oldMaps.objMap) {
    const n = newMaps.objMap.get(id);
    if (!n) continue;
    if (oldO.width !== n.width || oldO.height !== n.height) {
      return { ok: false, reason: 'object sprite dimensions changed', offendingId: id };
    }
  }
  for (const [id, oldA] of oldMaps.autotileMap) {
    const n = newMaps.autotileMap.get(id);
    if (!n) continue;
    if (oldA.tileWidth !== n.tileWidth || oldA.tileHeight !== n.tileHeight) {
      return { ok: false, reason: 'autotile dimensions changed', offendingId: id };
    }
  }
  return { ok: true };
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

  // Upload endpoint (platform admin only)
  app.post('/asset-packs/upload', upload.single('file'), async (req, res) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const isAdmin = await requireInternalOwner(req, auth.userId, prisma);
    if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    try {
      try { logger.info('[AssetPacks] upload request received'); } catch { }
      const file = (req as any).file as any as { buffer?: Buffer; size?: number } | undefined;
      if (!file || !file.buffer || !file.size || file.size <= 0) {
        return res.status(400).json({ error: 'file required' });
      }
      const buf = file.buffer as Buffer;
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) {
        return res.status(400).json({ error: 'invalid zip' });
      }

      const zip = await unzipper.Open.buffer(buf);
      if (!zip || !Array.isArray((zip as any).files)) {
        return res.status(400).json({ error: 'invalid zip structure' });
      }

      const files = (zip as any).files as Array<any>;
      const allowedRoot = new Set(['config.json']);
      let configEntry: any = null;
      const assetEntries: Array<any> = [];

      for (const entry of files) {
        const rawPath: string = entry.path || entry.fileName || '';
        const norm = normalizeZipPath(rawPath);
        if (isUnsafePath(norm)) {
          return res.status(400).json({ error: 'unsafe entry path' });
        }
        if (norm === 'config.json') {
          configEntry = entry;
          continue;
        }
        if (norm.startsWith('assets/')) {
          if (entry.type && entry.type !== 'File' && entry.type !== 'Directory') {
            return res.status(400).json({ error: 'unsupported zip entry type' });
          }
          assetEntries.push(entry);
          continue;
        }
        if (norm !== '' && !allowedRoot.has(norm)) {
          return res.status(400).json({ error: 'invalid zip entries' });
        }
      }

      if (!configEntry) {
        return res.status(400).json({ error: 'config.json missing' });
      }

      const configRaw = await configEntry.buffer();
      let configJson: any;
      try {
        configJson = JSON.parse(configRaw.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'invalid config.json' });
      }

      const parsed = ConfigSchema.safeParse(configJson);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid config schema', details: parsed.error.errors });
      }
      const cfg = parsed.data as any;
      try { logger.info('[AssetPacks] parsed config.json', { uuid: cfg?.uuid, name: cfg?.name, v: cfg?.version, nTerrain: (cfg?.terrain || []).length, nStruct: (cfg?.structures || []).length, nObjects: (cfg?.objects || []).length, nAutotiles: (cfg?.autotiles || []).length }); } catch { }

      const assetSet = new Set<string>();
      for (const e of assetEntries) {
        const p = normalizeZipPath(e.path || e.fileName);
        if (p.endsWith('/')) continue;
        assetSet.add(p);
      }

      function validateItemPath(p: string): { ok: true; norm: string } | { ok: false } {
        const norm = normalizeZipPath(p);
        if (!norm.startsWith('assets/')) return { ok: false };
        if (isUnsafePath(norm)) return { ok: false };
        if (!isAllowedAssetExt(norm)) return { ok: false };
        if (!assetSet.has(norm)) return { ok: false };
        return { ok: true, norm };
      }

      const referenced: string[] = [];
      for (const arrName of ['terrain', 'structures', 'objects', 'autotiles'] as const) {
        for (const it of (cfg[arrName] as any[]) || []) {
          const r = validateItemPath(it.dataURL);
          if (!r.ok) {
            return res.status(400).json({ error: 'missing or invalid asset for item', itemId: it.id, dataURL: it.dataURL });
          }
          referenced.push(r.norm);
          if (Array.isArray(it.directionalImages)) {
            for (const di of it.directionalImages) {
              const dr = validateItemPath(di.dataURL);
              if (!dr.ok) {
                return res.status(400).json({ error: 'missing or invalid asset for directionalImage', itemId: it.id, dataURL: di.dataURL });
              }
              referenced.push(dr.norm);
            }
          }
        }
      }

      const uuid = cfg.uuid as string;
      const tmpDir = path.resolve(packsDir, `.tmp-${uuid}-${Date.now()}`);
      await fsp.mkdir(tmpDir, { recursive: true });

      const assetMap = new Map<string, string>();
      for (const entry of assetEntries) {
        const p = normalizeZipPath(entry.path || entry.fileName);
        if (p.endsWith('/')) continue;
        if (!isAllowedAssetExt(p)) {
          return res.status(400).json({ error: 'unsupported asset extension', path: p });
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
      const rewritten = {
        ...cfg,
        terrain: (cfg.terrain || []).map(rewriteItem),
        structures: (cfg.structures || []).map(rewriteItem),
        objects: (cfg.objects || []).map(rewriteItem),
        autotiles: (cfg.autotiles || []).map(rewriteItem),
      };

      const existing = await prisma.assetPack.findUnique({ where: { uuid: uuid } as any });
      if (existing) {
        if (existing.version !== cfg.version) {
          const check = dimensionsStable({
            terrain: (existing.terrain as any) || [],
            structures: (existing.structures as any) || [],
            objects: (existing.objects as any) || [],
            autotiles: (existing.autotiles as any) || [],
          }, cfg);
          if (!check.ok) {
            try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { }
            return res.status(409).json({ error: 'dimension mismatch', reason: (check as any).reason, itemId: (check as any).offendingId });
          }
        }
      }

      const finalDir = path.resolve(packsDir, uuid);
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

      let rec;
      if (existing) {
        rec = await prisma.assetPack.update({ where: { uuid: cfg.uuid } as any, data: dataRecord as any });
      } else {
        rec = await prisma.assetPack.create({ data: dataRecord as any });
      }
      try { logger.info('[AssetPacks] upload success', { id: rec.id, uuid: rec.uuid, version: rec.version }); } catch { }

      // Auto-grant if this is a free, published pack
      try {
        const catalog = await prisma.assetPackCatalog.findUnique({ where: { assetPackId: rec.id } });
        if (catalog && catalog.pricingModel === 'free' && catalog.published) {
          const tenants = await prisma.tenant.findMany({ select: { id: true } });
          for (const t of tenants) {
            await prisma.tenantAssetPack.upsert({
              where: { tenantId_assetPackId: { tenantId: t.id, assetPackId: rec.id } },
              update: { purchasedMajorVersion: parseMajorVersion(rec.version) },
              create: {
                tenantId: t.id,
                assetPackId: rec.id,
                grantSource: 'free',
                purchasedMajorVersion: parseMajorVersion(rec.version),
              },
            });
          }
          logger.info('[AssetPacks] free pack auto-granted', { uuid: rec.uuid, tenantCount: tenants.length });
        }
      } catch (grantErr) {
        logger.error('[AssetPacks] auto-grant failed (non-fatal)', grantErr);
      }

      return res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch (e: unknown) {
      logger.error('[AssetPacks] upload failed', e);
      return res.status(500).json({ error: 'upload failed' });
    }
  });

  // List (tenant-scoped if tenant context exists)
  app.get('/asset-packs', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (tenant) {
      const now = new Date();
      const accessRecords = await prisma.tenantAssetPack.findMany({
        where: {
          tenantId: tenant.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { assetPack: true },
      });
      const list = accessRecords
        .filter(a => a.purchasedMajorVersion >= parseMajorVersion(a.assetPack.version))
        .map(a => a.assetPack);
      return res.json(list);
    }
    // No tenant context (admin/API) — return all
    const list = await prisma.assetPack.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(list);
  });

  // Get by id
  app.get('/asset-packs/:id', async (req: express.Request, res: express.Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const pack = await prisma.assetPack.findUnique({ where: { id } });
    if (!pack) return res.status(404).json({ error: 'not found' });
    res.json(pack);
  });

  // Delete (platform admin only)
  app.delete('/asset-packs/:id', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const isAdmin = await requireInternalOwner(req, auth.userId, prisma);
    if (!isAdmin) return res.status(403).json({ error: 'forbidden' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const pack = await prisma.assetPack.findUnique({ where: { id } });
    if (!pack) return res.status(404).json({ error: 'not found' });
    try {
      const dir = path.resolve(packsDir, pack.uuid);
      await fsp.rm(dir, { recursive: true, force: true });
    } catch { }
    await prisma.assetPack.delete({ where: { id } });
    res.json({ ok: true, fallback: FALLBACK_ASSET_URL });
  });
}
