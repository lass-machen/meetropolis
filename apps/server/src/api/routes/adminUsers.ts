import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  requireSuperAdmin,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';

const RoleEnum = z.enum(['owner', 'admin', 'member']);

export function registerAdminUserRoutes(app: express.Application, prisma: PrismaClient) {
  // List users for a tenant
  app.get('/admin/tenants/:id/users', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const memberships = await prisma.membership.findMany({
        where: { tenantId: req.params.id },
        include: {
          user: {
            select: {
              id: true, email: true, name: true, imageUrl: true,
              createdAt: true, emailVerifiedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      res.json(memberships.map(m => ({
        userId: m.user.id,
        email: m.user.email,
        name: m.user.name,
        imageUrl: m.user.imageUrl,
        role: m.role,
        createdAt: m.user.createdAt,
        emailVerifiedAt: m.user.emailVerifiedAt,
        memberSince: m.createdAt,
      })));
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'fetch_failed' });
    }
  });

  // Update user role within a tenant
  app.patch('/admin/tenants/:id/users/:userId/role', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({ role: RoleEnum });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const membership = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: req.params.userId },
      });
      if (!membership) return res.status(404).json({ error: 'membership_not_found' });
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: parse.data.role as any },
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.role_update.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  // Remove user from tenant (delete membership, not the user)
  app.delete('/admin/tenants/:id/users/:userId', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    try {
      const membership = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: req.params.userId },
      });
      if (!membership) return res.status(404).json({ error: 'membership_not_found' });

      // Safety: prevent removing the last owner
      if (membership.role === 'owner') {
        const ownerCount = await prisma.membership.count({
          where: { tenantId: req.params.id, role: 'owner' },
        });
        if (ownerCount <= 1) {
          return res.status(400).json({ error: 'cannot_remove_last_owner' });
        }
      }

      await prisma.membership.delete({ where: { id: membership.id } });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.remove.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'remove_failed' });
    }
  });

  // Add user to tenant by email
  app.post('/admin/tenants/:id/users', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['admin', 'member']),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const email = normalizeEmailForStorage(parse.data.email);
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return res.status(404).json({ error: 'user_not_found' });

      const existing = await prisma.membership.findFirst({
        where: { tenantId: req.params.id, userId: user.id },
      });
      if (existing) return res.status(400).json({ error: 'already_member' });

      const membership = await prisma.membership.create({
        data: {
          tenantId: req.params.id,
          userId: user.id,
          role: parse.data.role as any,
        },
      });
      res.json({
        id: membership.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role: membership.role,
        memberSince: membership.createdAt,
      });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_users.add.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'add_failed' });
    }
  });

}
