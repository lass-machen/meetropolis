import type express from 'express';
import { Prisma, PrismaClient } from '../../generated/prisma/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import fsp from 'fs/promises';
import { uploadGuard, uploadParser, boundedMultipart } from '../middleware/uploadPolicy.js';
import unzipper from 'unzipper';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';
import { pathParam } from '../utils/requestHelpers.js';
import { assetPackScopeWhere } from '../../services/packScope.js';
import type { AssetPackConfig, ZipEntry } from '../../types/assetPack.js';
import {
  authenticateAssetPackAdmin,
  scanZipEntries,
  buildAssetSet,
  validateConfigAssetReferences,
  extractAssetsToTmpDir,
  rewriteConfig,
  persistAssetPackRecord,
  readUploadedZipBuffer,
  parseUploadedConfig,
  checkExistingPackDimensions,
  preserveReferencedPackAssets,
  MissingReferencedAssetError,
  ReferencedAssetConflictError,
} from './assetPacks.processor.js';
import {
  createAssetPackGeneration,
  publishAssetPackGeneration,
  type AssetPackGenerationPaths,
} from './assetPackGenerations.js';
import { acquirePackAdvisoryLock } from '../utils/advisoryLocks.js';
import {
  cleanupPackGenerationsAfterCommit,
  packTilesetReferenceWhere,
  removeDeletedPackFilesAfterCommit,
} from './assetPackFilesAfterCommit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type PrepareUploadResult =
  | { ok: true; cfg: AssetPackConfig; assetEntries: ZipEntry[] }
  | { ok: false; status: number; body: Record<string, unknown> };

const archiveAssetPackSchema = z.object({ archived: z.boolean() });

function assetPackIdentityWhere(identifier: string): { id: number } | { uuid: string } {
  const id = Number(identifier);
  return Number.isInteger(id) && id > 0 ? { id } : { uuid: identifier };
}

async function persistUploadedPack(params: {
  prisma: PrismaClient;
  packsDir: string;
  generation: AssetPackGenerationPaths;
  cfg: AssetPackConfig;
  rewritten: ReturnType<typeof rewriteConfig>;
  assetMap: ReadonlyMap<string, string>;
  repairMissingSnapshots: boolean;
  userId: string;
}) {
  const { prisma, packsDir, generation, cfg, rewritten, assetMap, repairMissingSnapshots, userId } = params;
  const tmpDir = generation.tmpDir;
  const packDir = path.resolve(packsDir, cfg.uuid);
  const repairSources = new Map<string, string>();
  for (const [original, hashed] of assetMap) {
    repairSources.set(original.replace(/^assets\//, ''), path.resolve(tmpDir, hashed));
  }
  const record = await prisma.$transaction(
    async (tx) => {
      await acquirePackAdvisoryLock(tx, cfg.uuid);
      const existCheck = await checkExistingPackDimensions(tx, cfg.uuid, cfg, tmpDir);
      if (!existCheck.ok) {
        throw new UploadValidationError(existCheck.status, {
          error: existCheck.error,
          reason: existCheck.reason,
          itemId: existCheck.itemId,
        });
      }
      await preserveReferencedPackAssets(tx, cfg.uuid, packDir, tmpDir, {
        retainInPlace: true,
        repairMissing: repairMissingSnapshots,
        repairSources,
        onRepair: ({ url, source }) =>
          logger.warn({ event: 'asset_pack.snapshot_repaired', uuid: cfg.uuid, url, source, repairedBy: userId }),
      });
      await publishAssetPackGeneration(generation);
      return persistAssetPackRecord(tx, cfg, rewritten, existCheck.existing, generation.id);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  await cleanupPackGenerationsAfterCommit(prisma, packsDir, cfg.uuid).catch((error: unknown) =>
    logger.warn({ event: 'asset_pack.generation_cleanup_failed', uuid: cfg.uuid, error: String(error) }),
  );
  return record;
}

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
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  let generation: AssetPackGenerationPaths | undefined;
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
    generation = await createAssetPackGeneration(packsDir, uuid);
    const tmpDir = generation.tmpDir;

    const extracted = await extractAssetsToTmpDir(assetEntries, tmpDir);
    if (!extracted.ok) {
      res.status(extracted.status).json({ error: extracted.error, path: extracted.path });
      return;
    }

    const rewritten = rewriteConfig(cfg, uuid, extracted.assetMap, generation.id);

    const uploadFields = req.body as { repairMissingSnapshots?: unknown } | undefined;
    const repairMissingSnapshots = uploadFields?.repairMissingSnapshots === 'true';
    const rec = await persistUploadedPack({
      prisma,
      packsDir,
      generation,
      cfg,
      rewritten,
      assetMap: extracted.assetMap,
      repairMissingSnapshots,
      userId: auth.userId,
    });
    try {
      logger.info('[AssetPacks] upload success', { id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch {}

    res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
  } catch (e: unknown) {
    if (e instanceof UploadValidationError) {
      res.status(e.status).json(e.body);
      return;
    }
    if (e instanceof ReferencedAssetConflictError) {
      res.status(409).json({ error: 'referenced_asset_conflict', url: e.url });
      return;
    }
    if (e instanceof MissingReferencedAssetError) {
      res.status(409).json({
        error: 'snapshot_repair_required',
        url: e.url,
        message: "Retry with multipart field 'repairMissingSnapshots=true' to perform an audited repair.",
      });
      return;
    }
    logger.error('[AssetPacks] upload failed', e);
    res.status(500).json({ error: 'upload failed' });
  } finally {
    // Only our own generation tmp dir may go here — never the pack root, a
    // published generation, or a legacy directory. After a successful publish
    // the tmp path is already gone, so this is a no-op on the happy path. A
    // transaction failure after publish can leave the published generation
    // unreferenced on disk; the next successful upload of the pack removes it.
    const ownTmp = generation?.tmpDir;
    if (ownTmp && path.basename(ownTmp).startsWith('.tmp-')) {
      await fsp.rm(ownTmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

class UploadValidationError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === 'string' ? body.error : 'upload validation failed');
  }
}

async function handleListAssetPacks(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const scope = await resolvePackScope(prisma, req, 'asset');
    const list = await prisma.assetPack.findMany({
      where: { ...assetPackScopeWhere(scope), archived: false },
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
    const identifier = pathParam(req, 'id');
    if (!identifier) {
      res.status(400).json({ error: 'invalid identifier' });
      return;
    }
    const scope = await resolvePackScope(prisma, req, 'asset');
    // findFirst, not findUnique: the scope filter is part of the lookup, so a
    // foreign private pack is never loaded in the first place. A pack that
    // exists but is out of scope answers 404 exactly like a missing one —
    // otherwise the status code alone would confirm the id, letting a caller
    // enumerate other tenants' packs (same non-enumerable posture as
    // GET /avatar-packs/:id).
    const pack = await prisma.assetPack.findFirst({
      where: { ...assetPackIdentityWhere(identifier), ...assetPackScopeWhere(scope) },
    });
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

async function handleArchiveAssetPack(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAssetPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const parsed = archiveAssetPackSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid payload', details: parsed.error.issues });
    return;
  }
  const identifier = pathParam(req, 'id');
  if (!identifier) {
    res.status(400).json({ error: 'invalid identifier' });
    return;
  }
  const pack = await prisma.assetPack.findFirst({
    where: assetPackIdentityWhere(identifier),
    select: { id: true, uuid: true },
  });
  if (!pack) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await acquirePackAdvisoryLock(tx, pack.uuid);
      const current = await tx.assetPack.findUnique({ where: { id: pack.id } });
      if (!current) return null;
      return tx.assetPack.update({
        where: { id: pack.id },
        data: { archived: parsed.data.archived },
      });
    });
    if (!updated) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(updated);
  } catch (e) {
    logger.error('[AssetPacks] archive failed', e);
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
    res.status(auth.status).json({ error: auth.error });
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
  const deletion = await prisma.$transaction(async (tx) => {
    await acquirePackAdvisoryLock(tx, pack.uuid);
    const current = await tx.assetPack.findUnique({ where: { id } });
    if (!current) return { status: 'missing' as const };
    const [autotileReferences, objectReferences, tilesetReferences] = await Promise.all([
      tx.mapAutotile.count({ where: { packUuid: current.uuid } }),
      tx.mapObject.count({ where: { assetPackUuid: current.uuid } }),
      tx.mapTileset.count({ where: packTilesetReferenceWhere(current.uuid) }),
    ]);
    if (autotileReferences > 0 || objectReferences > 0 || tilesetReferences > 0) {
      return { status: 'referenced' as const, autotileReferences, objectReferences, tilesetReferences };
    }
    await tx.assetPack.delete({ where: { id } });
    return { status: 'deleted' as const, uuid: current.uuid };
  });
  if (deletion.status === 'missing') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (deletion.status === 'referenced') {
    res.status(409).json({
      error: 'asset_pack_in_use',
      message: 'This pack is referenced by maps. Archive it instead of deleting it.',
      references: {
        autotiles: deletion.autotileReferences,
        objects: deletion.objectReferences,
        tilesets: deletion.tilesetReferences,
      },
    });
    return;
  }
  await removeDeletedPackFilesAfterCommit(prisma, packsDir, deletion.uuid).catch((error: unknown) =>
    logger.warn({ event: 'asset_pack.file_removal_failed', uuid: deletion.uuid, error: String(error) }),
  );
  res.json({ ok: true, fallback: fallbackUrl });
}

export function registerAssetPackRoutes(app: express.Application, prisma: PrismaClient) {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');
  try {
    fs.mkdirSync(packsDir, { recursive: true });
  } catch {}
  const FALLBACK_ASSET_URL = process.env.FALLBACK_ASSET_URL || '/packs/__fallback__/missing.png';

  const upload = uploadParser('asset');

  app.post('/asset-packs/upload', uploadGuard(prisma, 'asset'), boundedMultipart(upload.single('file')), (req, res) =>
    handleAssetPackUpload(prisma, packsDir, req, res),
  );
  app.get('/asset-packs', (req, res) => handleListAssetPacks(prisma, req, res));
  app.get('/asset-packs/:id', (req, res) => handleGetAssetPack(prisma, req, res));
  app.patch('/asset-packs/:id/archive', (req, res) => handleArchiveAssetPack(prisma, req, res));
  app.delete('/asset-packs/:id', (req, res) => handleDeleteAssetPack(prisma, packsDir, FALLBACK_ASSET_URL, req, res));
}
