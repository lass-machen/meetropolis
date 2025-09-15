import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { createLivekitToken } from './livekit.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { logger } from './logger.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import unzipper from 'unzipper';

const prisma = new PrismaClient();
const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET fehlt in Produktion');
  }
  // Development: ephemeres Secret, nur für lokale Sessions
  const devSecret = crypto.randomBytes(32).toString('hex');
  logger.warn('[SECURITY] JWT_SECRET fehlt – verwende ephemeres DEV-Secret.');
  return devSecret;
})();
const COOKIE_NAME = 'auth_token';
const API_TOKEN_PEPPER = (() => {
  const fromEnv = process.env.API_TOKEN_PEPPER;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] API_TOKEN_PEPPER fehlt in Produktion');
  }
  const devPepper = crypto.randomBytes(32).toString('hex');
  logger.warn('[SECURITY] API_TOKEN_PEPPER fehlt – verwende ephemeres DEV-Pepper. Tokens verlieren Gültigkeit bei Neustart.');
  return devPepper;
})();

function setAuthCookie(res: express.Response, token: string) {
  const forceSecure = process.env.COOKIE_SECURE === 'true';
  const secure = forceSecure || false;
  const sameSite = secure ? 'none' : 'lax';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: sameSite as any,
    secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
}

function requireAuth(req: express.Request): { userId: string } | null {
  const raw = (req as any).cookies?.[COOKIE_NAME] || req.headers['authorization']?.toString()?.replace('Bearer ', '');
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, JWT_SECRET) as any;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

async function requireApiToken(req: express.Request): Promise<{ userId: string } | null> {
  const authz = req.headers['authorization']?.toString();
  if (!authz || !authz.startsWith('Bearer ')) return null;
  const token = authz.slice('Bearer '.length).trim();
  if (!token || token.split('.').length === 3) {
    // Sieht nach JWT aus → nicht als API-Token behandeln
    return null;
  }
  const hash = crypto.createHash('sha256').update(API_TOKEN_PEPPER + token).digest('hex');
  const found = await prisma.apiToken.findUnique({ where: { hash } });
  if (!found) return null;
  await prisma.apiToken.update({ where: { hash }, data: { lastUsedAt: new Date() } });
  return { userId: found.userId };
}

export function registerApi(app: express.Express) {
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Auth Endpoints
  app.post('/auth/invite', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ email: z.string().email() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email required' });
    const code = crypto.randomBytes(12).toString('hex');
    const inv = await prisma.invite.create({ data: { code, email: parse.data.email, createdBy: auth.userId } });
    res.json({ code: inv.code });
  });

  app.post('/auth/register', async (req, res) => {
    const schema = z.object({ code: z.string().min(4), name: z.string().min(1).optional(), email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'code, email, password required' });
    const { code, name, email, password } = parse.data;
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite || invite.usedAt) return res.status(400).json({ error: 'invalid or used invite' });
    // Enforce invite email if present
    if (invite.email && invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'invite does not match email' });
    }
    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await prisma.user.create({ data: { email, name, passwordHash: hash, emailVerifiedAt: new Date() } });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      return res.status(400).json({ error: 'registration failed' });
    }
    await prisma.invite.update({ where: { code }, data: { usedAt: new Date(), usedById: user.id } });
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    setAuthCookie(res, token);
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/login', async (req, res) => {
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email and password required' });
    const { email, password } = parse.data;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
    setAuthCookie(res, token);
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/logout', async (_req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/auth/me', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const user = await prisma.user.findUnique({ 
      where: { id: auth.userId },
      include: {
        presences: {
          orderBy: { updatedAt: 'desc' },
          take: 1
        }
      }
    });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const lastPosition = user.presences[0];
    res.json({ 
      id: user.id, 
      email: user.email, 
      name: user.name,
      lastPosition: lastPosition ? { x: lastPosition.x, y: lastPosition.y, direction: lastPosition.direction } : null
    });
  });

  // Save user position
  app.post('/auth/position', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ 
      x: z.number(), 
      y: z.number(), 
      direction: z.enum(['up', 'down', 'left', 'right']),
      roomId: z.string().optional()
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid position data' });
    
    const { x, y, direction, roomId = 'world' } = parse.data;
    
    // Get or create the default room
    let room = await prisma.room.findFirst({ where: { name: roomId } });
    if (!room) {
      // Create default map and room if not exists
      let map = await prisma.map.findFirst({ where: { name: 'office' } });
      if (!map) {
        map = await prisma.map.create({ data: { name: 'office', meta: {} } });
      }
      room = await prisma.room.create({ data: { name: roomId, mapId: map.id } });
    }
    
    // Update or create presence
    // First try to find existing presence
    const existingPresence = await prisma.presence.findFirst({
      where: {
        userId: auth.userId,
        roomId: room.id
      }
    });
    
    if (existingPresence) {
      await prisma.presence.update({
        where: { id: existingPresence.id },
        data: { x, y, direction }
      });
    } else {
      await prisma.presence.create({
        data: { userId: auth.userId, roomId: room.id, x, y, direction }
      });
    }
    
    res.json({ ok: true });
  });

  app.post('/auth/forgot', async (req, res) => {
    const schema = z.object({ email: z.string().email() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email required' });
    const email = parse.data.email;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });
    // In real app: send email with URL containing token
    res.json({ ok: true, token });
  });

  app.post('/auth/reset', async (req, res) => {
    const schema = z.object({ token: z.string().min(8), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'token and password required' });
    const { token, password } = parse.data;
    const pr = await prisma.passwordReset.findUnique({ where: { token } });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) return res.status(400).json({ error: 'invalid token' });
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: pr.userId }, data: { passwordHash: hash } });
    await prisma.passwordReset.update({ where: { token }, data: { usedAt: new Date() } });
    res.json({ ok: true });
  });

  // Change password (authenticated)
  app.post('/auth/change', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ currentPassword: z.string().min(8), newPassword: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'currentPassword and newPassword required' });
    const { currentPassword, newPassword } = parse.data;
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user || !user.passwordHash) return res.status(400).json({ error: 'no password set' });
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid current password' });
    const hash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
    res.json({ ok: true });
  });

  // Basic User Management (requires authentication)
  app.get('/users', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, createdAt: true, updatedAt: true }
    });
    res.json(users);
  });

  app.patch('/users/:id', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    const schema = z.object({ email: z.string().email().optional(), name: z.string().min(1).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success || (!parse.data.email && !parse.data.name)) return res.status(400).json({ error: 'nothing to update' });
    const { email, name } = parse.data;
    try {
      const user = await prisma.user.update({ where: { id }, data: { email: email ?? undefined, name: name ?? undefined } });
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
    }
  });

  app.delete('/users/:id', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    try {
      if (id === auth.userId) return res.status(400).json({ error: 'cannot delete self' });
      const exists = await prisma.user.findUnique({ where: { id } });
      if (!exists) return res.status(404).json({ error: 'not found' });
      // Best-effort clean up to avoid constraint violations
      try { await prisma.presence.deleteMany({ where: { userId: id } }); } catch {}
      try { await prisma.passwordReset.deleteMany({ where: { userId: id } }); } catch {}
      try { await prisma.apiToken.deleteMany({ where: { userId: id } }); } catch {}
      try { await prisma.invite.updateMany({ where: { usedById: id }, data: { usedById: null } }); } catch {}
      await prisma.user.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (e) {
      logger.error('[Users] delete failed', e);
      return res.status(400).json({ error: 'delete failed' });
    }
  });

  // ========================
  // Asset Packs API
  // ========================
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../public/packs');
  try {
    fs.mkdirSync(packsDir, { recursive: true });
  } catch {}
  const FALLBACK_ASSET_URL = process.env.FALLBACK_ASSET_URL || '/packs/__fallback__/missing.png';

  // Zod Schemas according to ASSET_PACKS_SPEC.md
  const idStr = z.string().min(1).max(200);
  // Require paths under assets/ with safe characters only
  const relPath = z.string().min(1).regex(/^assets\/[A-Za-z0-9_\-\/.]+$/);

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
  }).strict();

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  function normalizeZipPath(p: string): string {
    const s = p.replace(/\\/g, '/');
    return path.posix.normalize(s);
  }

  function isUnsafePath(p: string): boolean {
    if (p.startsWith('/') || p.startsWith('\\')) return true;
    if (p.includes('..')) return true;
    if (p.includes(':')) return true; // Windows drive letters
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
    const s = p.replace(/^assets\//, '');
    return s;
  }

  function buildDimensionMaps(cfg: any) {
    const terrainMap = new Map<string, any>();
    const structMap = new Map<string, any>();
    const objMap = new Map<string, any>();
    for (const t of cfg.terrain || []) terrainMap.set(t.id, t);
    for (const s of cfg.structures || []) structMap.set(s.id, s);
    for (const o of cfg.objects || []) objMap.set(o.id, o);
    return { terrainMap, structMap, objMap };
  }

  function dimensionsStable(oldCfg: any, newCfg: any): { ok: true } | { ok: false; reason: string; offendingId?: string } {
    const oldMaps = buildDimensionMaps(oldCfg);
    const newMaps = buildDimensionMaps(newCfg);
    // Terrain: tileWidth/tileHeight (and margin/spacing) must match
    for (const [id, oldT] of oldMaps.terrainMap) {
      const n = newMaps.terrainMap.get(id);
      if (!n) continue;
      if (oldT.tileWidth !== n.tileWidth || oldT.tileHeight !== n.tileHeight || (oldT.margin ?? 0) !== (n.margin ?? 0) || (oldT.spacing ?? 0) !== (n.spacing ?? 0)) {
        return { ok: false, reason: 'terrain dimensions changed', offendingId: id };
      }
    }
    // Structures
    for (const [id, oldS] of oldMaps.structMap) {
      const n = newMaps.structMap.get(id);
      if (!n) continue;
      if (oldS.width !== n.width || oldS.height !== n.height) {
        return { ok: false, reason: 'structure sprite dimensions changed', offendingId: id };
      }
    }
    // Objects
    for (const [id, oldO] of oldMaps.objMap) {
      const n = newMaps.objMap.get(id);
      if (!n) continue;
      if (oldO.width !== n.width || oldO.height !== n.height) {
        return { ok: false, reason: 'object sprite dimensions changed', offendingId: id };
      }
    }
    return { ok: true };
  }

  // Upload endpoint
  app.post('/asset-packs/upload', upload.single('file'), async (req, res) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    try {
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file || !file.buffer || file.size <= 0) {
        return res.status(400).json({ error: 'file required' });
      }
      const buf = file.buffer as Buffer;
      // Zip magic bytes: PK\x03\x04 or empty archive might start with PK\x05\x06
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
        // Any other entries are not allowed
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

      // Ensure all referenced dataURL exist in assets and have allowed extensions
      const assetSet = new Set<string>();
      for (const e of assetEntries) {
        const p = normalizeZipPath(e.path || e.fileName);
        if (p.endsWith('/')) continue; // directory
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
      for (const arrName of ['terrain', 'structures', 'objects'] as const) {
        for (const it of (cfg[arrName] as any[]) || []) {
          const r = validateItemPath(it.dataURL);
          if (!r.ok) {
            return res.status(400).json({ error: 'missing or invalid asset for item', itemId: it.id, dataURL: it.dataURL });
          }
          referenced.push(r.norm);
        }
      }

      // Prepare temp directory for install
      const uuid = cfg.uuid as string;
      const tmpDir = path.resolve(packsDir, `.tmp-${uuid}-${Date.now()}`);
      await fsp.mkdir(tmpDir, { recursive: true });

      // Write hashed assets; keep the subpath under assets/
      const assetMap = new Map<string, string>(); // from assets/... -> hashed subpath path relative to pack root
      for (const entry of assetEntries) {
        const p = normalizeZipPath(entry.path || entry.fileName);
        if (p.endsWith('/')) continue; // skip dirs
        if (!isAllowedAssetExt(p)) {
          return res.status(400).json({ error: 'unsupported asset extension', path: p });
        }
        const content: Buffer = await entry.buffer();
        const h8 = shortHashHex(content, 8);
        const rel = withoutAssetsPrefix(p); // e.g. objects/chair.png
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

      // Rewrite dataURL to /packs/<uuid>/... and keep originalPath
      const rewriteItem = (it: any) => {
        const original = normalizeZipPath(it.dataURL);
        const mapped = assetMap.get(original);
        if (!mapped) return it;
        const out = { ...it } as any;
        out.originalPath = it.dataURL;
        out.dataURL = `/packs/${uuid}/${mapped}`;
        return out;
      };
      const rewritten = {
        ...cfg,
        terrain: (cfg.terrain || []).map(rewriteItem),
        structures: (cfg.structures || []).map(rewriteItem),
        objects: (cfg.objects || []).map(rewriteItem),
      };

      // Dimension stability check if upgrading to a different version
      const existing = await prisma.assetPack.findUnique({ where: { uuid: uuid } as any });
      if (existing) {
        if (existing.version !== cfg.version) {
          const check = dimensionsStable({
            terrain: (existing.terrain as any) || [],
            structures: (existing.structures as any) || [],
            objects: (existing.objects as any) || [],
          }, cfg);
          if (!check.ok) {
            // Clean temp
            try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
            return res.status(409).json({ error: 'dimension mismatch', reason: (check as any).reason, itemId: (check as any).offendingId });
          }
        }
      }

      // Atomic replace: remove old dir, move tmp into place
      const finalDir = path.resolve(packsDir, uuid);
      try { await fsp.rm(finalDir, { recursive: true, force: true }); } catch {}
      await fsp.mkdir(path.dirname(finalDir), { recursive: true });
      // Move by renaming each file tree from tmp to final
      // Use fs.rename for best-effort atomic move when same filesystem
      try {
        await fsp.rename(tmpDir, finalDir);
      } catch {
        // Fallback to copy
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
        try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
      }

      // Upsert DB
      const dataRecord = {
        uuid: cfg.uuid,
        name: cfg.name,
        description: cfg.description,
        author: cfg.author,
        version: cfg.version,
        terrain: rewritten.terrain as any,
        structures: rewritten.structures as any,
        objects: rewritten.objects as any,
      } as const;

      let rec;
      if (existing) {
        rec = await prisma.assetPack.update({ where: { uuid: cfg.uuid } as any, data: dataRecord as any });
      } else {
        rec = await prisma.assetPack.create({ data: dataRecord as any });
      }

      return res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch (e: any) {
      logger.error('[AssetPacks] upload failed', e);
      return res.status(500).json({ error: 'upload failed' });
    }
  });

  // List
  app.get('/asset-packs', async (_req, res) => {
    const list = await prisma.assetPack.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(list);
  });

  // Get by id
  app.get('/asset-packs/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const pack = await prisma.assetPack.findUnique({ where: { id } });
    if (!pack) return res.status(404).json({ error: 'not found' });
    res.json(pack);
  });

  // Delete
  app.delete('/asset-packs/:id', async (req, res) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const pack = await prisma.assetPack.findUnique({ where: { id } });
    if (!pack) return res.status(404).json({ error: 'not found' });
    try {
      const dir = path.resolve(packsDir, pack.uuid);
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {}
    await prisma.assetPack.delete({ where: { id } });
    res.json({ ok: true, fallback: FALLBACK_ASSET_URL });
  });

  // Existing endpoints
  app.get('/maps', async (_req, res) => {
    const maps = await prisma.map.findMany({ include: { zones: true, rooms: true } });
    res.json(maps);
  });

  // ========================
  // v2 Map State (READ-ONLY, PR1)
  // ========================
  app.get('/maps/:name/state-v2', async (req, res) => {
    const name = req.params.name;
    const map = await prisma.map.findUnique({ where: { name } });
    if (!map) return res.status(404).json({ error: 'map not found' });

    // Fetch tileset registry (deterministic by slot)
    const tilesets = await prisma.mapTileset.findMany({
      where: { mapId: map.id },
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        slot: true,
        key: true,
        imageUrl: true,
        tileWidth: true,
        tileHeight: true,
        margin: true,
        spacing: true,
        hash: true,
      },
    });

    // Fetch layers and existing chunk keys per layer
    const layers = await prisma.mapLayer.findMany({ where: { mapId: map.id }, select: { id: true, name: true, chunkSize: true } });
    const layerIndex: Record<string, { keys: string[]; chunkSize: number } > = {};
    for (const layer of layers) {
      const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id }, select: { x: true, y: true } });
      const keys = chunks.map((c) => `${c.x}:${c.y}`);
      layerIndex[layer.name] = { keys, chunkSize: layer.chunkSize };
    }

    const mapMeta = {
      width: map.width ?? null,
      height: map.height ?? null,
      tileWidth: map.tileWidth ?? null,
      tileHeight: map.tileHeight ?? null,
      chunkSize: map.chunkSize ?? 32,
      version: map.version ?? null,
    };

    res.json({
      mapMeta,
      tilesetRegistry: tilesets,
      layerIndex,
    });
  });

  app.get('/maps/:name/chunks', async (req, res) => {
    const schema = z.object({ layer: z.string().min(1), keys: z.string().min(1) });
    const parse = schema.safeParse(req.query || {});
    if (!parse.success) return res.status(400).json({ error: 'layer and keys required' });

    const name = req.params.name;
    const { layer: layerName, keys } = parse.data;
    const map = await prisma.map.findUnique({ where: { name } });
    if (!map) return res.status(404).json({ error: 'map not found' });
    const layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } as any });
    if (!layer) return res.status(404).json({ error: 'layer not found' });

    const keyList = keys.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    const wanted: Array<{ x: number; y: number; key: string }> = [];
    for (const k of keyList) {
      const [xs, ys] = k.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      wanted.push({ x, y, key: k });
    }
    if (wanted.length === 0) return res.json({ chunks: {} });

    const orList = wanted.map((w) => ({ x: w.x, y: w.y }));
    const found = await prisma.mapChunk.findMany({ where: { layerId: layer.id, OR: orList }, select: { x: true, y: true, version: true, encoding: true, data: true } });
    const out: Record<string, { version: number; encoding: string; data: string } > = {};
    for (const c of found) {
      const key = `${c.x}:${c.y}`;
      out[key] = { version: c.version, encoding: c.encoding, data: Buffer.from(c.data as any).toString('base64') };
    }

    res.setHeader('Cache-Control', 'no-cache');
    res.json({ chunks: out });
  });

  // ========================
  // v2 Map State (WRITE - PR2)
  // ========================
  app.patch('/maps/:name/paint-rect', async (req, res) => {
    const schema = z.object({
      layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls']),
      rect: z.object({ x0: z.number().int(), y0: z.number().int(), x1: z.number().int(), y1: z.number().int() }),
      tileRefId: z.number().int().optional(),
      erase: z.boolean().optional(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    const name = req.params.name;
    const { layer: layerName, rect, tileRefId, erase } = parse.data;
    const map = await prisma.map.findUnique({ where: { name } });
    if (!map) return res.status(404).json({ error: 'map not found' });

    // Validate tileRefId range lightly (slot/index 16-bit)
    if (!erase && (tileRefId === undefined || tileRefId < 0 || tileRefId > 0xffffffff)) {
      return res.status(400).json({ error: 'invalid tileRefId' });
    }

    // Ensure layer exists
    let layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } as any });
    if (!layer) {
      layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: layerName, chunkSize: map.chunkSize ?? 32 } });
    }

    const chunkSize = layer.chunkSize;
    const x0 = Math.min(rect.x0, rect.x1);
    const y0 = Math.min(rect.y0, rect.y1);
    const x1 = Math.max(rect.x0, rect.x1);
    const y1 = Math.max(rect.y0, rect.y1);

    // Which chunks are affected?
    const cx0 = Math.floor(x0 / chunkSize);
    const cy0 = Math.floor(y0 / chunkSize);
    const cx1 = Math.floor(x1 / chunkSize);
    const cy1 = Math.floor(y1 / chunkSize);

    const updates: Array<{ key: string; version: number; encoding: string; data: string }> = [];

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        // Load or initialize chunk
        let chunk = await prisma.mapChunk.findUnique({ where: { layerId_x_y: { layerId: layer.id, x: cx, y: cy } } as any });
        let values: number[];
        if (!chunk) {
          // Empty chunk
          values = new Array(chunkSize * chunkSize).fill(0);
        } else {
          const { decodeRlePairsFromBuffer, rleDecodeToNumbers } = await import('./mapEncoding.js');
          const pairs = decodeRlePairsFromBuffer(Buffer.from(chunk.data as any));
          values = rleDecodeToNumbers(pairs, chunkSize * chunkSize);
        }

        // Apply rect within this chunk
        const sx = cx * chunkSize;
        const sy = cy * chunkSize;
        const ex = sx + chunkSize - 1;
        const ey = sy + chunkSize - 1;

        const rx0 = Math.max(x0, sx);
        const ry0 = Math.max(y0, sy);
        const rx1 = Math.min(x1, ex);
        const ry1 = Math.min(y1, ey);

        if (rx0 > rx1 || ry0 > ry1) continue;

        for (let yy = ry0; yy <= ry1; yy++) {
          for (let xx = rx0; xx <= rx1; xx++) {
            const lx = xx - sx;
            const ly = yy - sy;
            const idx = ly * chunkSize + lx;
            values[idx] = erase ? 0 : (tileRefId as number);
          }
        }

        // Encode and persist
        const { rleEncodeNumbers, rleEncodeBooleans, encodeRlePairsToBuffer } = await import('./mapEncoding.js');
        const encoding = layerName === 'collision' ? 'rle-bool' : 'rle';
        const pairs = encoding === 'rle-bool'
          ? rleEncodeBooleans(values.map(v => v !== 0))
          : rleEncodeNumbers(values);
        const buf = encodeRlePairsToBuffer(pairs);

        if (!chunk) {
          chunk = await prisma.mapChunk.create({ data: { layerId: layer.id, x: cx, y: cy, version: 1, encoding, data: buf } });
        } else {
          chunk = await prisma.mapChunk.update({ where: { id: chunk.id }, data: { version: chunk.version + 1, encoding, data: buf } });
        }

        updates.push({ key: `${cx}:${cy}`, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
      }
    }

    // Broadcast stub via Colyseus rooms if available
    try {
      const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
      for (const room of rooms) {
        try { room.broadcast('chunks_updated', { map: name, layer: layerName, updates }); } catch {}
      }
    } catch {}

    res.json({ updates });
  });

  app.post('/maps/:name/tilesets', async (req, res) => {
    const schema = z.object({ key: z.string().min(1), imageUrl: z.string().min(1), tileWidth: z.number().int().positive(), tileHeight: z.number().int().positive(), margin: z.number().int().nonnegative().optional(), spacing: z.number().int().nonnegative().optional(), hash: z.string().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    const name = req.params.name;
    const map = await prisma.map.findUnique({ where: { name } });
    if (!map) return res.status(404).json({ error: 'map not found' });

    const last = await prisma.mapTileset.findFirst({ where: { mapId: map.id }, orderBy: { slot: 'desc' } });
    const newSlot = last ? last.slot + 1 : 0;
    await prisma.mapTileset.create({ data: { mapId: map.id, slot: newSlot, ...parse.data } });

    const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });

    // Broadcast registry update
    try {
      const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
      for (const room of rooms) {
        try { room.broadcast('tileset_registry_updated', { map: name, tilesetRegistry: tilesets }); } catch {}
      }
    } catch {}

    res.json({ tilesetRegistry: tilesets });
  });

  app.get('/zones', async (_req, res) => {
    const zones = await prisma.zone.findMany();
    res.json(zones);
  });

  // Editor: Save/Load Map State (authenticated)
  app.get('/maps/:name/editor-state', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
    let map = await prisma.map.findUnique({ where: { name } });
    if (!map) {
      map = await prisma.map.create({ data: { name, meta: {} } });
    }
    // meta speichert editor bezogene daten
    const meta = (map.meta as any) || {};
    res.json({
      editorGround: meta.editorGround ?? null,
      collision: meta.collision ?? null,
      tilesets: meta.tilesets ?? [],
      assets: meta.assets ?? [],
      zones: await prisma.zone.findMany({ where: { mapId: map.id }, select: { id: true, name: true, capacity: true, polygon: true } }),
      backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
    });
  });

  app.put('/maps/:name/editor-state', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
    const editorSchema = z.object({
      editorGround: z.array(z.number()).nullable().optional(),
      collision: z.array(z.number()).nullable().optional(),
      tilesets: z.array(z.any()).optional(),
      assets: z.array(z.any()).optional(),
      zones: z.array(z.any()).optional(),
      backgroundColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
      replaceZones: z.boolean().optional(),
    });
    const parse = editorSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid editor payload' });
    const { editorGround, collision, tilesets, assets, zones, backgroundColor, replaceZones } = parse.data;
    const found = await prisma.map.findUnique({ where: { name }, include: { rooms: true } });
    const map = found ?? await prisma.map.create({ data: { name, meta: {} } });
    // Ensure there is at least one room for this map (for zone assignment)
    let roomForZones = await prisma.room.findFirst({ where: { mapId: map.id }, orderBy: { createdAt: 'asc' } });
    if (!roomForZones) {
      const lobbyId = `${map.id}:lobby`;
      try {
        roomForZones = await prisma.room.create({ data: { id: lobbyId, name: 'lobby', mapId: map.id } });
      } catch {
        // Fallback: try to find again without assuming custom id
        roomForZones = await prisma.room.findFirst({ where: { mapId: map.id } });
      }
    }
    // Update meta blobs - merge with existing data to preserve previous edits
    const currentMeta = (map.meta as any) || {};
    await prisma.map.update({ 
      where: { id: map.id }, 
      data: { 
        meta: { 
          ...currentMeta,
          editorGround: editorGround ?? currentMeta.editorGround ?? null, 
          collision: collision ?? currentMeta.collision ?? null, 
          tilesets: tilesets ?? currentMeta.tilesets ?? [], 
          assets: assets ?? currentMeta.assets ?? [],
          backgroundColor: backgroundColor ?? currentMeta.backgroundColor ?? undefined,
        } as any 
      } 
    });
    // Upsert zones (simple strategy: replace all zones for map)
    if (Array.isArray(zones)) {
      // Normalize all incoming polygons and keep only non-empty ones
      const prepared = [] as Array<{ name: string; capacity: number | null; polygon: any[] }>;
      for (const z of zones) {
        const name = (z?.name || 'Zone').toString();
        const capacity = typeof (z as any)?.capacity === 'number' ? (z as any).capacity : null;
        let polygon: any = undefined;
        try {
          const anyZ: any = z as any;
          if (Array.isArray(anyZ?.points)) {
            polygon = anyZ.points;
          } else if (Array.isArray(anyZ?.polygon)) {
            polygon = anyZ.polygon;
          } else if (anyZ?.polygon && Array.isArray(anyZ.polygon.points)) {
            polygon = anyZ.polygon.points;
          }
        } catch {}
        if (Array.isArray(polygon) && polygon.length > 0) {
          prepared.push({ name, capacity, polygon });
        }
      }
      // Only mutate DB if there is at least one valid polygon OR explicit replaceZones=true
      if (prepared.length > 0 || replaceZones === true) {
        await prisma.zone.deleteMany({ where: { mapId: map.id } });
        for (const z of prepared) {
          await prisma.zone.create({ data: { name: z.name, capacity: z.capacity ?? undefined, polygon: z.polygon, mapId: map.id, roomId: roomForZones?.id as string } as any });
        }
      }
    }
    res.json({ ok: true });
  });

  // Profile update (authenticated)
  app.patch('/me', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const { name, email } = (req.body ?? {}) as { name?: string; email?: string };
    if (!name && !email) return res.status(400).json({ error: 'nothing to update' });
    try {
      const u = await prisma.user.update({ where: { id: auth.userId }, data: { name: name ?? undefined, email: email ?? undefined } });
      res.json({ id: u.id, email: u.email, name: u.name });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
    }
  });

  // Invitations management (authenticated)
  app.get('/invites', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const list = await prisma.invite.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(list);
  });

  app.delete('/invites/:code', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const code = req.params.code;
    try {
      const inv = await prisma.invite.findUnique({ where: { code } });
      if (!inv) return res.status(404).json({ error: 'not found' });
      if (inv.usedAt) return res.status(400).json({ error: 'already used' });
      await prisma.invite.delete({ where: { code } });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'delete failed' });
    }
  });

  app.post('/livekit/token', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ roomName: z.string().min(1), identity: z.string().min(1), name: z.string().optional(), canPublish: z.boolean().optional(), canSubscribe: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'roomName and identity required' });
    const { roomName, identity, name, canPublish, canSubscribe } = parse.data;
    try {
      if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
        return res.status(500).json({ error: 'livekit not configured' });
      }
      const token = await createLivekitToken({ roomName, identity, name, canPublish, canPublishData: true, canSubscribe });
      res.type('text/plain').send(token);
    } catch (e: any) {
      logger.error('[LiveKit] Failed to create token:', e?.message || e);
      res.status(500).json({ error: 'failed to create token' });
    }
  });

  // Single user lookup (authenticated)
  app.get('/users/:id', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, createdAt: true, updatedAt: true } });
    if (!user) return res.status(404).json({ error: 'not found' });
    res.json(user);
  });

  // API Tokens management (session-authenticated)
  app.get('/api-tokens', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const list = await prisma.apiToken.findMany({ where: { userId: auth.userId }, orderBy: { createdAt: 'desc' } });
    res.json(list.map(t => ({ id: t.id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })));
  });

  app.post('/api-tokens', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ name: z.string().min(1).max(100).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(API_TOKEN_PEPPER + raw).digest('hex');
    const rec = await prisma.apiToken.create({ data: { userId: auth.userId, name: parse.data.name, hash } });
    res.json({ id: rec.id, token: raw, name: rec.name, createdAt: rec.createdAt });
  });

  app.delete('/api-tokens/:id', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    try {
      const tok = await prisma.apiToken.findUnique({ where: { id } });
      if (!tok || tok.userId !== auth.userId) return res.status(404).json({ error: 'not found' });
      await prisma.apiToken.delete({ where: { id } });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'delete failed' });
    }
  });

  // Remote controls (session or API token)
  app.post('/controls', async (req, res) => {
    const sessionAuth = requireAuth(req);
    const tokenAuth = await requireApiToken(req);
    const auth = sessionAuth || tokenAuth;
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const schema = z.object({
      mic: z.boolean().optional(),
      cam: z.boolean().optional(),
      share: z.boolean().optional(),
      dnd: z.boolean().optional(),
    }).refine(v => (v.mic !== undefined || v.cam !== undefined || v.share !== undefined || v.dnd !== undefined), { message: 'at least one field required' });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    const gameServer = (global as any).gameServer;
    if (!gameServer) return res.status(500).json({ error: 'game server not available' });

    // Find connected client(s) of this user
    const payload = parse.data;
    let delivered = 0;
    // Try different ways to access rooms
    let roomArray: any[] = [];
    
    // First try our global active rooms
    const activeWorldRooms = (global as any).activeWorldRooms;
    if (activeWorldRooms && activeWorldRooms.size > 0) {
      roomArray = Array.from(activeWorldRooms);
    } else if (gameServer.matchMaker) {
      // Colyseus 0.14+ uses matchMaker
      const allRooms = await gameServer.matchMaker.query({}) || [];
      roomArray = allRooms;
    } else if (gameServer.rooms) {
      const rooms = gameServer.rooms;
      roomArray = rooms instanceof Map ? Array.from(rooms.values()) : Array.from(rooms);
    }
    
    const debug = { authUserId: auth.userId, foundPlayers: [] as any[], roomCount: roomArray.length };
    
    for (const room of roomArray) {
      try {
        if (!room || !room.state || !room.state.players) continue;
        const matches: string[] = [];
        room.state.players.forEach((p: any, sid: string) => {
          debug.foundPlayers.push({ sid, identity: p.identity, name: p.name });
          if (p && (p.identity === auth.userId || p.name === auth.userId)) matches.push(sid);
        });
        if (matches.length === 0) continue;
        // Map session IDs to client instances
        const clients: any[] = Array.from((room as any).clients?.values?.() || (room as any).clients || []);
        for (const sid of matches) {
          const client: any = clients.find((c: any) => c.sessionId === sid);
          if (client && typeof client.send === 'function') {
            client.send('remote_control', payload);
            delivered++;
          }
        }
      } catch {}
    }

    if (delivered === 0) {
      logger.debug('[Controls] No user online:', debug);
      return res.status(409).json({ error: 'user not online', debug });
    }
    res.json({ ok: true, delivered });
  });

  // Debug endpoint for Colyseus rooms
  app.get('/debug/rooms', async (_req, res) => {
    const gameServer = (global as any).gameServer;
    if (!gameServer) return res.json({ error: 'Game server not initialized' });
    
    const rooms: any[] = [];
    try {
      // Colyseus 0.14/0.15 compatibility - try different ways to access rooms
      let roomArray: any[] = [];
      
      // First try our global active rooms
      const activeWorldRooms = (global as any).activeWorldRooms;
      if (activeWorldRooms && activeWorldRooms.size > 0) {
        roomArray = Array.from(activeWorldRooms);
      } else if (gameServer.matchMaker) {
        // Get all rooms from matchMaker
        const allRooms = await gameServer.matchMaker.query({}) || [];
        roomArray = allRooms;
      } else if (gameServer.rooms) {
        const rooms = gameServer.rooms;
        roomArray = rooms instanceof Map ? Array.from(rooms.values()) : Array.from(rooms);
      }
      
      roomArray.forEach((room: any) => {
        const players: any[] = [];
        if (room.state && room.state.players) {
          room.state.players.forEach((p: any, sid: string) => {
            players.push({
              sessionId: sid,
              identity: p.identity,
              name: p.name,
              x: p.x,
              y: p.y,
              dnd: p.dnd
            });
          });
        }
        rooms.push({
          roomId: room.roomId,
          roomName: room.roomName || 'world',
          clients: room.clients ? room.clients.size || room.clients.length : 0,
          locked: room.locked || false,
          maxClients: room.maxClients || 0,
          metadata: room.metadata || {},
          players
        });
      });
    } catch (e: any) {
      return res.json({ error: 'Failed to get rooms', details: e.message });
    }
    
    res.json({ rooms, total: rooms.length });
  });
}
