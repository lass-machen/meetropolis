import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { logger } from '../../logger.js';
import { requireAuth, requireApiToken } from '../utils/authHelpers.js';

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
  avatars: z.array(z.record(z.unknown())).min(1),
});

async function authenticateMixed(
  req: express.Request,
  prisma: PrismaClient,
): Promise<{ ok: boolean }> {
  const sessionAuth = requireAuth(req);
  const tokenAuth = await requireApiToken(req, prisma);
  return { ok: Boolean(sessionAuth || tokenAuth) };
}

async function handleSpriteUpload(
  prisma: PrismaClient,
  packsDir: string,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = await authenticateMixed(req, prisma);
  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const packUuid = req.body?.packUuid as string | undefined;
    if (!packUuid) {
      res.status(400).json({ error: 'packUuid required' });
      return;
    }

    const file = (req as any).file as { buffer?: Buffer; size?: number } | undefined;
    if (!file || !file.buffer || !file.size || file.size <= 0) {
      res.status(400).json({ error: 'file required' });
      return;
    }

    const buf = file.buffer as Buffer;
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

async function handleListAvatarPacks(prisma: PrismaClient, _req: express.Request, res: express.Response): Promise<void> {
  try {
    const list = await prisma.avatarPack.findMany({ orderBy: { createdAt: 'desc' } });
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
    const pack = await prisma.avatarPack.findUnique({ where: { id } });
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
        avatars: data.avatars as unknown as any,
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
      avatars: data.avatars as unknown as any,
    },
  });
}

async function handleCreateAvatarPack(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = await authenticateMixed(req, prisma);
  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const parsed = AvatarPackCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid body', details: parsed.error.errors });
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
  const auth = await authenticateMixed(req, prisma);
  if (!auth.ok) {
    res.status(401).json({ error: 'unauthorized' });
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

  app.post('/avatar-packs/upload-sprite', upload.single('file'), (req, res) => handleSpriteUpload(prisma, packsDir, req, res));
  app.get('/avatar-packs', (req, res) => handleListAvatarPacks(prisma, req, res));
  app.get('/avatar-packs/:id', (req, res) => handleGetAvatarPack(prisma, req, res));
  app.post('/avatar-packs', (req, res) => handleCreateAvatarPack(prisma, req, res));
  app.delete('/avatar-packs/:id', (req, res) => handleDeleteAvatarPack(prisma, packsDir, req, res));
}
