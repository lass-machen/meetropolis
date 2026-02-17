import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';

export function registerMiscRoutes(app: express.Application, prisma: PrismaClient) {
  // Profile update (authenticated)
  app.patch('/me', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const { name, email } = (req.body ?? {}) as { name?: string; email?: string };
    if (!name && !email) return res.status(400).json({ error: 'nothing to update' });
    try {
      const u = await prisma.user.update({ where: { id: auth.userId }, data: { name: name ?? undefined, email: email ?? undefined } });
      res.json({ id: u.id, email: u.email, name: u.name });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
    }
  });

  // Export own data (GDPR Art. 20 - Right to Data Portability)
  app.get('/users/me/export', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: {
          id: true,
          email: true,
          name: true,
          imageUrl: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        }
      });
      if (!user) return res.status(404).json({ error: 'user not found' });

      // Get all memberships
      const memberships = await prisma.membership.findMany({
        where: { userId: auth.userId },
        include: {
          tenant: {
            select: { id: true, slug: true, name: true }
          }
        }
      });

      // Get all sessions
      const sessions = await prisma.session.findMany({
        where: { userId: auth.userId },
        select: {
          id: true,
          userAgent: true,
          ipAddress: true,
          lastActiveAt: true,
          createdAt: true,
        }
      });

      // Get presence history (last positions)
      const presences = await prisma.presence.findMany({
        where: { userId: auth.userId },
        select: {
          id: true,
          x: true,
          y: true,
          direction: true,
          updatedAt: true,
          room: { select: { name: true } },
          tenant: { select: { slug: true } }
        }
      });

      // Get API tokens (without hashes)
      const apiTokens = await prisma.apiToken.findMany({
        where: { userId: auth.userId },
        select: {
          id: true,
          name: true,
          lastUsedAt: true,
          createdAt: true,
        }
      });

      const exportData = {
        exportedAt: new Date().toISOString(),
        gdprArticle: 'Art. 20 GDPR - Right to Data Portability',
        user: {
          ...user,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
        },
        memberships: memberships.map(m => ({
          tenantId: m.tenant.id,
          tenantSlug: m.tenant.slug,
          tenantName: m.tenant.name,
          role: m.role,
          joinedAt: m.createdAt.toISOString(),
        })),
        sessions: sessions.map(s => ({
          id: s.id,
          userAgent: s.userAgent,
          ipAddress: s.ipAddress,
          lastActiveAt: s.lastActiveAt.toISOString(),
          createdAt: s.createdAt.toISOString(),
        })),
        presences: presences.map(p => ({
          tenant: p.tenant.slug,
          room: p.room.name,
          position: { x: p.x, y: p.y, direction: p.direction },
          updatedAt: p.updatedAt.toISOString(),
        })),
        apiTokens: apiTokens.map(t => ({
          id: t.id,
          name: t.name,
          lastUsedAt: t.lastUsedAt?.toISOString() || null,
          createdAt: t.createdAt.toISOString(),
        })),
      };

      // Set headers for download
      const filename = `meetropolis-data-export-${user.id}-${Date.now()}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      logger.info({ event: 'gdpr.data_export', userId: auth.userId });
      return res.json(exportData);
    } catch (e: unknown) {
      logger.error({ event: 'gdpr.data_export.failed', userId: auth.userId, error: e instanceof Error ? e.message : String(e) });
      return res.status(500).json({ error: 'export failed' });
    }
  });

  // Delete own account (GDPR compliance)
  app.delete('/users/me', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const userId = auth.userId;

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { memberships: true }
      });
      if (!user) return res.status(404).json({ error: 'user not found' });

      // Check if user is the sole owner of any tenant
      for (const membership of user.memberships) {
        if ((membership as any).role === 'owner') {
          const otherOwners = await prisma.membership.count({
            where: {
              tenantId: membership.tenantId,
              role: 'owner' as any,
              userId: { not: userId }
            }
          });
          if (otherOwners === 0) {
            return res.status(400).json({
              error: 'cannot delete account - you are the sole owner of an organization. Transfer ownership first.'
            });
          }
        }
      }

      // Delete all related data
      logger.info('[Users] Account self-deletion initiated', { userId, email: user.email });

      try { await prisma.presence.deleteMany({ where: { userId } }); } catch { }
      try { await prisma.passwordReset.deleteMany({ where: { userId } }); } catch { }
      try { await prisma.apiToken.deleteMany({ where: { userId } }); } catch { }
      try { await prisma.invite.updateMany({ where: { usedById: userId }, data: { usedById: null } }); } catch { }
      try { await prisma.invite.updateMany({ where: { createdBy: userId }, data: { createdBy: null } }); } catch { }
      try { await prisma.membership.deleteMany({ where: { userId } }); } catch { }
      await prisma.user.delete({ where: { id: userId } });

      logger.info('[Users] Account deleted successfully', { userId });

      // Clear auth cookie
      res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      return res.json({ ok: true, message: 'Account deleted successfully' });
    } catch (e) {
      logger.error('[Users] Account self-deletion failed', e);
      return res.status(500).json({ error: 'deletion failed' });
    }
  });

  // Invitations list
  app.get('/invites', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });
    const list = await prisma.invite.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
    res.json(list);
  });

  // Delete invite
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

  // Users list
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

  // Update user
  app.patch('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });

    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    // Allow self-edit without role check
    const id = req.params.id;
    if (id !== auth.userId) {
      const callerMembership = await requireMembership(req, auth.userId, prisma);
      if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
        return res.status(403).json({ error: 'forbidden' });
      }
      // Check target user is in same tenant
      const targetMembership = await prisma.membership.findFirst({ where: { userId: id, tenantId: tenant.id } });
      if (!targetMembership) return res.status(404).json({ error: 'user not found in this tenant' });
    }

    const schema = z.object({ email: z.string().email().optional(), name: z.string().min(1).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success || (!parse.data.email && !parse.data.name)) return res.status(400).json({ error: 'nothing to update' });
    const { email, name } = parse.data;
    try {
      const normalized = email ? email.trim().toLowerCase() : undefined;
      const user = await prisma.user.update({ where: { id }, data: { email: normalized ?? undefined, name: name ?? undefined } });
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
    }
  });

  // Change user role
  app.patch('/users/:id/role', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    const callerMembership = await requireMembership(req, auth.userId, prisma);
    if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
      return res.status(403).json({ error: 'forbidden - only owners and admins can change roles' });
    }

    const id = req.params.id;
    const schema = z.object({ role: z.enum(['admin', 'member']) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'valid role required (admin or member)' });

    if (id === auth.userId) {
      return res.status(400).json({ error: 'cannot change own role' });
    }

    try {
      const membership = await prisma.membership.findFirst({
        where: { userId: id, tenantId: tenant.id }
      });
      if (!membership) return res.status(404).json({ error: 'user not found in this tenant' });

      if ((membership as any).role === 'owner' && callerMembership.role !== 'owner') {
        return res.status(403).json({ error: 'forbidden - only owners can change owner roles' });
      }

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

  // Delete user
  app.delete('/users/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const id = req.params.id;
    if (id === auth.userId) return res.status(400).json({ error: 'cannot delete self' });

    const tenant = getTenantFromReq(req);
    if (!tenant) return res.status(400).json({ error: 'tenant_required' });

    // Check caller role
    const callerMembership = await requireMembership(req, auth.userId, prisma);
    if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
      return res.status(403).json({ error: 'forbidden' });
    }

    // Check target user is in same tenant
    const targetMembership = await prisma.membership.findFirst({ where: { userId: id, tenantId: tenant.id } });
    if (!targetMembership) return res.status(404).json({ error: 'user not found in this tenant' });

    // Owner cannot be deleted by admins
    if ((targetMembership as any).role === 'owner' && callerMembership.role !== 'owner') {
      return res.status(403).json({ error: 'cannot delete owner' });
    }

    try {
      const exists = await prisma.user.findUnique({ where: { id } });
      if (!exists) return res.status(404).json({ error: 'not found' });
      try { await prisma.presence.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.passwordReset.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.apiToken.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.invite.updateMany({ where: { usedById: id }, data: { usedById: null } }); } catch { }
      try { await prisma.membership.deleteMany({ where: { userId: id } }); } catch { }
      await prisma.user.delete({ where: { id } });
      logger.info({ event: 'user.deleted', userId: id, deletedBy: auth.userId, tenantId: tenant.id });
      return res.json({ ok: true });
    } catch (e) {
      logger.error('[Users] delete failed', e);
      return res.status(400).json({ error: 'delete failed' });
    }
  });
}
