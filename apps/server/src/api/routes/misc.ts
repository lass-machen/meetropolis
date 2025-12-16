import type express from 'express';
import { PrismaClient } from '@prisma/client';
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
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
      res.status(400).json({ error: 'update failed' });
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
    const id = req.params.id;
    const schema = z.object({ email: z.string().email().optional(), name: z.string().min(1).optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success || (!parse.data.email && !parse.data.name)) return res.status(400).json({ error: 'nothing to update' });
    const { email, name } = parse.data;
    try {
      const normalized = email ? email.trim().toLowerCase() : undefined;
      const user = await prisma.user.update({ where: { id }, data: { email: normalized ?? undefined, name: name ?? undefined } });
      res.json({ id: user.id, email: user.email, name: user.name });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'email already in use' });
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
    try {
      if (id === auth.userId) return res.status(400).json({ error: 'cannot delete self' });
      const exists = await prisma.user.findUnique({ where: { id } });
      if (!exists) return res.status(404).json({ error: 'not found' });
      try { await prisma.presence.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.passwordReset.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.apiToken.deleteMany({ where: { userId: id } }); } catch { }
      try { await prisma.invite.updateMany({ where: { usedById: id }, data: { usedById: null } }); } catch { }
      try { await prisma.membership.deleteMany({ where: { userId: id } }); } catch { }
      await prisma.user.delete({ where: { id } });
      return res.json({ ok: true });
    } catch (e) {
      logger.error('[Users] delete failed', e);
      return res.status(400).json({ error: 'delete failed' });
    }
  });
}
