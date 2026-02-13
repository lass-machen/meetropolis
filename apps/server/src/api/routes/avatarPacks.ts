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

export function registerAvatarPackRoutes(app: express.Application, prisma: PrismaClient) {
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../../../public/packs');

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // Upload sprite image for an avatar pack (auth required)
  app.post('/avatar-packs/upload-sprite', upload.single('file'), async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const packUuid = req.body?.packUuid as string | undefined;
      if (!packUuid) {
        return res.status(400).json({ error: 'packUuid required' });
      }

      const file = (req as any).file as { buffer?: Buffer; size?: number } | undefined;
      if (!file || !file.buffer || !file.size || file.size <= 0) {
        return res.status(400).json({ error: 'file required' });
      }

      const buf = file.buffer as Buffer;
      // Validate PNG magic bytes
      if (buf.length < 4 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
        return res.status(400).json({ error: 'invalid png' });
      }

      const hash = shortHashHex(buf);
      const destDir = path.resolve(packsDir, 'avatars', packUuid);
      await fs.promises.mkdir(destDir, { recursive: true });

      const filename = `${hash}.png`;
      const destPath = path.resolve(destDir, filename);
      await fs.promises.writeFile(destPath, buf);

      const url = `/packs/avatars/${packUuid}/${filename}`;
      logger.info('[AvatarPacks] sprite upload success', { packUuid, url });
      return res.json({ ok: true, url });
    } catch (e) {
      logger.error('[AvatarPacks] sprite upload failed', e);
      return res.status(500).json({ error: 'upload failed' });
    }
  });

  // List all avatar packs (public)
  app.get('/avatar-packs', async (_req: express.Request, res: express.Response) => {
    try {
      const list = await prisma.avatarPack.findMany({ orderBy: { createdAt: 'desc' } });
      res.json(list);
    } catch (e) {
      logger.error('[AvatarPacks] list failed', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Get single avatar pack by id (public)
  app.get('/avatar-packs/:id', async (req: express.Request, res: express.Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const pack = await prisma.avatarPack.findUnique({ where: { id } });
      if (!pack) return res.status(404).json({ error: 'not found' });
      res.json(pack);
    } catch (e) {
      logger.error('[AvatarPacks] get failed', e);
      res.status(500).json({ error: 'internal error' });
    }
  });

  // Create avatar pack (auth required)
  app.post('/avatar-packs', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const parsed = AvatarPackCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'invalid body', details: parsed.error.errors });
      }
      const data = parsed.data;

      const existing = await prisma.avatarPack.findUnique({ where: { uuid: data.uuid } });
      let rec;
      if (existing) {
        rec = await prisma.avatarPack.update({
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
      } else {
        rec = await prisma.avatarPack.create({
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

      logger.info('[AvatarPacks] upsert success', { id: rec.id, uuid: rec.uuid });
      res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch (e) {
      logger.error('[AvatarPacks] create failed', e);
      res.status(500).json({ error: 'create failed' });
    }
  });

  // Delete avatar pack (auth required)
  app.delete('/avatar-packs/:id', async (req: express.Request, res: express.Response) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req, prisma);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
      const pack = await prisma.avatarPack.findUnique({ where: { id } });
      if (!pack) return res.status(404).json({ error: 'not found' });

      const packUuid = pack.uuid;
      await prisma.avatarPack.delete({ where: { id } });

      // Cascade: remove sprite directory for this pack
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
  });
}
