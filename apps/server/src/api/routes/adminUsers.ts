import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import {
  requireSuperAdmin,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';

const RoleEnum = z.enum(['owner', 'admin', 'member']);

async function handleListTenantUsers(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
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
}

const updateRoleSchema = z.object({ role: RoleEnum });

async function handleUpdateUserRole(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parse = updateRoleSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  try {
    const membership = await prisma.membership.findFirst({
      where: { tenantId: req.params.id, userId: req.params.userId },
    });
    if (!membership) {
      res.status(404).json({ error: 'membership_not_found' });
      return;
    }
    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: parse.data.role as any },
    });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'admin.tenant_users.role_update.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'update_failed' });
  }
}

async function handleRemoveTenantUser(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  try {
    const membership = await prisma.membership.findFirst({
      where: { tenantId: req.params.id, userId: req.params.userId },
    });
    if (!membership) {
      res.status(404).json({ error: 'membership_not_found' });
      return;
    }

    if (membership.role === 'owner') {
      const ownerCount = await prisma.membership.count({
        where: { tenantId: req.params.id, role: 'owner' },
      });
      if (ownerCount <= 1) {
        res.status(400).json({ error: 'cannot_remove_last_owner' });
        return;
      }
    }

    await prisma.membership.delete({ where: { id: membership.id } });
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error({ event: 'admin.tenant_users.remove.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'remove_failed' });
  }
}

const addUserSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member']),
  name: z.string().optional(),
});

async function handleAddTenantUser(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parse = addUserSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  try {
    const email = normalizeEmailForStorage(parse.data.email);
    let created = false;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: parse.data.name || null,
          passwordHash: null,
        },
      });
      created = true;
    }

    const existing = await prisma.membership.findFirst({
      where: { tenantId: req.params.id, userId: user.id },
    });
    if (existing) {
      res.status(400).json({ error: 'already_member' });
      return;
    }

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
      created,
    });
  } catch (e: unknown) {
    logger.error({ event: 'admin.tenant_users.add.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'add_failed' });
  }
}

export function registerAdminUserRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/admin/tenants/:id/users', (req, res) => handleListTenantUsers(prisma, req, res));
  app.patch('/admin/tenants/:id/users/:userId/role', (req, res) => handleUpdateUserRole(prisma, req, res));
  app.delete('/admin/tenants/:id/users/:userId', (req, res) => handleRemoveTenantUser(prisma, req, res));
  app.post('/admin/tenants/:id/users', (req, res) => handleAddTenantUser(prisma, req, res));
}
