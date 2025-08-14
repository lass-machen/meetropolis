import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { createLivekitToken } from './livekit.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

const prisma = new PrismaClient();
const JWT_SECRET = (() => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET fehlt in Produktion');
  }
  // Development: ephemeres Secret, nur für lokale Sessions
  const devSecret = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn('[SECURITY] JWT_SECRET fehlt – verwende ephemeres DEV-Secret.');
  return devSecret;
})();
const COOKIE_NAME = 'auth_token';

function setAuthCookie(res: express.Response, token: string) {
  const forceSecure = process.env.COOKIE_SECURE === 'true';
  const isProd = process.env.NODE_ENV === 'production';
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
    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, name, passwordHash: hash, emailVerifiedAt: new Date() } });
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
      await prisma.user.delete({ where: { id } });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'delete failed' });
    }
  });

  // Existing endpoints
  app.get('/maps', async (_req, res) => {
    const maps = await prisma.map.findMany({ include: { zones: true, rooms: true } });
    res.json(maps);
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
    });
    const parse = editorSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid editor payload' });
    const { editorGround, collision, tilesets, assets, zones } = parse.data;
    const found = await prisma.map.findUnique({ where: { name }, include: { rooms: true } });
    const map = found ?? await prisma.map.create({ data: { name, meta: {} } });
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
          assets: assets ?? currentMeta.assets ?? [] 
        } as any 
      } 
    });
    // Upsert zones (simple strategy: replace all zones for map)
    if (Array.isArray(zones)) {
      await prisma.zone.deleteMany({ where: { mapId: map.id } });
      for (const z of zones) {
        const name = (z?.name || 'Zone').toString();
        const capacity = typeof z?.capacity === 'number' ? z.capacity : null;
        const polygon = z?.points ? z.points : z?.polygon;
        if (!Array.isArray(polygon)) continue;
        await prisma.zone.create({ data: { name, capacity: capacity ?? undefined, polygon, mapId: map.id, roomId: (map as any).rooms?.[0]?.id } as any });
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
    const token = await createLivekitToken({ roomName, identity, name, canPublish, canPublishData: true, canSubscribe });
    res.type('text/plain').send(token);
  });

  // Debug endpoint for Colyseus rooms
  app.get('/debug/rooms', async (_req, res) => {
    const gameServer = (global as any).gameServer;
    if (!gameServer) return res.json({ error: 'Game server not initialized' });
    
    const rooms = [];
    try {
      // Colyseus 0.14/0.15 compatibility
      const allRooms = gameServer.rooms || [];
      allRooms.forEach((room: any) => {
        rooms.push({
          roomId: room.roomId,
          roomName: room.roomName || 'world',
          clients: room.clients ? room.clients.size || room.clients.length : 0,
          locked: room.locked || false,
          maxClients: room.maxClients || 0,
          metadata: room.metadata || {}
        });
      });
    } catch (e: any) {
      return res.json({ error: 'Failed to get rooms', details: e.message });
    }
    
    res.json({ rooms, total: rooms.length });
  });
}
