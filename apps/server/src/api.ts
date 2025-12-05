import type express from 'express';
// use global shim for multer types
import { PrismaClient } from '@prisma/client';
import { createLivekitToken } from './livekit.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { logger } from './logger.js';
import { livekitSamples, livekitRttSeconds, livekitJitterSeconds, livekitInboundBitrateBps, livekitOutboundBitrateBps, livekitPacketLossRatio } from './metrics.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import fs from 'fs';
import fsp from 'fs/promises';
import multer from 'multer';
import unzipper from 'unzipper';
import Stripe from 'stripe';
import { registerApiTokenRoutes } from './api/routes/tokens.js';
import { registerPresenceRoutes } from './api/routes/presence.js';
import { registerUserRoutes } from './api/routes/users.js';
import { registerControlRoutes } from './api/routes/controls.js';

const prisma = new PrismaClient();
function getJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[SECURITY] JWT_SECRET fehlt in Produktion');
  }
  // Development: ephemeres Secret, nur für lokale Sessions
  const key = (globalThis as any).__DEV_JWT_SECRET__ as string | undefined;
  if (key && key.length > 0) return key;
  const devSecret = crypto.randomBytes(32).toString('hex');
  try { logger.warn('[SECURITY] JWT_SECRET fehlt – verwende ephemeres DEV-Secret.'); } catch { }
  (globalThis as any).__DEV_JWT_SECRET__ = devSecret;
  return devSecret;
}
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

function getTenantFromReq(req: express.Request): { id: string; slug: string; bypassLimits?: boolean; isInternal?: boolean } | null {
  const t: any = (req as any).tenant;
  if (t && t.id && t.slug) return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  return null;
}

async function requireInternalOwner(_req: express.Request, userId: string): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    if (!internal) return false;
    const member = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: internal.id, userId } } as any });
    if (!member) return false;
    return (member as any).role === 'owner';
  } catch {
    return false;
  }
}

function computeOnlineUsageByTenantSlug(): Record<string, number> {
  const usage: Record<string, number> = {};
  try {
    const activeWorldRooms: any = (global as any).activeWorldRooms;
    const rooms: any[] = activeWorldRooms ? Array.from(activeWorldRooms.values()) : [];
    for (const r of rooms) {
      const slug = (r as any).metadata?.tenant || 'default';
      const n = (r as any).state?.players?.size || 0;
      usage[slug] = (usage[slug] || 0) + n;
    }
  } catch { }
  return usage;
}

async function requireMembership(req: express.Request, userId: string): Promise<{ role: string } | null> {
  const tenant = getTenantFromReq(req);
  if (!tenant) return null;
  const m = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId } } as any });
  if (!m) return null;
  return { role: (m as any).role };
}

function requireAuth(req: express.Request): { userId: string; tenantId?: string } | null {
  const raw = (req as any).cookies?.[COOKIE_NAME] || req.headers['authorization']?.toString()?.replace('Bearer ', '');
  if (!raw) return null;
  try {
    const payload = jwt.verify(raw, getJwtSecret()) as any;
    return { userId: payload.sub, tenantId: payload.tid };
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

function normalizeEmailForStorage(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeEmailForMatching(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) return trimmed;
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const plusIndex = local.indexOf('+');
  const localBase = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
  return `${localBase}@${domain}`;
}

export function registerApi(app: express.Express) {
  async function getDefaultFreeSeats(): Promise<number> {
    // Prefer internal tenant's freeSeats as platform default
    try {
      const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
      const v = (internal as any)?.freeSeats;
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    } catch { }
    const envV = Number(process.env.FREE_SEATS_DEFAULT || '');
    if (Number.isFinite(envV) && envV >= 0) return envV;
    return 3;
  }
  app.get('/health', (_req: express.Request, res: express.Response) => res.json({ ok: true }));
  // Liveness probe: keine externen Abhängigkeiten
  app.get('/healthz', (_req: express.Request, res: express.Response) => res.json({ ok: true }));

  // Public Client Config (Auto-Discovery helper)
  app.get('/config', (_req: express.Request, res: express.Response) => {
    res.json({
      // Use LIVEKIT_EXTERNAL_URL for external clients (Tauri), fallback to LIVEKIT_URL
      livekitUrl: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'ws://localhost:7880',
      billingEnabled: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  // Readiness probe: prüft DB und LiveKit-Konfiguration
  app.get('/readyz', async (_req: express.Request, res: express.Response) => {
    const result: { db: 'ok' | 'fail'; livekit: 'ok' | 'missing'; ok: boolean } = {
      db: 'fail',
      livekit: 'missing',
      ok: false,
    };
    // DB Check mit Timeout
    try {
      const p = prisma.$queryRaw`SELECT 1` as unknown as Promise<any>;
      const withTimeout = new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('db-timeout')), 2000);
        p.then((v) => { clearTimeout(to); resolve(v); }).catch((e) => { clearTimeout(to); reject(e); });
      });
      await withTimeout;
      result.db = 'ok';
    } catch {
      result.db = 'fail';
    }
    // LiveKit Konfiguration vorhanden?
    if (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      try {
        // Token-Generierung validiert Secrets syntaktisch
        await createLivekitToken({ roomName: 'readyz', identity: 'probe', canPublish: false, canSubscribe: false, canPublishData: false });
        result.livekit = 'ok';
      } catch {
        result.livekit = 'missing';
      }
    } else {
      result.livekit = 'missing';
    }
    result.ok = result.db === 'ok' && result.livekit === 'ok';
    const status = result.ok ? 200 : 503;
    res.status(status).json(result);
  });

  // Auth Endpoints
  app.post('/auth/invite', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const schema = z.object({ 
      email: z.string().email(),
      role: z.enum(['admin', 'member']).optional().default('member')
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email required' });
    // Admins können nur member einladen, Owners können auch admins einladen
    const requestedRole = parse.data.role;
    const allowedRole = membership.role === 'owner' ? requestedRole : 'member';
    const code = crypto.randomBytes(12).toString('hex');
    const normalizedEmail = normalizeEmailForStorage(parse.data.email);
    const inv = await prisma.invite.create({ data: { code, email: normalizedEmail, createdBy: auth.userId, tenantId: tenant.id, role: allowedRole as any } });
    res.json({ code: inv.code, role: allowedRole });
  });

  app.post('/auth/register', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ code: z.string().min(4), name: z.string().min(1).optional(), email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'code, email, password required' });
    const { code, name, email, password } = parse.data;
    const invite = await prisma.invite.findUnique({ where: { code } });
    if (!invite || invite.usedAt) return res.status(400).json({ error: 'invalid or used invite' });
    // Enforce invite email if present
    if (invite.email && normalizeEmailForMatching(invite.email) !== normalizeEmailForMatching(email)) {
      return res.status(400).json({ error: 'invite does not match email' });
    }
    const hash = await bcrypt.hash(password, 10);
    let user;
    try {
      const emailForStorage = normalizeEmailForStorage(email);
      user = await prisma.user.create({ data: { email: emailForStorage, name, passwordHash: hash, emailVerifiedAt: new Date() } });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      return res.status(400).json({ error: 'registration failed' });
    }
    await prisma.invite.update({ where: { code }, data: { usedAt: new Date(), usedById: user.id } });
    // Create membership in invite's tenant
    try {
      if ((invite as any).tenantId) {
        await prisma.membership.upsert({
          where: { tenantId_userId: { tenantId: (invite as any).tenantId, userId: user.id } } as any,
          update: {},
          create: { tenantId: (invite as any).tenantId, userId: user.id, role: (invite as any).role || 'member' },
        });
      }
    } catch { }
    const token = jwt.sign({ sub: user.id, tid: (invite as any).tenantId }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, token);
    // Return token in body for Tauri/native clients that can't use cookies
    const origin = req.headers.origin || '';
    const isTauri = origin.startsWith('tauri://');
    res.json({ id: user.id, email: user.email, name: user.name, ...(isTauri && { token }) });
  });

  app.post('/auth/login', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email and password required' });
    const { email, password } = parse.data;
    const emailLookup = normalizeEmailForStorage(email);
    const user = await prisma.user.findFirst({ where: { email: { equals: emailLookup, mode: 'insensitive' } } });
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    // Ensure user is member of current tenant
    const membership = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } as any });
    if (!membership) return res.status(403).json({ error: 'not_member_of_tenant' });
    const token = jwt.sign({ sub: user.id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, token);
    // Return token in body for Tauri/native clients that can't use cookies
    const origin = req.headers.origin || '';
    const isTauri = origin.startsWith('tauri://');
    res.json({ id: user.id, email: user.email, name: user.name, ...(isTauri && { token }) });
  });

  app.post('/auth/logout', async (_req: express.Request, res: express.Response) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/auth/me', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const member = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: auth.userId } } as any });
    if (!member) return res.status(403).json({ error: 'not_member_of_tenant' });
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      include: {
        presences: {
          where: { tenantId: tenant.id },
          orderBy: { updatedAt: 'desc' },
          take: 1
        }
      }
    });
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    // Root-Admin Flag (internal:owner)
    let isInternalOwner = false;
    try {
      isInternalOwner = await requireInternalOwner(req, auth.userId);
    } catch { }
    const lastPosition = user.presences[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      isInternalOwner,
      lastPosition: lastPosition ? { x: lastPosition.x, y: lastPosition.y, direction: lastPosition.direction } : null
    });
  });

  // Save user position (guarded: never crash on DB errors)
  app.post('/auth/position', async (req, res) => {
    try {
      const auth = requireAuth(req);
      if (!auth) return res.status(401).json({ error: 'unauthorized' });
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
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
      let room = await prisma.room.findFirst({ where: { name: roomId, tenantId: tenant.id } });
      if (!room) {
        // Create default map and room if not exists
        let map = await prisma.map.findFirst({ where: { name: 'office', tenantId: tenant.id } });
        if (!map) {
          map = await prisma.map.create({
            data: {
              name: 'office',
              meta: {},
              tenantId: tenant.id,
              width: 32,
              height: 32,
              tileWidth: 16,
              tileHeight: 16,
              chunkSize: 32
            }
          });
        }
        room = await prisma.room.create({ data: { name: roomId, mapId: map.id, tenantId: tenant.id } });
      }

      // Update or create presence
      const existingPresence = await prisma.presence.findFirst({
        where: {
          userId: auth.userId,
          roomId: room.id,
          tenantId: tenant.id
        }
      });

      if (existingPresence) {
        await prisma.presence.update({
          where: { id: existingPresence.id },
          data: { x, y, direction }
        });
      } else {
        await prisma.presence.create({
          data: { userId: auth.userId, roomId: room.id, tenantId: tenant.id, x, y, direction }
        });
      }

      // Best-effort WS push: presence_update for this tenant
      try {
        const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
        for (const r of rooms) {
          const meta = (r as any).metadata || {};
          if (meta && meta.tenant && meta.tenant !== tenant.slug) continue;
          try {
            (r as any).broadcast?.('presence_update', {
              userId: auth.userId,
              x, y, direction,
              updatedAt: new Date().toISOString(),
            });
          } catch { }
        }
      } catch { }

      res.json({ ok: true });
    } catch (e: any) {
      try { logger.error('[Auth] position update failed', e); } catch { }
      return res.status(500).json({ error: 'position update failed' });
    }
  });

  app.post('/auth/forgot', async (req, res) => {
    const schema = z.object({ email: z.string().email() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email required' });
    const email = parse.data.email;
    const emailLookup = normalizeEmailForStorage(email);
    const user = await prisma.user.findFirst({ where: { email: { equals: emailLookup, mode: 'insensitive' } } });
    if (!user) return res.json({ ok: true });
    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });
    // In real app: send email with URL containing token
    res.json({ ok: true, token });
  });

  app.post('/auth/reset', async (req, res) => {
    const schema = z.object({ email: z.string().email().optional(), token: z.string().min(8), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'token and password required' });
    const { email, token, password } = parse.data;
    const pr = await prisma.passwordReset.findUnique({ where: { token } });
    if (!pr || pr.usedAt || pr.expiresAt < new Date()) return res.status(400).json({ error: 'invalid token' });
    if (email) {
      const u = await prisma.user.findUnique({ where: { id: pr.userId } });
      if (!u || normalizeEmailForMatching(u.email) !== normalizeEmailForMatching(email)) {
        return res.status(400).json({ error: 'invalid token' });
      }
    }
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
  app.get('/users', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const users = await prisma.user.findMany({
      where: { memberships: { some: { tenantId: tenant.id } } } as any,
      select: { 
        id: true, 
        email: true, 
        name: true, 
        createdAt: true, 
        updatedAt: true,
        memberships: {
          where: { tenantId: tenant.id },
          select: { role: true }
        }
      }
    });
    // Flatten: Rolle aus Membership extrahieren
    const result = users.map((u: any) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      role: u.memberships?.[0]?.role || 'member'
    }));
    res.json(result);
  });

  app.patch('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    const schema = z.object({ email: z.string().email().optional(), name: z.string().min(1).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success || (!parse.data.email && !parse.data.name)) return res.status(400).json({ error: 'nothing to update' });
    const { email, name } = parse.data;
    try {
      const normalized = email ? normalizeEmailForStorage(email) : undefined;
      const user = await prisma.user.update({ where: { id }, data: { email: normalized ?? undefined, name: name ?? undefined } });
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
    }
  });

  // Rolle eines Users ändern (Owner und Admins können Rollen ändern)
  app.patch('/users/:id/role', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    
    // Owner und Admins können Rollen ändern
    const callerMembership = await requireMembership(req, auth.userId);
    if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
      return res.status(403).json({ error: 'forbidden - only owners and admins can change roles' });
    }
    
    const id = req.params.id;
    const schema = z.object({ role: z.enum(['admin', 'member']) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'valid role required (admin or member)' });
    
    // Kann nicht die eigene Rolle ändern (Schutz vor versehentlichem Downgrade)
    if (id === auth.userId) {
      return res.status(400).json({ error: 'cannot change own role' });
    }
    
    try {
      const membership = await prisma.membership.findFirst({
        where: { userId: id, tenantId: tenant.id }
      });
      if (!membership) return res.status(404).json({ error: 'user not found in this tenant' });
      
      // Admins können keine Owner-Rollen ändern (nur Owner können das)
      if ((membership as any).role === 'owner' && callerMembership.role !== 'owner') {
        return res.status(403).json({ error: 'forbidden - only owners can change owner roles' });
      }
      
      // Owner-Rolle kann nicht vergeben werden (nur über Seed/Migration)
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: parse.data.role as any }
      });
      
      logger.info('[Users] Role changed', { userId: id, newRole: parse.data.role, changedBy: auth.userId });
      res.json({ ok: true, role: parse.data.role });
    } catch (e) {
      logger.error('[Users] Role change failed', e);
      res.status(400).json({ error: 'role change failed' });
    }
  });

  app.delete('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    try {
      if (id === auth.userId) return res.status(400).json({ error: 'cannot delete self' });
      const exists = await prisma.user.findUnique({ where: { id } });
      if (!exists) return res.status(404).json({ error: 'not found' });
      // Best-effort clean up to avoid constraint violations
      try { await prisma.presence.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.passwordReset.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.apiToken.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.invite.updateMany({ where: { usedById: id }, data: { usedById: null } }); } catch { }
      // WICHTIG: Memberships müssen vor dem User gelöscht werden (FK constraint)
      try { await prisma.membership.deleteMany({ where: { userId: id } }); } catch { }
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
  const packsDir = process.env.ASSET_PACKS_DIR || path.resolve(__dirname, '../../../public/packs');
  try {
    fs.mkdirSync(packsDir, { recursive: true });
  } catch { }
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
      try { logger.info('[AssetPacks] upload request received'); } catch { }
      const file = (req as any).file as any as { buffer?: Buffer; size?: number } | undefined;
      if (!file || !file.buffer || !file.size || file.size <= 0) {
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
      try { logger.info('[AssetPacks] parsed config.json', { uuid: cfg?.uuid, name: cfg?.name, v: cfg?.version, nTerrain: (cfg?.terrain || []).length, nStruct: (cfg?.structures || []).length, nObjects: (cfg?.objects || []).length }); } catch { }

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
            try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { }
            return res.status(409).json({ error: 'dimension mismatch', reason: (check as any).reason, itemId: (check as any).offendingId });
          }
        }
      }

      // Atomic replace: remove old dir, move tmp into place
      const finalDir = path.resolve(packsDir, uuid);
      try { await fsp.rm(finalDir, { recursive: true, force: true }); } catch { }
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
        try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch { }
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
      try { logger.info('[AssetPacks] upload success', { id: rec.id, uuid: rec.uuid, version: rec.version }); } catch { }
      return res.json({ ok: true, id: rec.id, uuid: rec.uuid, version: rec.version });
    } catch (e: any) {
      logger.error('[AssetPacks] upload failed', e);
      return res.status(500).json({ error: 'upload failed' });
    }
  });

  // List
  app.get('/asset-packs', async (_req: express.Request, res: express.Response) => {
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

  // Delete
  app.delete('/asset-packs/:id', async (req: express.Request, res: express.Response) => {
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
    } catch { }
    await prisma.assetPack.delete({ where: { id } });
    res.json({ ok: true, fallback: FALLBACK_ASSET_URL });
  });

  // Existing endpoints
  app.get('/maps', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const maps = await prisma.map.findMany({ where: { tenantId: tenant.id }, include: { zones: true, rooms: true } });
    res.json(maps);
  });

  // ========================
  // v2 Map State (READ-ONLY, PR1)
  // ========================
  app.get('/maps/:name/state-v2', async (req: express.Request, res: express.Response) => {
    try {
      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      let map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });

      const defaults = { width: 32, height: 32, tileWidth: 16, tileHeight: 16, chunkSize: 32 };

      if (!map) {
        // Auto-provision map if missing to ensure v2 mode works
        try {
          map = await prisma.map.create({ data: { name, meta: {}, tenantId: tenant.id, ...defaults } });
          logger.info('[Map] Auto-created map on state-v2 fetch', { name, tenant: tenant.slug });
        } catch (e) {
          return res.status(500).json({ error: 'failed to create map' });
        }
      } else {
        // Auto-fix: if map exists but has no dimensions, patch it
        if (!map.width || !map.height || !map.tileWidth || !map.tileHeight) {
          try {
            map = await prisma.map.update({
              where: { id: map.id },
              data: {
                width: map.width ?? defaults.width,
                height: map.height ?? defaults.height,
                tileWidth: map.tileWidth ?? defaults.tileWidth,
                tileHeight: map.tileHeight ?? defaults.tileHeight,
              }
            });
            logger.info('[Map] Auto-patched map dimensions on state-v2 fetch', { name, tenant: tenant.slug });
          } catch { }
        }
      }

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
      const layerIndex: Record<string, { keys: string[]; chunkSize: number }> = {};
      for (const layer of layers) {
        const chunks = await prisma.mapChunk.findMany({ where: { layerId: layer.id }, select: { x: true, y: true } });
        const keys = chunks.map((c: { x: number; y: number }) => `${c.x}:${c.y}`);
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
    } catch (e: any) {
      logger.error('[Map] state-v2 failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.get('/maps/:name/chunks', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ layer: z.string().min(1), keys: z.string().min(1) });
      const parse = schema.safeParse(req.query || {});
      if (!parse.success) return res.status(400).json({ error: 'layer and keys required' });

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, keys } = parse.data;
      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });
      const layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } as any });
      if (!layer) {
        // Layer doesn't exist yet -> treat as empty (no chunks)
        return res.json({ chunks: {} });
      }

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
      const out: Record<string, { version: number; encoding: string; data: string }> = {};
      for (const c of found) {
        const key = `${c.x}:${c.y}`;
        out[key] = { version: c.version, encoding: c.encoding, data: Buffer.from(c.data as any).toString('base64') };
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.json({ chunks: out });
    } catch (e: any) {
      logger.error('[Map] chunks fetch failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  // ========================
  // v2 Map State (WRITE - PR2)
  // ========================
  app.patch('/maps/:name/paint-rect', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({
        layer: z.enum(['editor_ground', 'editor_walls', 'collision', 'ground', 'walls']),
        rect: z.object({ x0: z.number().int(), y0: z.number().int(), x1: z.number().int(), y1: z.number().int() }),
        tileRefId: z.number().int().optional(),
        values: z.array(z.number().int()).optional(),
        erase: z.boolean().optional(),
      });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) {
        logger.warn('[Paint] invalid payload', parse.error);
        return res.status(400).json({ error: 'invalid payload' });
      }

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const { layer: layerName, rect, tileRefId, values: rawValues, erase } = parse.data;

      logger.info('[Paint] Request', { map: name, layer: layerName, rect, erase, hasValues: !!rawValues, tileRefId });

      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) {
        logger.warn('[Paint] map not found', { name, tenant: tenant.slug });
        return res.status(404).json({ error: 'map not found' });
      }

      // Validate payload: either erase, tileRefId, or values must be present
      if (!erase && tileRefId === undefined && (!rawValues || rawValues.length === 0)) {
        return res.status(400).json({ error: 'invalid payload: missing tileRefId or values' });
      }

      // ... (layer creation logic remains same)
      // Ensure layer exists
      let layer = await prisma.mapLayer.findUnique({ where: { mapId_name: { mapId: map.id, name: layerName } } as any });
      if (!layer) {
        layer = await prisma.mapLayer.create({ data: { mapId: map.id, name: layerName, chunkSize: map.chunkSize ?? 32 } });
        logger.info('[Paint] created layer', { layerId: layer.id, name: layerName });
      }

      const chunkSize = layer.chunkSize || 32;

      // Calculate chunks to fetch
      const chunkCoordsToFetch: { x: number, y: number }[] = [];
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const cx = Math.floor(x / chunkSize);
          const cy = Math.floor(y / chunkSize);
          if (!chunkCoordsToFetch.find(c => c.x === cx && c.y === cy)) {
            chunkCoordsToFetch.push({ x: cx, y: cy });
          }
        }
      }

      // Fetch all relevant chunks in one go
      const existingChunks = await prisma.mapChunk.findMany({
        where: {
          layerId: layer.id,
          OR: chunkCoordsToFetch,
        },
      });

      // Map for quick lookup
      const chunks = new Map<string, any>();
      for (const c of existingChunks) {
        chunks.set(`${c.x}:${c.y}`, c);
      }

      // Group updates by chunk to avoid N+1 DB writes
      const chunkUpdates = new Map<string, { chunk: any, cx: number, cy: number, modified: boolean, _decoded: number[] }>();

      // 1. Apply all changes to in-memory chunks
      const { decodeRlePairsFromBuffer, rleDecodeToNumbers, rleDecodeToBooleans } = await import('./mapEncoding.js');

      const rectWidth = rect.x1 - rect.x0 + 1;

      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          const cx = Math.floor(x / chunkSize);
          const cy = Math.floor(y / chunkSize);
          const chunkKey = `${cx}:${cy}`;

          let chunkData = chunkUpdates.get(chunkKey);
          if (!chunkData) {
            // Get existing or create new placeholder
            const existingChunk = chunks.get(chunkKey);
            chunkData = { chunk: existingChunk, cx, cy, modified: false, _decoded: [] };
            chunkUpdates.set(chunkKey, chunkData);
          }

          const rx = x % chunkSize;
          const ry = y % chunkSize;
          const idx = ry * chunkSize + rx;

          // Decode if not already decoded in this batch
          if (chunkData._decoded.length === 0) { // Check if _decoded is empty
            const c = chunkData.chunk;
            if (c) {
              const pairs = decodeRlePairsFromBuffer(Buffer.from(c.data as any));
              chunkData._decoded = c.encoding === 'rle-bool' ? rleDecodeToBooleans(pairs, chunkSize * chunkSize).map(b => b ? 1 : 0) : rleDecodeToNumbers(pairs, chunkSize * chunkSize);
            } else {
              chunkData._decoded = new Array(chunkSize * chunkSize).fill(0);
            }
          }

          let val = 0;
          if (erase) {
            val = 0;
          } else if (rawValues && rawValues.length > 0) {
            // Use values array if present
            const vy = y - rect.y0;
            const vx = x - rect.x0;
            const vIdx = vy * rectWidth + vx;
            val = rawValues[vIdx] || 0;
          } else {
            // Fallback to single tileRefId
            val = (tileRefId as number);
          }

          if (chunkData._decoded[idx] !== val) {
            chunkData._decoded[idx] = val;
            chunkData.modified = true;
          }
        }
      }

      // 2. Persist and Broadcast modified chunks
      const updates: any[] = [];
      const { rleEncodeNumbers, rleEncodeBooleans, encodeRlePairsToBuffer } = await import('./mapEncoding.js');
      const encoding = layerName === 'collision' ? 'rle-bool' : 'rle';

      for (const [key, data] of chunkUpdates.entries()) {
        if (!data.modified) continue;

        const chunkValues = data._decoded;
        const pairs = encoding === 'rle-bool'
          ? rleEncodeBooleans(chunkValues.map((v: number) => v !== 0))
          : rleEncodeNumbers(chunkValues);
        const buf = encodeRlePairsToBuffer(pairs);
        const u8 = new Uint8Array(buf);

        let chunk = chunks.get(key);
        if (!chunk) {
          chunk = await prisma.mapChunk.create({ data: { layerId: layer.id, x: data.cx, y: data.cy, version: 1, encoding, data: u8 } });
        } else {
          chunk = await prisma.mapChunk.update({ where: { id: chunk.id }, data: { version: chunk.version + 1, encoding, data: u8 } });
        }

        updates.push({ key, version: chunk.version, encoding: chunk.encoding, data: buf.toString('base64') });
      }

      // 3. Broadcast all updates in one go
      if (updates.length > 0) {
        // Broadcast via Presence (PubSub)
        const gameServer = (global as any).gameServer;
        if (gameServer && gameServer.presence) {
          try {
            gameServer.presence.publish(`map_update:${tenant.slug}`, {
              type: 'chunks_updated',
              payload: { map: name, layer: layerName, updates }
            });
          } catch (e: any) {
            logger.error('[Broadcast] presence publish failed', { error: e?.message || String(e) });
          }
        } else {
          // Fallback: iterate local rooms (legacy)
          const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
          for (const room of rooms) {
            try {
              room.broadcast('chunks_updated', { map: name, layer: layerName, updates });
            } catch (e: any) {
              try { logger.debug('[Broadcast] chunks_updated failed', { error: e?.message || String(e) }); } catch { }
            }
          }
        }
      }

      res.json({ updates });
    } catch (e: any) {
      logger.error('[Map] paint-rect failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.post('/maps/:name/tilesets', async (req: express.Request, res: express.Response) => {
    try {
      const schema = z.object({ key: z.string().min(1), imageUrl: z.string().min(1), tileWidth: z.number().int().positive(), tileHeight: z.number().int().positive(), margin: z.number().int().nonnegative().optional(), spacing: z.number().int().nonnegative().optional(), hash: z.string().optional() });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

      const name = req.params.name;
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });

      // Prüfe ob Tileset bereits existiert (nach key)
      const existing = await prisma.mapTileset.findFirst({ where: { mapId: map.id, key: parse.data.key } });
      if (existing) {
        // Bereits registriert - gebe 200 zurück ohne Fehler
        try { logger.debug('[Tilesets] already registered, skipping', { map: name, key: parse.data.key }); } catch { }
        const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
        return res.json(tilesets);
      }

      const last = await prisma.mapTileset.findFirst({ where: { mapId: map.id }, orderBy: { slot: 'desc' } });
      const newSlot = last ? last.slot + 1 : 0;
      await prisma.mapTileset.create({ data: { mapId: map.id, slot: newSlot, ...parse.data } });
      try { logger.info('[Tilesets] registry add', { map: name, slot: newSlot, key: parse.data.key, url: parse.data.imageUrl }); } catch { }

      const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });

      // Broadcast registry update (best-effort, mit Logging)
      // Broadcast registry update via Presence
      const gameServer = (global as any).gameServer;
      if (gameServer && gameServer.presence) {
        try {
          gameServer.presence.publish(`map_update:${tenant.slug}`, {
            type: 'tileset_registry_updated',
            payload: { map: name, tilesetRegistry: tilesets }
          });
        } catch (e: any) {
          logger.error('[Broadcast] presence publish registry failed', { error: e?.message || String(e) });
        }
      } else {
        const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
        for (const room of rooms) {
          try {
            room.broadcast('tileset_registry_updated', { map: name, tilesetRegistry: tilesets });
          } catch (e: any) {
            try { logger.debug('[Broadcast] tileset_registry_updated failed', { error: e?.message || String(e) }); } catch { }
          }
        }
      }

      res.json({ tilesetRegistry: tilesets });
    } catch (e: any) {
      // P2002 = Unique Constraint Violation (Race Condition bei slot)
      if (e?.code === 'P2002') {
        try { logger.warn('[Tilesets] duplicate slot (race condition), returning current registry'); } catch { }
        try {
          const name = req.params.name;
          const tenant = getTenantFromReq(req);
          if (tenant) {
            const map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
            if (map) {
              const tilesets = await prisma.mapTileset.findMany({ where: { mapId: map.id }, orderBy: { slot: 'asc' } });
              return res.json({ tilesetRegistry: tilesets });
            }
          }
        } catch { }
      }
      logger.error('[Tilesets] add failed', e);
      res.status(500).json({ error: 'internal_error' });
    }
  });

  app.get('/zones', async (req: express.Request, res: express.Response) => {
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const zones = await prisma.zone.findMany({ where: { tenantId: tenant.id } });
    res.json(zones);
  });

  // Editor: Save/Load Map State (authenticated)
  app.get('/maps/:name/editor-state', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    let map = await prisma.map.findFirst({ where: { name, tenantId: tenant.id } });
    if (!map) {
      map = await prisma.map.create({
        data: {
          name,
          meta: {},
          tenantId: tenant.id,
          width: 32,
          height: 32,
          tileWidth: 16,
          tileHeight: 16,
          chunkSize: 32
        }
      });
    }
    // meta speichert editor bezogene daten
    const meta = (map.meta as any) || {};
    try { logger.debug('[EditorState] GET', { map: name, tilesets: Array.isArray(meta.tilesets) ? meta.tilesets.length : 0, assets: Array.isArray(meta.assets) ? meta.assets.length : 0 }); } catch { }
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
      tilesets: meta.tilesets ?? [],
      assets: meta.assets ?? [],
      zones: await prisma.zone.findMany({ where: { mapId: map.id }, select: { id: true, name: true, capacity: true, polygon: true } }),
      backgroundColor: typeof meta.backgroundColor === 'string' ? meta.backgroundColor : null,
      spawn: (meta.spawn && typeof (meta.spawn as any).x === 'number' && typeof (meta.spawn as any).y === 'number') ? meta.spawn : null,
    });
  });

  app.put('/maps/:name/editor-state', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const name = req.params.name;
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const editorSchema = z.object({
      // v2-only: keine Layer-Arrays mehr, nur Meta
      tilesets: z.array(z.any()).optional(),
      assets: z.array(z.any()).optional(),
      zones: z.array(z.any()).optional(),
      backgroundColor: z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/).optional(),
      replaceZones: z.boolean().optional(),
      spawn: z.object({ x: z.number(), y: z.number() }).optional(),
    });
    const parse = editorSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid editor payload' });
    const { tilesets, assets, zones, backgroundColor, replaceZones, spawn } = parse.data;
    try { logger.debug('[EditorState] PUT', { map: name, tilesets: Array.isArray(tilesets) ? tilesets.length : undefined, assets: Array.isArray(assets) ? assets.length : undefined, zones: Array.isArray(zones) ? zones.length : undefined, spawn: !!spawn }); } catch { }
    const found = await prisma.map.findFirst({ where: { name, tenantId: tenant.id }, include: { rooms: true } });
    const map = found ?? await prisma.map.create({
      data: {
        name,
        meta: {},
        tenantId: tenant.id,
        width: 32,
        height: 32,
        tileWidth: 16,
        tileHeight: 16,
        chunkSize: 32
      }
    });
    // Ensure there is at least one room for this map (for zone assignment)
    let roomForZones = await prisma.room.findFirst({ where: { mapId: map.id }, orderBy: { createdAt: 'asc' } });
    if (!roomForZones) {
      const lobbyId = `${map.id}:lobby`;
      try {
        roomForZones = await prisma.room.create({ data: { id: lobbyId, name: 'lobby', mapId: map.id, tenantId: tenant.id } });
      } catch {
        // Fallback: try to find again without assuming custom id
        roomForZones = await prisma.room.findFirst({ where: { mapId: map.id } });
      }
    }
    // Update meta blobs - v2-only: keine Layer-Arrays mehr
    const currentMeta = (map.meta as any) || {};
    await prisma.map.update({
      where: { id: map.id },
      data: {
        meta: {
          ...currentMeta,
          tilesets: tilesets ?? currentMeta.tilesets ?? [],
          assets: assets ?? currentMeta.assets ?? [],
          backgroundColor: backgroundColor ?? currentMeta.backgroundColor ?? undefined,
          spawn: spawn ?? currentMeta.spawn ?? undefined,
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
        } catch { }
        if (Array.isArray(polygon) && polygon.length > 0) {
          prepared.push({ name, capacity, polygon });
        }
      }
      // Only mutate DB if there is at least one valid polygon OR explicit replaceZones=true OR the input list was explicitly empty (clearing all zones)
      const shouldUpdate = (zones.length === 0) || (prepared.length > 0) || (replaceZones === true);
      if (shouldUpdate) {
        await prisma.zone.deleteMany({ where: { mapId: map.id } });
        for (const z of prepared) {
          await prisma.zone.create({ data: { name: z.name, capacity: z.capacity ?? undefined, polygon: z.polygon, mapId: map.id, roomId: roomForZones?.id as string, tenantId: tenant.id } as any });
        }
      }
    }
    // Broadcast spawn update to active rooms (best-effort)
    if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
      const gameServer = (global as any).gameServer;
      if (gameServer && gameServer.presence) {
        try {
          gameServer.presence.publish(`map_update:${tenant.slug}`, {
            type: 'editor_update',
            payload: { type: 'spawn', pos: { x: spawn.x, y: spawn.y } }
          });
        } catch { }
      } else {
        try {
          const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
          for (const room of rooms) {
            try { room.broadcast('editor_update', { type: 'spawn', pos: { x: spawn.x, y: spawn.y } }); } catch { }
            try { if (typeof room.setDefaultSpawn === 'function') room.setDefaultSpawn({ x: spawn.x, y: spawn.y }); } catch { }
          }
        } catch { }
      }
    }

    // Broadcast generic 'all' update if significant changes occurred (zones, assets, tilesets, bg)
    if (tilesets || assets || zones || backgroundColor || replaceZones) {
      const gameServer = (global as any).gameServer;
      if (gameServer && gameServer.presence) {
        try {
          gameServer.presence.publish(`map_update:${tenant.slug}`, {
            type: 'editor_update',
            payload: { type: 'all', map: name }
          });
        } catch (e: any) {
          logger.error('[Broadcast] presence publish editor_update failed', { error: e?.message || String(e) });
        }
      } else {
        try {
          const rooms: any[] = Array.from(((global as any).activeWorldRooms || new Set()).values());
          for (const room of rooms) {
            try {
              // Broadcast 'all' so clients re-fetch the complete editor state
              room.broadcast('editor_update', { type: 'all', map: name });
            } catch (e: any) {
              try { logger.debug('[Broadcast] editor_update all failed', { error: e?.message || String(e) }); } catch { }
            }
          }
        } catch { }
      }
    }

    res.json({ ok: true });
  });

  // Admin: Zonen löschen (einzeln oder alle)
  app.delete('/maps/:name/zones', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden - admin required' });
    }
    const mapName = req.params.name || 'office';
    const zoneName = req.query.name as string | undefined; // Optional: nur bestimmte Zone löschen
    const zoneId = req.query.id as string | undefined;
    
    try {
      const map = await prisma.map.findFirst({ where: { name: mapName, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });
      
      let deleted = 0;
      if (zoneId) {
        // Einzelne Zone nach ID löschen
        const result = await prisma.zone.deleteMany({ where: { id: zoneId, mapId: map.id } });
        deleted = result.count;
      } else if (zoneName) {
        // Alle Zonen mit diesem Namen löschen
        const result = await prisma.zone.deleteMany({ where: { name: zoneName, mapId: map.id } });
        deleted = result.count;
      } else {
        // Alle Zonen der Map löschen
        const result = await prisma.zone.deleteMany({ where: { mapId: map.id } });
        deleted = result.count;
      }
      
      logger.info('[Zones] Deleted zones', { map: mapName, zoneName, zoneId, deleted });
      res.json({ ok: true, deleted });
    } catch (e) {
      logger.error('[Zones] Delete failed', e);
      res.status(500).json({ error: 'delete failed' });
    }
  });

  // Admin: Alle Zonen einer Map auflisten
  app.get('/maps/:name/zones', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const mapName = req.params.name || 'office';
    
    try {
      const map = await prisma.map.findFirst({ where: { name: mapName, tenantId: tenant.id } });
      if (!map) return res.status(404).json({ error: 'map not found' });
      
      const zones = await prisma.zone.findMany({ where: { mapId: map.id } });
      res.json(zones.map(z => ({ id: z.id, name: z.name, capacity: z.capacity, polygon: z.polygon })));
    } catch (e) {
      logger.error('[Zones] List failed', e);
      res.status(500).json({ error: 'list failed' });
    }
  });

  // Profile update (authenticated)
  app.patch('/me', async (req: express.Request, res: express.Response) => {
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
  app.get('/invites', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const list = await prisma.invite.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
    res.json(list);
  });

  app.delete('/invites/:code', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const code = req.params.code;
    try {
      const inv = await prisma.invite.findUnique({ where: { code } });
      if (!inv || (inv as any).tenantId !== tenant.id) return res.status(404).json({ error: 'not found' });
      if (inv.usedAt) return res.status(400).json({ error: 'already used' });
      await prisma.invite.delete({ where: { code } });
      res.json({ ok: true });
    } catch {
      res.status(400).json({ error: 'delete failed' });
    }
  });

  app.get('/livekit/url', async (_req: express.Request, res: express.Response) => {
    // Return configured public LiveKit URL for clients
    // Use LIVEKIT_EXTERNAL_URL for external clients (Tauri), fallback to LIVEKIT_URL
    const url = process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || '';
    res.json({ url });
  });

  app.post('/livekit/token', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({ roomName: z.string().min(1), identity: z.string().min(1), name: z.string().optional(), canPublish: z.boolean().optional(), canSubscribe: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'roomName and identity required' });
    const { roomName, identity, name, canPublish, canSubscribe } = parse.data;
    try {
      const corrId = (req.headers['x-correlation-id'] || '').toString();
      const hdrIdentity = (req.headers['x-av-identity'] || '').toString();
      const hdrRoom = (req.headers['x-av-room'] || '').toString();
      try {
        logger.info({ event: 'livekit.token.request', correlationId: corrId || undefined, roomName: roomName || hdrRoom || undefined, identity: identity || hdrIdentity || undefined, ua: (req.headers['user-agent'] || '').toString() });
      } catch { }
      if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
        return res.status(500).json({ error: 'livekit not configured' });
      }
      const tenant = getTenantFromReq(req);
      if (!tenant) return res.status(400).json({ error: 'tenant_required' });
      const roomNameWithTenant = `${tenant.slug}:${roomName}`;
      const token = await createLivekitToken({ roomName: roomNameWithTenant, identity, name, canPublish, canPublishData: true, canSubscribe });
      res.type('text/plain').send(token);
    } catch (e: any) {
      logger.error({ event: 'livekit.token.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'failed to create token' });
    }
  });

  // Client-reported WebRTC/LiveKit stats (RUM)
  app.post('/av/stats', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const schema = z.object({
      roomName: z.string().min(1),
      identity: z.string().min(1),
      // optional numeric metrics in base units
      rttMs: z.number().nonnegative().optional(),
      jitterMs: z.number().nonnegative().optional(),
      inboundBitrateBps: z.number().nonnegative().optional(),
      outboundBitrateBps: z.number().nonnegative().optional(),
      packetLossRatio: z.number().min(0).max(1).optional(),
      connectionState: z.string().optional(),
      dtlsState: z.string().optional(),
      iceState: z.string().optional(),
      nRemoteAudio: z.number().int().nonnegative().optional(),
      nRemoteVideo: z.number().int().nonnegative().optional(),
      nLocalAudio: z.number().int().nonnegative().optional(),
      nLocalVideo: z.number().int().nonnegative().optional(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid stats payload' });
    const p = parse.data;
    try {
      // Observations (no high-cardinality labels)
      livekitSamples.inc();
      if (typeof p.rttMs === 'number' && Number.isFinite(p.rttMs)) {
        livekitRttSeconds.observe(p.rttMs / 1000);
      }
      if (typeof p.jitterMs === 'number' && Number.isFinite(p.jitterMs)) {
        livekitJitterSeconds.observe(p.jitterMs / 1000);
      }
      if (typeof p.inboundBitrateBps === 'number' && Number.isFinite(p.inboundBitrateBps)) {
        livekitInboundBitrateBps.observe(p.inboundBitrateBps);
      }
      if (typeof p.outboundBitrateBps === 'number' && Number.isFinite(p.outboundBitrateBps)) {
        livekitOutboundBitrateBps.observe(p.outboundBitrateBps);
      }
      if (typeof p.packetLossRatio === 'number' && Number.isFinite(p.packetLossRatio)) {
        livekitPacketLossRatio.observe(p.packetLossRatio);
      }
      // Best-effort structured log for correlation
      try { logger.debug({ event: 'av.stats', roomName: p.roomName, identity: p.identity, connectionState: p.connectionState, dtlsState: p.dtlsState, iceState: p.iceState }); } catch { }
      return res.json({ ok: true });
    } catch (e) {
      logger.error({ event: 'av.stats.error', error: (e as any)?.message || String(e) });
      return res.status(500).json({ error: 'stats ingest failed' });
    }
  });

  // ========================
  // Billing (Stripe) - Skeleton
  // ========================
  app.post('/billing/checkout-session', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (tenant.isInternal || tenant.bypassLimits) return res.status(400).json({ error: 'billing_not_applicable' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const schema = z.object({ priceId: z.string().min(3).optional(), plan: z.string().min(1).optional(), returnUrl: z.string().url().optional() }).refine(v => !!(v.priceId || v.plan), { message: 'priceId or plan required' });
      const parse = schema.safeParse(req.body || {});
      if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
      const priceId = parse.data.priceId || process.env[`STRIPE_PRICE_${(parse.data.plan || '').toUpperCase()}` as any];
      if (!priceId) return res.status(400).json({ error: 'price_not_configured' });

      // Ensure Stripe customer for tenant
      let tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      let customerId = (tenantRec as any)?.stripeCustomerId || null;
      if (!customerId) {
        const customer = await stripe.customers.create({
          name: tenantRec?.name || tenant.slug,
          metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
        });
        customerId = customer.id;
        await prisma.tenant.update({ where: { id: tenant.id }, data: { stripeCustomerId: customerId } });
      }

      const origin = (req.headers.origin as string) || (req.headers.referer as string) || process.env.BILLING_PUBLIC_URL || '';
      const successUrl = (parse.data.returnUrl || origin || '').replace(/\/$/, '') + '/billing/success';
      const cancelUrl = (parse.data.returnUrl || origin || '').replace(/\/$/, '') + '/billing/cancel';

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: tenant.id,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          metadata: { tenantId: tenant.id, tenantSlug: tenant.slug },
        },
        allow_promotion_codes: true,
      });
      return res.json({ url: session.url });
    } catch (e: any) {
      logger.error({ event: 'billing.checkout.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'checkout_failed' });
    }
  });

  app.post('/billing/portal-session', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    if (tenant.isInternal || tenant.bypassLimits) return res.status(400).json({ error: 'billing_not_applicable' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const tenantRec = await prisma.tenant.findUnique({ where: { id: tenant.id } });
      const customerId = (tenantRec as any)?.stripeCustomerId;
      if (!customerId) return res.status(400).json({ error: 'no_customer' });
      const origin = (req.headers.origin as string) || (req.headers.referer as string) || process.env.BILLING_PUBLIC_URL || '';
      const returnUrl = (origin || '').replace(/\/$/, '') + '/billing/account';
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
      return res.json({ url: session.url });
    } catch (e: any) {
      logger.error({ event: 'billing.portal.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'portal_failed' });
    }
  });

  app.post('/billing/webhook', async (req: express.Request, res: express.Response) => {
    if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const sig = req.headers['stripe-signature'] as string;
      const raw = (req as any).body as Buffer;
      const event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);

      async function applyLimitFromSubscription(sub: Stripe.Subscription) {
        let tenantId = (sub.metadata as any)?.tenantId as string | undefined;
        let customerId = (sub.customer as any) as string | undefined;
        let limit = 0;
        try {
          const items = (sub.items?.data || []) as any[];
          const first = items[0];
          const price: any = first?.price;
          const m = (price?.metadata || {}) as Record<string, string>;
          const pM = (price?.product?.metadata || {}) as Record<string, string>;
          const metaLimit = Number(m.concurrent_limit || pM.concurrent_limit || 0);
          limit = Number.isFinite(metaLimit) && metaLimit > 0 ? metaLimit : 0;
        } catch { }
        // Fallback: keep existing limit if no metadata
        if (!tenantId && customerId) {
          const t = await prisma.tenant.findFirst({ where: { stripeCustomerId: customerId } });
          if (t) tenantId = t.id;
        }
        if (!tenantId) return;
        const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
        if (!t) return;
        await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId ?? t.stripeCustomerId ?? undefined, stripeSubscriptionId: (sub.id || undefined) as any, status: (sub.status || t.status || null) as any, concurrentLimit: limit > 0 ? limit : t.concurrentLimit } });
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const s = event.data.object as Stripe.Checkout.Session;
          const subId = (s.subscription as any) as string | undefined;
          const customerId = (s.customer as any) as string | undefined;
          const tenantId = (s.client_reference_id as string) || (s.metadata as any)?.tenantId;
          if (tenantId) {
            await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId ?? undefined, stripeSubscriptionId: subId ?? undefined } });
          }
          if (subId) {
            const sub = await stripe.subscriptions.retrieve(subId, { expand: ['items.data.price.product'] });
            await applyLimitFromSubscription(sub);
          }
          break;
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object as Stripe.Subscription;
          // Ensure product expanded is available
          if (!(sub.items?.data?.[0]?.price as any)?.product?.metadata) {
            const full = await stripe.subscriptions.retrieve(sub.id, { expand: ['items.data.price.product'] });
            await applyLimitFromSubscription(full);
          } else {
            await applyLimitFromSubscription(sub);
          }
          break;
        }
        case 'customer.subscription.deleted': {
          const sub = event.data.object as Stripe.Subscription;
          const tenantId = (sub.metadata as any)?.tenantId as string | undefined;
          if (tenantId) {
            try { await prisma.tenant.update({ where: { id: tenantId }, data: { concurrentLimit: 0 } }); } catch { }
          } else {
            const customerId = (sub.customer as any) as string | undefined;
            if (customerId) { try { await prisma.tenant.updateMany({ where: { stripeCustomerId: customerId }, data: { concurrentLimit: 0 } }); } catch { } }
          }
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (e: any) {
      logger.error({ event: 'billing.webhook.error', error: e?.message || String(e) });
      return res.status(400).send('webhook error');
    }
  });

  // ========================
  // Admin: Tenants (platform-level) – protected by internal:owner
  // ========================
  app.get('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const list = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const usage = computeOnlineUsageByTenantSlug();
    const out = list.map((t: any) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      concurrentLimit: t.concurrentLimit,
      freeSeats: (t as any).freeSeats ?? 0,
      bypassLimits: !!t.bypassLimits,
      isInternal: !!t.isInternal,
      status: t.status || null,
      stripeCustomerId: t.stripeCustomerId || null,
      stripeSubscriptionId: t.stripeSubscriptionId || null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      online: usage[t.slug] || 0,
    }));
    res.json(out);
  });

  app.post('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({ slug: z.string().min(2).max(64), name: z.string().min(1), concurrentLimit: z.number().int().nonnegative().default(50), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const freeDefault = typeof parse.data.freeSeats === 'number' ? parse.data.freeSeats : await getDefaultFreeSeats();
      const t = await prisma.tenant.create({ data: { slug: parse.data.slug.toLowerCase(), name: parse.data.name, concurrentLimit: parse.data.concurrentLimit, freeSeats: freeDefault, bypassLimits: !!parse.data.bypassLimits } });
      res.json({ id: t.id });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'slug_exists' });
      return res.status(400).json({ error: 'create_failed' });
    }
  });

  app.patch('/admin/tenants/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const id = req.params.id;
    const schema = z.object({ name: z.string().min(1).optional(), concurrentLimit: z.number().int().nonnegative().optional(), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional(), status: z.string().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const t = await prisma.tenant.update({ where: { id }, data: { name: parse.data.name ?? undefined, concurrentLimit: parse.data.concurrentLimit ?? undefined, freeSeats: parse.data.freeSeats ?? undefined, bypassLimits: parse.data.bypassLimits ?? undefined, status: parse.data.status ?? undefined } });
      res.json({ ok: true, id: t.id });
    } catch (e) {
      res.status(400).json({ error: 'update_failed' });
    }
  });

  // ========================
  // Admin: Billing (Stripe) – products, prices, KPIs
  // ========================
  app.get('/admin/billing/products', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const prods = await stripe.products.list({ limit: 100, expand: ['data.default_price'] });
      const prices = await stripe.prices.list({ limit: 100, expand: ['data.product'] });
      const priceByProduct = new Map<string, any[]>();
      for (const p of prices.data) {
        const pid = (typeof p.product === 'string') ? p.product : (p.product as any).id;
        const arr = priceByProduct.get(pid) || [];
        arr.push({
          id: p.id,
          unitAmount: p.unit_amount,
          currency: p.currency,
          recurring: (p.recurring || null),
          active: p.active,
          metadata: p.metadata || {},
        });
        priceByProduct.set(pid, arr);
      }
      const out = prods.data.map(pr => ({
        id: pr.id,
        name: pr.name,
        description: pr.description || null,
        active: pr.active,
        metadata: pr.metadata || {},
        prices: priceByProduct.get(pr.id) || [],
      }));
      res.json(out);
    } catch (e: any) {
      logger.error({ event: 'admin.billing.products.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'failed_to_list_products' });
    }
  });

  app.post('/admin/billing/products', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ name: z.string().min(1), description: z.string().optional(), amount: z.number().int().nonnegative(), currency: z.string().default('eur'), interval: z.enum(['month', 'year']).default('month'), concurrentLimit: z.number().int().positive() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const product = await stripe.products.create({ name: parse.data.name, description: parse.data.description, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      const price = await stripe.prices.create({ product: product.id, unit_amount: parse.data.amount, currency: parse.data.currency, recurring: { interval: parse.data.interval }, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      res.json({ id: product.id, priceId: price.id });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.products.create.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'create_failed' });
    }
  });

  app.post('/admin/billing/products/:id/prices', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ amount: z.number().int().nonnegative(), currency: z.string().default('eur'), interval: z.enum(['month', 'year']).default('month'), concurrentLimit: z.number().int().positive() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const price = await stripe.prices.create({ product: req.params.id, unit_amount: parse.data.amount, currency: parse.data.currency, recurring: { interval: parse.data.interval }, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      res.json({ id: price.id });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.price.create.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'create_failed' });
    }
  });

  app.patch('/admin/billing/products/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), active: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const pr = await stripe.products.update(req.params.id, { name: parse.data.name ?? undefined, description: parse.data.description ?? undefined, active: parse.data.active ?? undefined });
      res.json({ id: pr.id, active: pr.active });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.product.update.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  app.patch('/admin/billing/prices/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ active: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const price = await stripe.prices.update(req.params.id, { active: parse.data.active ?? undefined });
      res.json({ id: price.id, active: price.active });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.price.update.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  app.get('/admin/billing/metrics', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const subs = await stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items.data.price.product'] });
      const now = Date.now();
      const last30 = now - 30 * 24 * 60 * 60 * 1000;
      let activeCount = 0;
      let mrrCents = 0;
      let revenue30dCents = 0;
      for (const s of subs.data) {
        const isActive = ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status as any);
        if (isActive) activeCount++;
        const it = s.items?.data?.[0];
        const price: any = it?.price;
        const amount = Number(price?.unit_amount || 0);
        const interval = price?.recurring?.interval || 'month';
        if (interval === 'month') mrrCents += amount;
        if (s.current_period_start && s.status === 'active' && s.current_period_start * 1000 >= last30) {
          revenue30dCents += amount;
        }
      }
      res.json({ activeSubscriptions: activeCount, mrrCents, revenue30dCents });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.metrics.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'metrics_failed' });
    }
  });

  // Public signup: create tenant + owner user and sign in
  app.post('/public/tenants', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(100), email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const slug = parse.data.slug.toLowerCase();
    try {
      const exists = await prisma.tenant.findUnique({ where: { slug } });
      if (exists) return res.status(400).json({ error: 'slug_exists' });
      const freeDefault = await getDefaultFreeSeats();
      const tenant = await prisma.tenant.create({ data: { slug, name: parse.data.name, concurrentLimit: 0, freeSeats: freeDefault, bypassLimits: false } });
      const email = normalizeEmailForStorage(parse.data.email);
      const hash = await bcrypt.hash(parse.data.password, 10);
      let user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
      if (!user) {
        user = await prisma.user.create({ data: { email, name: parse.data.name, passwordHash: hash, emailVerifiedAt: new Date() } });
      }
      await prisma.membership.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: (user as any).id } } as any, update: { role: 'owner' as any }, create: { tenantId: tenant.id, userId: (user as any).id, role: 'owner' as any } });
      const token = jwt.sign({ sub: (user as any).id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
      setAuthCookie(res, token);
      return res.json({ ok: true, tenant: { id: tenant.id, slug: tenant.slug, freeSeats: tenant.freeSeats }, user: { id: (user as any).id, email: (user as any).email } });
    } catch (e: any) {
      logger.error({ event: 'public.signup.error', error: e?.message || String(e) });
      return res.status(400).json({ error: 'signup_failed' });
    }
  });

  // Presence (recent)
  registerPresenceRoutes(app, prisma, requireAuth, getTenantFromReq);

  // Users
  registerUserRoutes(app, prisma, requireAuth, getTenantFromReq);

  // API Tokens management (session-authenticated)
  registerApiTokenRoutes(app, prisma, requireAuth, API_TOKEN_PEPPER);

  // Controls
  registerControlRoutes(app, requireAuth, requireApiToken);

  // Debug endpoint for Colyseus rooms
  app.get('/debug/rooms', async (_req: express.Request, res: express.Response) => {
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
