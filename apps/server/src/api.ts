import type express from 'express';
import { PrismaClient } from '@prisma/client';
import { createLivekitToken } from './livekit.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const COOKIE_NAME = 'auth_token';

function setAuthCookie(res: express.Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
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
    const email = req.body?.email?.toString()?.trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const code = crypto.randomBytes(12).toString('hex');
    const inv = await prisma.invite.create({ data: { code, email } });
    res.json({ code: inv.code });
  });

  app.post('/auth/register', async (req, res) => {
    const { code, name, email, password } = req.body ?? {};
    if (!code || !email || !password) return res.status(400).json({ error: 'code, email, password required' });
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
    const { email, password } = req.body ?? {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
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
    const user = await prisma.user.findUnique({ where: { id: auth.userId } });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    res.json({ id: user.id, email: user.email, name: user.name });
  });

  app.post('/auth/forgot', async (req, res) => {
    const email = req.body?.email?.toString()?.trim();
    if (!email) return res.status(400).json({ error: 'email required' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });
    // In real app: send email with URL containing token
    res.json({ ok: true, token });
  });

  app.post('/auth/reset', async (req, res) => {
    const { token, password } = req.body ?? {};
    if (!token || !password) return res.status(400).json({ error: 'token and password required' });
    const pr = await prisma.passwordReset.findUnique({ where: { token } });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) return res.status(400).json({ error: 'invalid token' });
    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { id: pr.userId }, data: { passwordHash: hash } });
    await prisma.passwordReset.update({ where: { token }, data: { usedAt: new Date() } });
    res.json({ ok: true });
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

  app.post('/livekit/token', async (req, res) => {
    const { roomName, identity, name, canPublish, canSubscribe } = req.body ?? {};
    if (!roomName || !identity) return res.status(400).json({ error: 'roomName and identity required' });
    const token = await createLivekitToken({ roomName, identity, name, canPublish, canPublishData: true, canSubscribe });
    console.log('LiveKit token generated', typeof token, token.length);
    res.type('text/plain').send(token);
  });
}
