import type express from 'express';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logger } from '../../logger.js';
import { requireAuth, requireApiToken, requireInternalOwner } from '../utils/authHelpers.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';
import { avatarPackScopeWhere } from '../../services/packScope.js';
import type { RequestWithMulterFile } from '../../types/multer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function shortHashHex(buf: Buffer, len = 8): string {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, len);
}

const AvatarPackCreateSchema = z.object({
  uuid: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  author: z.string().min(1),
  version: z.string().min(1),
  type: z.string().default('full'),
  avatars: z.array(z.record(z.string(), z.unknown())).min(1),
});

type AvatarPackAuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Authorise a write to the global AvatarPack registry (create, delete, sprite
 * upload).
 *
 * Every pack these routes write is a catalogue pack: `AvatarPack.tenantId` stays
 * NULL (neither branch of `upsertAvatarPack` sets it), and a NULL-owner pack is
 * visible in EVERY tenant's avatar selection. Write access is therefore
 * restricted to a platform super-admin (owner of the internal tenant),
 * mirroring the twin global AssetPack registry (see assetPacks.processor.ts
 * `authenticateAssetPackAdmin`). The tenant-scoped admin/owner check used for
 * per-tenant resources such as NPCs (npcs.ts `isAdminOrOwner`) is deliberately
 * NOT used here: it would let any tenant's owner mutate a resource shared by all
 * tenants — a cross-tenant privilege escalation.
 *
 * Packs that carry a `tenantId` (private, tenant-owned) are read-only over this
 * API — they are assigned operationally, never through these routes — so the
 * super-admin gate remains the complete write authority.
 *
 * Authentication resolves via a session cookie/JWT or an API token; either path
 * yields a userId that must then hold the internal-owner role. API tokens are
 * thus not blanket-privileged — they inherit exactly their owning user's
 * authority, consistent with the AssetPack and NPC route guards.
 */
async function authenticateAvatarPackAdmin(prisma: PrismaClient, req: express.Request): Promise<AvatarPackAuthResult> {
  const sessionAuth = requireAuth(req);
  const tokenAuth = await requireApiToken(req, prisma);
  const auth = sessionAuth || tokenAuth;
  if (!auth) return { ok: false, status: 401, error: 'unauthorized' };
  const isAdmin = await requireInternalOwner(req, auth.userId, prisma);
  if (!isAdmin) return { ok: false, status: 403, error: 'forbidden' };
  return { ok: true };
}

async function handleSpriteUpload(
  prisma: PrismaClient,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAvatarPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  try {
    const body = (req.body ?? {}) as { packUuid?: unknown };
    const packUuid = typeof body.packUuid === 'string' ? body.packUuid : undefined;
    if (!packUuid) {
      res.status(400).json({ error: 'packUuid required' });
      return;
    }
    // packUuid is used to build the on-disk destination directory. Restrict it
    // to a safe charset so a value like `../../etc` cannot escape packsDir via
    // path.resolve (path-traversal). Pack uuids/keys are alphanumeric with
    // dashes/underscores.
    if (!/^[a-zA-Z0-9_-]+$/.test(packUuid)) {
      res.status(400).json({ error: 'invalid packUuid' });
      return;
    }

    const file = (req as express.Request & RequestWithMulterFile).file;
    if (!file || !file.buffer || !file.size || file.size <= 0) {
      res.status(400).json({ error: 'file required' });
      return;
    }

    const buf = file.buffer;
    if (buf.length < 4 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      res.status(400).json({ error: 'invalid png' });
      return;
    }

    const hash = shortHashHex(buf);
    const destDir = path.resolve(packsDir, 'avatars', packUuid);
    await fs.promises.mkdir(destDir, { recursive: true });

    const filename = `${hash}.png`;
    const destPath = path.resolve(destDir, filename);
    await fs.promises.writeFile(destPath, buf);

    const url = `/packs/avatars/${packUuid}/${filename}`;
    logger.info('[AvatarPacks] sprite upload success', { packUuid, url });
    res.json({ ok: true, url });
  } catch (e) {
    logger.error('[AvatarPacks] sprite upload failed', e);
    res.status(500).json({ error: 'upload failed' });
  }
}

async function handleListAvatarPacks(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  try {
    const scope = await resolvePackScope(prisma, req);
    const list = await prisma.avatarPack.findMany({
      where: avatarPackScopeWhere(scope),
      orderBy: { createdAt: 'desc' },
    });
    res.json(list);
  } catch (e) {
    logger.error('[AvatarPacks] list failed', e);
    res.status(500).json({ error: 'internal error' });
  }
}

async function handleGetAvatarPack(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
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
    // authHelpers.ts `createRequireTenantAdmin`).
    const pack = await prisma.avatarPack.findFirst({ where: { id, ...avatarPackScopeWhere(scope) } });
    if (!pack) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(pack);
  } catch (e) {
    logger.error('[AvatarPacks] get failed', e);
    res.status(500).json({ error: 'internal error' });
  }
}

async function upsertAvatarPack(prisma: PrismaClient, data: z.infer<typeof AvatarPackCreateSchema>) {
  const existing = await prisma.avatarPack.findUnique({ where: { uuid: data.uuid } });
  if (existing) {
    return prisma.avatarPack.update({
      where: { uuid: data.uuid },
      data: {
        name: data.name,
        description: data.description,
        author: data.author,
        version: data.version,
        type: data.type,
        avatars: data.avatars as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.avatarPack.create({
    data: {
      uuid: data.uuid,
      name: data.name,
      description: data.description,
      author: data.author,
      version: data.version,
      type: data.type,
      avatars: data.avatars as Prisma.InputJsonValue,
    },
  });
}

async function handleCreateAvatarPack(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAvatarPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  try {
    const parsed = AvatarPackCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid body', details: parsed.error.issues });
      return;
    }
    const rec = await upsertAvatarPack(prisma, parsed.data);
    logger.info('[AvatarPacks] upsert success', { id: rec.id, uuid: rec.uuid });
    res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
  } catch (e) {
    logger.error('[AvatarPacks] create failed', e);
    res.status(500).json({ error: 'create failed' });
  }
}

async function handleDeleteAvatarPack(
  prisma: PrismaClient,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateAvatarPackAdmin(prisma, req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const pack = await prisma.avatarPack.findUnique({ where: { id } });
    if (!pack) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const packUuid = pack.uuid;
    await prisma.avatarPack.delete({ where: { id } });

    try {
      const dir = path.resolve(packsDir, 'avatars', packUuid);
      await fs.promises.rm(dir, { recursive: true, force: true });
      logger.info('[AvatarPacks] cleaned up sprite directory', { packUuid, dir });
    } catch (cleanupErr) {
      logger.warn('[AvatarPacks] sprite directory cleanup failed (non-fatal)', { packUuid, error: cleanupErr });
    }

    res.json({ ok: true });
  } catch (e) {
    logger.error('[AvatarPacks] delete failed', e);
    res.status(500).json({ error: 'delete failed' });
  }
}

export function registerAvatarPackRoutes(app: express.Application, prisma: PrismaClient) {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  app.post('/avatar-packs/upload-sprite', upload.single('file'), (req, res) =>
    handleSpriteUpload(prisma, packsDir, req, res),
  );
  app.get('/avatar-packs', (req, res) => handleListAvatarPacks(prisma, req, res));
  app.get('/avatar-packs/:id', (req, res) => handleGetAvatarPack(prisma, req, res));
  app.post('/avatar-packs', (req, res) => handleCreateAvatarPack(prisma, req, res));
  app.delete('/avatar-packs/:id', (req, res) => handleDeleteAvatarPack(prisma, packsDir, req, res));
}
