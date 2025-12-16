import type express from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  getJwtSecret,
  setAuthCookie,
  requireAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
  normalizeEmailForMatching,
} from '../utils/authHelpers.js';

export function registerAuthRoutes(app: express.Application, prisma: PrismaClient) {
  // Auth Endpoints
  app.post('/auth/invite', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
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
    res.clearCookie('auth_token', { path: '/' });
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
      const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
      if (internal) {
        const internalMember = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: internal.id, userId: auth.userId } } as any });
        isInternalOwner = (internalMember as any)?.role === 'owner';
      }
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
}
