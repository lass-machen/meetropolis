import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  getJwtSecret,
  setAuthCookie,
  requireAuth,
  getTenantFromReq,
  requireMembership,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { getTenancyModule } from '../../tenancyLoader.js';
import { getEmailService, emailTemplates } from '../../services/email.js';

export function registerGuestRoutes(app: express.Application, prisma: PrismaClient) {
  // =========================================================================
  // POST /guests — Create a guest invitation
  // =========================================================================
  app.post('/guests', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Enterprise gate
    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      return res.status(403).json({ error: 'enterprise_required' });
    }

    const schema = z.object({
      email: z.string().email(),
      name: z.string().min(1).optional(),
      expiresAt: z.string(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'email and expiresAt required' });

    const { email, name, expiresAt: expiresAtStr } = parse.data;
    const expiresAt = new Date(expiresAtStr);
    if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now() + 60 * 60 * 1000) {
      return res.status(400).json({ error: 'expiresAt must be at least 1 hour in the future' });
    }

    const normalizedEmail = normalizeEmailForStorage(email);

    // Find or create user
    let user = await prisma.user.findFirst({ where: { email: { equals: normalizedEmail, mode: 'insensitive' } } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          name: name || null,
          passwordHash: null,
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Check user does not have membership in another tenant
    const existingMembership = await prisma.membership.findFirst({
      where: { userId: user.id, tenantId: { not: tenant.id } },
    });
    if (existingMembership) {
      return res.status(400).json({ error: 'user_has_other_membership' });
    }

    // Check for existing membership in this tenant
    let guestMembership = await prisma.membership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
    });

    if (guestMembership) {
      // If they already have a non-guest role, don't overwrite
      if ((guestMembership as any).role !== 'guest') {
        return res.status(400).json({ error: 'user_already_member' });
      }
      // Update existing guest membership expiry
      guestMembership = await prisma.membership.update({
        where: { id: guestMembership.id },
        data: { expiresAt },
      });
      // Delete old token if exists
      await prisma.guestToken.deleteMany({ where: { membershipId: guestMembership.id } });
    } else {
      guestMembership = await prisma.membership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: 'guest',
          expiresAt,
        },
      });
    }

    // Generate token
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    await prisma.guestToken.create({
      data: {
        token: tokenHash,
        membershipId: guestMembership.id,
        expiresAt,
      },
    });

    // Build magic link
    const tenantRecord = await prisma.tenant.findUnique({ where: { id: tenant.id } });
    const slug = tenantRecord?.slug || tenant.slug;
    const magicLink = `https://${slug}.meetropolis.de/#/guest?token=${rawToken}`;

    // Send email
    const inviter = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true, email: true } });
    const inviterName = inviter?.name || inviter?.email || 'Someone';
    const tenantName = tenantRecord?.name || slug;

    const emailContent = emailTemplates.guestInvite({
      inviterName,
      tenantName,
      guestName: name || user.name || '',
      magicLinkUrl: magicLink,
      expiresAt: expiresAt.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    });
    emailContent.to = normalizedEmail;

    const emailService = getEmailService();
    emailService.send(emailContent).catch((e) => {
      logger.error({ event: 'guest.invite.email_failed', email: normalizedEmail, error: String(e) });
    });

    res.json({
      id: guestMembership.id,
      email: normalizedEmail,
      expiresAt: expiresAt.toISOString(),
      magicLink,
    });
  });

  // =========================================================================
  // GET /guests — List guest memberships
  // =========================================================================
  app.get('/guests', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Enterprise gate
    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      return res.status(403).json({ error: 'enterprise_required' });
    }

    const guests = await prisma.membership.findMany({
      where: { tenantId: tenant.id, role: 'guest' },
      include: { user: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    res.json(guests.map((g) => ({
      id: g.id,
      email: g.user.email,
      name: g.user.name,
      expiresAt: g.expiresAt?.toISOString() || null,
      createdAt: g.createdAt.toISOString(),
    })));
  });

  // =========================================================================
  // DELETE /guests/:membershipId — Revoke a guest
  // =========================================================================
  app.delete('/guests/:membershipId', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const membership = await requireMembership(req, auth.userId, prisma);
    if (!membership || (membership.role !== 'admin' && membership.role !== 'owner')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Enterprise gate
    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      return res.status(403).json({ error: 'enterprise_required' });
    }

    const membershipId = req.params.membershipId;
    const guestMembership = await prisma.membership.findFirst({
      where: { id: membershipId, tenantId: tenant.id, role: 'guest' },
    });
    if (!guestMembership) {
      return res.status(404).json({ error: 'guest_not_found' });
    }

    // Delete guest token
    await prisma.guestToken.deleteMany({ where: { membershipId } });
    // Delete all sessions for this user
    await prisma.session.deleteMany({ where: { userId: guestMembership.userId } });
    // Delete membership
    await prisma.membership.delete({ where: { id: membershipId } });

    res.json({ ok: true });
  });

  // =========================================================================
  // POST /auth/guest — Magic-link login for guests
  // =========================================================================
  app.post('/auth/guest', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ token: z.string().min(1) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'token required' });

    const { token: rawToken } = parse.data;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const guestToken = await prisma.guestToken.findUnique({
      where: { token: tokenHash },
      include: {
        membership: {
          include: {
            user: { select: { id: true, email: true, name: true } },
            tenant: { select: { id: true, slug: true } },
          },
        },
      },
    });

    if (!guestToken) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    // Check token expiry
    if (guestToken.expiresAt < new Date()) {
      return res.status(401).json({ error: 'token_expired' });
    }

    // Check membership expiry
    if (guestToken.membership.expiresAt && guestToken.membership.expiresAt < new Date()) {
      return res.status(401).json({ error: 'guest_expired' });
    }

    const user = guestToken.membership.user;
    const tenantId = guestToken.membership.tenant.id;

    // Create JWT
    const jwtToken = jwt.sign({ sub: user.id, tid: tenantId }, getJwtSecret(), { expiresIn: '30d' });
    setAuthCookie(res, jwtToken);

    // Create session record
    try {
      const sessionTokenHash = crypto.createHash('sha256').update(jwtToken).digest('hex');
      const userAgent = req.headers['user-agent'] || null;
      const ipAddress = req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0] || null;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: sessionTokenHash,
          userAgent,
          ipAddress,
          expiresAt,
        },
      });
    } catch (e) {
      logger.warn({ event: 'auth.guest.session_create_failed', userId: user.id, error: String(e) });
    }

    // Return token in body for Tauri/native clients
    const origin = req.headers.origin || '';
    const isNativeClient = !origin || origin.startsWith('tauri://');
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      ...(isNativeClient && { token: jwtToken }),
    });
  });
}
