import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import unzipper from 'unzipper';
import { logger } from '../../logger.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';
import { assetPackScopeWhere } from '../../services/packScope.js';
import type { AssetPackConfig, ZipEntry } from '../../types/assetPack.js';
import {
  authenticateAssetPackAdmin,
  scanZipEntries,
  buildAssetSet,
  validateConfigAssetReferences,
  extractAssetsToTmpDir,
  rewriteConfig,
  moveTmpToFinal,
  persistAssetPackRecord,
  readUploadedZipBuffer,
  parseUploadedConfig,
  checkExistingPackDimensions,
} from './assetPacks.processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PrepareUploadResult =
  | { ok: true; cfg: AssetPackConfig; assetEntries: ZipEntry[] }
  | { ok: false; status: number; body: Record<string, unknown> };

async function prepareUploadFromRequest(req: express.Request): Promise<PrepareUploadResult> {
  const zipResult = readUploadedZipBuffer(req);
  if (!zipResult.ok) {
    return { ok: false, status: zipResult.status, body: { error: zipResult.error } };
  }

  const zip = await unzipper.Open.buffer(zipResult.buf);
  if (!zip || !Array.isArray(zip.files)) {
    return { ok: false, status: 400, body: { error: 'invalid zip structure' } };
  }

  const scan = scanZipEntries(zip.files);
  if (!scan.ok) {
    return { ok: false, status: scan.status, body: { error: scan.error } };
  }
  const { configEntry, assetEntries } = scan;

  const cfgResult = await parseUploadedConfig(configEntry);
  if (!cfgResult.ok) {
    return { ok: false, status: cfgResult.status, body: { error: cfgResult.error, details: cfgResult.details } };
  }
  const cfg = cfgResult.cfg;
  try {
    logger.info('[AssetPacks] parsed config.json', {
      uuid: cfg.uuid,
      name: cfg.name,
      v: cfg.version,
      nTerrain: (cfg.terrain || []).length,
      nStruct: (cfg.structures || []).length,
      nObjects: (cfg.objects || []).length,
      nAutotiles: (cfg.autotiles || []).length,
    });
  } catch {}

  const assetSet = buildAssetSet(assetEntries);
  const validationError = validateConfigAssetReferences(cfg, assetSet);
  if (validationError) {
    return { ok: false, status: 400, body: validationError as unknown as Record<string, unknown> };
  }

  return { ok: true, cfg, assetEntries };
}

async function handleAssetPackUpload(
  prisma: PrismaClient,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAssetPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status!).json({ error: auth.error! });
    return;
  }
  try {
    try {
      logger.info('[AssetPacks] upload request received');
    } catch {}

    const prepared = await prepareUploadFromRequest(req);
    if (!prepared.ok) {
      res.status(prepared.status).json(prepared.body);
      return;
    }
    const { cfg, assetEntries } = prepared;

    const uuid = cfg.uuid;
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
      res
        .status(existCheck.status)
        .json({ error: existCheck.error, reason: existCheck.reason, itemId: existCheck.itemId });
      return;
    }

    const finalDir = path.resolve(packsDir, uuid);
    await moveTmpToFinal(tmpDir, finalDir);

    const rec = await persistAssetPackRecord(prisma, cfg, rewritten, existCheck.existing);
    try {
      logger.info('[AssetPacks] upload success', { id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch {}

    res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
  } catch (e: unknown) {
    logger.error('[AssetPacks] upload failed', e);
    res.status(500).json({ error: 'upload failed' });
  }
}

async function handleListAssetPacks(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const scope = await resolvePackScope(prisma, req);
    const list = await prisma.assetPack.findMany({
      where: assetPackScopeWhere(scope),
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (e) {
    logger.error('[AssetPacks] list failed', e);
    res.status(500).json({ error: 'internal error' });
  }
}

async function handleGetAssetPack(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const scope = await resolvePackScope(prisma, req);
    // findFirst, not findUnique: the scope filter is part of the lookup, so a
    // foreign private pack is never loaded in the first place. A pack that
    // exists but is out of scope answers 404 exactly like a missing one —
    // otherwise the status code alone would confirm the id, letting a caller
    // enumerate other tenants' packs (same non-enumerable posture as
    // GET /avatar-packs/:id).
    const pack = await prisma.assetPack.findFirst({ where: { id, ...assetPackScopeWhere(scope) } });
    if (!pack) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(pack);
  } catch (e) {
    logger.error('[AssetPacks] get failed', e);
    res.status(500).json({ error: 'internal error' });
  }
}

async function handleDeleteAssetPack(
  prisma: PrismaClient,
  packsDir: string,
  fallbackUrl: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAssetPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status!).json({ error: auth.error! });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'invalid id' });
    return;
  }
  const pack = await prisma.assetPack.findUnique({ where: { id } });
  if (!pack) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  try {
    const dir = path.resolve(packsDir, pack.uuid);
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {}
  await prisma.assetPack.delete({ where: { id } });
  res.json({ ok: true, fallback: fallbackUrl });
}

export function registerAssetPackRoutes(app: express.Application, prisma: PrismaClient) {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');
  try {
    fs.mkdirSync(packsDir, { recursive: true });
  } catch {}
  const FALLBACK_ASSET_URL = process.env.FALLBACK_ASSET_URL || '/packs/__fallback__/missing.png';

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  app.post('/asset-packs/upload', upload.single('file'), (req, res) =>
    handleAssetPackUpload(prisma, packsDir, req, res),
  );
  app.get('/asset-packs', (req, res) => handleListAssetPacks(prisma, req, res));
  app.get('/asset-packs/:id', (req, res) => handleGetAssetPack(prisma, req, res));
  app.delete('/asset-packs/:id', (req, res) => handleDeleteAssetPack(prisma, packsDir, FALLBACK_ASSET_URL, req, res));
}
