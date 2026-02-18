import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
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
import { getEmailService, emailTemplates } from '../../services/email.js';

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
    const inv = await prisma.invite.create({ data: { code, email: normalizedEmail, createdBy: auth.userId, tenantId: tenant.id, role: allowedRole } });
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
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      return res.status(400).json({ error: 'registration failed' });
    }
    await prisma.invite.update({ where: { code }, data: { usedAt: new Date(), usedById: user.id } });
    // Create membership in invite's tenant
    try {
      if (invite.tenantId) {
        await prisma.membership.upsert({
          where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } },
          update: {},
          create: { tenantId: invite.tenantId, userId: user.id, role: invite.role || 'member' },
        });
      }
    } catch { }
    const token = jwt.sign({ sub: user.id, tid: invite.tenantId }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, token);

    // Create session record for session management
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const userAgent = req.headers['user-agent'] || null;
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          userAgent,
          ipAddress,
          expiresAt,
        }
      });
    } catch (e) {
      logger.warn({ event: 'auth.register.session_create_failed', userId: user.id, error: String(e) });
    }

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
    const membership = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } } });
    if (!membership) return res.status(403).json({ error: 'not_member_of_tenant' });
    const token = jwt.sign({ sub: user.id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, token);

    // Create session record for session management
    try {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const userAgent = req.headers['user-agent'] || null;
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          userAgent,
          ipAddress,
          expiresAt,
        }
      });
    } catch (e) {
      // Session tracking is non-critical, don't fail login
      logger.warn({ event: 'auth.login.session_create_failed', userId: user.id, error: String(e) });
    }

    // Return token in body for Tauri/native clients that can't use cookies
    const origin = req.headers.origin || '';
    const isTauri = origin.startsWith('tauri://');
    res.json({ id: user.id, email: user.email, name: user.name, ...(isTauri && { token }) });
  });

  app.post('/auth/logout', async (req: express.Request, res: express.Response) => {
    // Delete session from database if exists
    try {
      const currentToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
      if (currentToken) {
        const tokenHash = crypto.createHash('sha256').update(currentToken).digest('hex');
        await prisma.session.deleteMany({ where: { tokenHash } });
      }
    } catch (e) {
      // Non-critical, continue with logout
      logger.warn({ event: 'auth.logout.session_delete_failed', error: String(e) });
    }

    res.clearCookie('auth_token', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/auth/me', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const member = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: tenant.id, userId: auth.userId } } });
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
        const internalMember = await prisma.membership.findUnique({ where: { tenantId_userId: { tenantId: internal.id, userId: auth.userId } } });
        isInternalOwner = internalMember?.role === 'owner';
      }
    } catch { }
    const lastPosition = user.presences[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarId: user.avatarId || null,
      isInternalOwner,
      lastPosition: lastPosition ? { x: lastPosition.x, y: lastPosition.y, direction: lastPosition.direction, mapName: lastPosition.mapName || null } : null
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
        roomId: z.string().optional(),
        mapName: z.string().optional(),
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
          data: { x, y, direction, ...(parse.data.mapName ? { mapName: parse.data.mapName } : {}) }
        });
      } else {
        await prisma.presence.create({
          data: { userId: auth.userId, roomId: room.id, tenantId: tenant.id, x, y, direction, ...(parse.data.mapName ? { mapName: parse.data.mapName } : {}) }
        });
      }

      // Best-effort WS push: presence_update for this tenant
      try {
        const globalScope = global as { activeWorldRooms?: Set<{ metadata?: { tenant?: string }; broadcast?: (event: string, data: unknown) => void }> };
        const rooms = Array.from((globalScope.activeWorldRooms || new Set()).values());
        for (const r of rooms) {
          const meta = r.metadata || {};
          if (meta && meta.tenant && meta.tenant !== tenant.slug) continue;
          try {
            r.broadcast?.('presence_update', {
              userId: auth.userId,
              x, y, direction,
              updatedAt: new Date().toISOString(),
            });
          } catch { }
        }
      } catch { }

      res.json({ ok: true });
    } catch (e: unknown) {
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
    // Always return ok to prevent email enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 30);
    await prisma.passwordReset.create({ data: { token, userId: user.id, expiresAt } });

    // Send password reset email
    const tenant = getTenantFromReq(req);
    const baseUrl = process.env.BILLING_PUBLIC_URL || req.headers.origin || `https://${tenant?.slug || 'app'}.meetropolis.de`;
    const resetUrl = `${baseUrl}/#/reset?token=${token}&email=${encodeURIComponent(email)}`;

    const emailService = getEmailService();
    const emailContent = emailTemplates.resetPassword({
      name: user.name || '',
      resetUrl,
    });
    emailContent.to = email;

    // Send email asynchronously (don't block response)
    emailService.send(emailContent).catch((e) => {
      logger.error({ event: 'auth.forgot.email_failed', userId: user.id, error: String(e) });
    });

    // In dev mode, also return token for testing (remove in production)
    const isDev = process.env.NODE_ENV !== 'production';
    res.json({ ok: true, ...(isDev && { token }) });
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

  // Request email verification
  app.post('/auth/verify/request', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const user = await prisma.user.findUnique({ where: { id: auth.userId } });
      if (!user) return res.status(404).json({ error: 'user not found' });

      // Check if already verified
      if (user.emailVerifiedAt) {
        return res.json({ ok: true, alreadyVerified: true });
      }

      // Check for recent verification request (rate limit: 1 per 2 minutes)
      const recent = await prisma.emailVerification.findFirst({
        where: {
          userId: user.id,
          createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) }
        }
      });
      if (recent) {
        return res.status(429).json({ error: 'Please wait before requesting another verification email' });
      }

      // Create verification token
      const token = crypto.randomBytes(24).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await prisma.emailVerification.create({
        data: {
          token,
          userId: user.id,
          email: user.email,
          expiresAt,
        }
      });

      // Send verification email
      const tenant = getTenantFromReq(req);
      const baseUrl = process.env.BILLING_PUBLIC_URL || req.headers.origin || `https://${tenant?.slug || 'app'}.meetropolis.de`;
      const verifyUrl = `${baseUrl}/#/verify?token=${token}`;

      const emailService = getEmailService();
      const emailContent = emailTemplates.verifyEmail({
        name: user.name || '',
        verifyUrl,
      });
      emailContent.to = user.email;

      emailService.send(emailContent).catch((e) => {
        logger.error({ event: 'auth.verify.email_failed', userId: user.id, error: String(e) });
      });

      // In dev mode, also return token for testing
      const isDev = process.env.NODE_ENV !== 'production';
      res.json({ ok: true, ...(isDev && { token }) });
    } catch (e: unknown) {
      logger.error({ event: 'auth.verify.request_failed', error: String(e) });
      return res.status(500).json({ error: 'verification request failed' });
    }
  });

  // Verify email with token
  app.post('/auth/verify', async (req, res) => {
    const schema = z.object({ token: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'token required' });

    const { token } = parse.data;

    try {
      const verification = await prisma.emailVerification.findUnique({ where: { token } });
      if (!verification) return res.status(400).json({ error: 'invalid token' });
      if (verification.usedAt) return res.status(400).json({ error: 'token already used' });
      if (verification.expiresAt < new Date()) return res.status(400).json({ error: 'token expired' });

      // Mark verification as used
      await prisma.emailVerification.update({
        where: { token },
        data: { usedAt: new Date() }
      });

      // Update user's email verified status
      await prisma.user.update({
        where: { id: verification.userId },
        data: { emailVerifiedAt: new Date() }
      });

      logger.info({ event: 'auth.verify.success', userId: verification.userId });
      res.json({ ok: true, message: 'Email verified successfully' });
    } catch (e: unknown) {
      logger.error({ event: 'auth.verify.failed', error: String(e) });
      return res.status(500).json({ error: 'verification failed' });
    }
  });

  // Get verification status
  app.get('/auth/verify/status', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { email: true, emailVerifiedAt: true }
      });
      if (!user) return res.status(404).json({ error: 'user not found' });

      res.json({
        email: user.email,
        verified: !!user.emailVerifiedAt,
        verifiedAt: user.emailVerifiedAt?.toISOString() || null,
      });
    } catch (e: unknown) {
      return res.status(500).json({ error: 'status check failed' });
    }
  });

  // =============================================================================
  // Session Management
  // =============================================================================

  // List all active sessions for current user
  app.get('/auth/sessions', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      // Clean up expired sessions first
      await prisma.session.deleteMany({
        where: {
          userId: auth.userId,
          expiresAt: { lt: new Date() }
        }
      });

      const sessions = await prisma.session.findMany({
        where: { userId: auth.userId },
        orderBy: { lastActiveAt: 'desc' },
        select: {
          id: true,
          userAgent: true,
          ipAddress: true,
          lastActiveAt: true,
          createdAt: true,
          tokenHash: true,
        }
      });

      // Determine current session by comparing token hash
      const currentToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
      let currentSessionId: string | null = null;
      if (currentToken) {
        const currentHash = crypto.createHash('sha256').update(currentToken).digest('hex');
        const currentSession = sessions.find(s => s.tokenHash === currentHash);
        currentSessionId = currentSession?.id || null;
      }

      res.json({
        sessions: sessions.map(s => ({
          id: s.id,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          lastActiveAt: s.lastActiveAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
          isCurrent: s.id === currentSessionId,
        })),
        currentSessionId,
      });
    } catch (e: unknown) {
      logger.error({ event: 'auth.sessions.list_failed', error: String(e) });
      return res.status(500).json({ error: 'failed to list sessions' });
    }
  });

  // Revoke a specific session
  app.delete('/auth/sessions/:id', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const sessionId = req.params.id;

    try {
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== auth.userId) {
        return res.status(404).json({ error: 'session not found' });
      }

      await prisma.session.delete({ where: { id: sessionId } });

      logger.info({ event: 'auth.session.revoked', userId: auth.userId, sessionId });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'auth.session.revoke_failed', error: String(e) });
      return res.status(500).json({ error: 'failed to revoke session' });
    }
  });

  // Revoke all sessions except current
  app.delete('/auth/sessions', async (req, res) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      // Determine current session
      const currentToken = req.cookies?.auth_token || req.headers.authorization?.replace('Bearer ', '');
      let currentHash: string | null = null;
      if (currentToken) {
        currentHash = crypto.createHash('sha256').update(currentToken).digest('hex');
      }

      // Delete all sessions except current
      const result = await prisma.session.deleteMany({
        where: {
          userId: auth.userId,
          ...(currentHash ? { tokenHash: { not: currentHash } } : {}),
        }
      });

      logger.info({ event: 'auth.sessions.revoked_all', userId: auth.userId, count: result.count });
      res.json({ ok: true, revokedCount: result.count });
    } catch (e: unknown) {
      logger.error({ event: 'auth.sessions.revoke_all_failed', error: String(e) });
      return res.status(500).json({ error: 'failed to revoke sessions' });
    }
  });
}
