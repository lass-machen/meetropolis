import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import { requireAuth, requireApiToken, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { logger } from '../../logger.js';

// --- Allowed MIME types and their extensions ---

const ALLOWED_MEDIA: Record<string, string> = {
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

// --- Magic bytes for common formats ---

const MAGIC_BYTES: ReadonlyArray<{ bytes: number[]; mime: string }> = [
  { bytes: [0x52, 0x49, 0x46, 0x46], mime: 'audio/wav' }, // RIFF (WAV)
  { bytes: [0xFF, 0xFB], mime: 'audio/mpeg' }, // MP3 frame sync
  { bytes: [0xFF, 0xF3], mime: 'audio/mpeg' },
  { bytes: [0xFF, 0xF2], mime: 'audio/mpeg' },
  { bytes: [0x49, 0x44, 0x33], mime: 'audio/mpeg' }, // ID3 tag
  { bytes: [0x4F, 0x67, 0x67, 0x53], mime: 'audio/ogg' }, // OGG
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], mime: 'video/webm' }, // WebM/MKV
  { bytes: [0x00, 0x00, 0x00], mime: 'video/mp4' }, // MP4 (ftyp follows)
];

function detectMimeFromMagic(buf: Buffer): string | null {
  for (const { bytes, mime } of MAGIC_BYTES) {
    if (bytes.every((b, i) => buf[i] === b)) return mime;
  }
  return null;
}

function mapMimeToMediaType(mime: string): 'audio' | 'video' | 'screenshare' {
  if (mime.startsWith('video/')) return 'video';
  return 'audio';
}

// --- Auth helpers ---

async function getAuth(req: express.Request, prisma: PrismaClient) {
  return requireAuth(req) || await requireApiToken(req, prisma);
}

async function isAdminOrOwner(req: express.Request, userId: string, prisma: PrismaClient): Promise<boolean> {
  const membership = await requireMembership(req, userId, prisma);
  if (!membership) return false;
  return membership.role === 'admin' || membership.role === 'owner';
}

// --- Multer file type ---

interface MulterFile {
  buffer: Buffer;
  size: number;
  originalname: string;
  mimetype: string;
}

// --- Valid media type overrides ---

const VALID_MEDIA_TYPE_OVERRIDES = ['audio', 'video', 'screenshare'] as const;
type MediaTypeOverride = typeof VALID_MEDIA_TYPE_OVERRIDES[number];

function isValidMediaTypeOverride(value: string): value is MediaTypeOverride {
  return (VALID_MEDIA_TYPE_OVERRIDES as readonly string[]).includes(value);
}

// --- Route handlers ---

async function handleUploadMedia(req: express.Request, res: express.Response, prisma: PrismaClient, npcMediaDir: string) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!await isAdminOrOwner(req, auth.userId, prisma)) return res.status(403).json({ error: 'forbidden' });

  const npc = await prisma.npc.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  const file = (req as unknown as { file?: MulterFile }).file;
  if (!file || !file.buffer || file.size <= 0) return res.status(400).json({ error: 'file_required' });

  // Validate magic bytes
  const detectedMime = detectMimeFromMagic(file.buffer);
  const mime = detectedMime || file.mimetype;
  if (!ALLOWED_MEDIA[mime]) return res.status(400).json({ error: 'unsupported_media_type', detected: mime });

  // Optional override mediaType from query (for screenshare)
  const mediaTypeQuery = req.query.mediaType as string | undefined;
  const mediaType: 'audio' | 'video' | 'screenshare' =
    (mediaTypeQuery && isValidMediaTypeOverride(mediaTypeQuery))
      ? mediaTypeQuery
      : mapMimeToMediaType(mime);

  // Hash + store
  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex').slice(0, 16);
  const ext = ALLOWED_MEDIA[mime] || path.extname(file.originalname).toLowerCase();
  const storagePath = `${tenant.slug}/${npc.id}/${hash}${ext}`;
  const fullPath = path.resolve(npcMediaDir, storagePath);

  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, file.buffer);

  const record = await prisma.npcMediaFile.create({
    data: {
      npcId: npc.id,
      filename: file.originalname,
      storagePath,
      mimeType: mime,
      sizeBytes: file.size,
      mediaType,
    },
  });
  logger.info('[NPC Media] uploaded', { id: record.id, npcId: npc.id, mime, size: file.size });
  res.status(201).json(record);
}

async function handleListMedia(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  const npc = await prisma.npc.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  const files = await prisma.npcMediaFile.findMany({ where: { npcId: npc.id }, orderBy: { createdAt: 'desc' } });
  res.json(files);
}

async function handleDeleteMedia(req: express.Request, res: express.Response, prisma: PrismaClient, npcMediaDir: string) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!await isAdminOrOwner(req, auth.userId, prisma)) return res.status(403).json({ error: 'forbidden' });

  const npc = await prisma.npc.findFirst({ where: { id: req.params.id, tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  const mf = await prisma.npcMediaFile.findFirst({ where: { id: req.params.mediaId, npcId: npc.id } });
  if (!mf) return res.status(404).json({ error: 'media_not_found' });

  // Delete from disk
  try {
    const fullPath = path.resolve(npcMediaDir, mf.storagePath);
    await fsp.rm(fullPath, { force: true });
  } catch { /* ignore */ }

  await prisma.npcMediaFile.delete({ where: { id: mf.id } });
  res.json({ ok: true });
}

// --- Route registration ---

export function registerNpcMediaRoutes(app: express.Application, prisma: PrismaClient) {
  const npcMediaDir = process.env.NPC_MEDIA_DIR || path.resolve(process.cwd(), '../../npc-media');
  try { fs.mkdirSync(npcMediaDir, { recursive: true }); } catch { /* ignore */ }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  });

  app.post('/npcs/:id/media', upload.single('file'), (req, res) => handleUploadMedia(req, res, prisma, npcMediaDir));
  app.get('/npcs/:id/media', (req, res) => handleListMedia(req, res, prisma));
  app.delete('/npcs/:id/media/:mediaId', (req, res) => handleDeleteMedia(req, res, prisma, npcMediaDir));
}
