import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';

async function handleUpdateMe(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const { name, email } = (req.body ?? {}) as { name?: string; email?: string };
  if (!name && !email) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  try {
    const u = await prisma.user.update({
      where: { id: auth.userId },
      data: { name: name ?? undefined, email: email ?? undefined },
    });
    res.json({ id: u.id, email: u.email, name: u.name });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      res.status(400).json({ error: 'email already in use' });
      return;
    }
    res.status(400).json({ error: 'update failed' });
  }
}

function loadExportUser(prisma: PrismaClient, userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      imageUrl: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

async function loadExportRelations(prisma: PrismaClient, userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { tenant: { select: { id: true, slug: true, name: true } } },
  });
  const sessions = await prisma.session.findMany({
    where: { userId },
    select: { id: true, userAgent: true, ipAddress: true, lastActiveAt: true, createdAt: true },
  });
  const presences = await prisma.presence.findMany({
    where: { userId },
    select: {
      id: true,
      x: true,
      y: true,
      direction: true,
      updatedAt: true,
      room: { select: { name: true } },
      tenant: { select: { slug: true } },
    },
  });
  const apiTokens = await prisma.apiToken.findMany({
    where: { userId },
    select: { id: true, name: true, lastUsedAt: true, createdAt: true },
  });
  return { memberships, sessions, presences, apiTokens };
}

async function buildExportData(prisma: PrismaClient, userId: string) {
  const user = await loadExportUser(prisma, userId);
  if (!user) return null;
  const { memberships, sessions, presences, apiTokens } = await loadExportRelations(prisma, userId);

  return {
    exportedAt: new Date().toISOString(),
    gdprArticle: 'Art. 20 GDPR - Right to Data Portability',
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
    },
    memberships: memberships.map((m) => ({
      tenantId: m.tenant.id,
      tenantSlug: m.tenant.slug,
      tenantName: m.tenant.name,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      lastActiveAt: s.lastActiveAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
    })),
    presences: presences.map((p) => ({
      tenant: p.tenant.slug,
      room: p.room.name,
      position: { x: p.x, y: p.y, direction: p.direction },
      updatedAt: p.updatedAt.toISOString(),
    })),
    apiTokens: apiTokens.map((t) => ({
      id: t.id,
      name: t.name,
      lastUsedAt: t.lastUsedAt?.toISOString() || null,
      createdAt: t.createdAt.toISOString(),
    })),
    _userMeta: { id: user.id },
  };
}

async function handleExportMyData(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const exportData = await buildExportData(prisma, auth.userId);
    if (!exportData) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const filename = `meetropolis-data-export-${exportData._userMeta.id}-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    logger.info({ event: 'gdpr.data_export', userId: auth.userId });
    const { _userMeta: _, ...payload } = exportData;
    res.json(payload);
  } catch (e: unknown) {
    logger.error({
      event: 'gdpr.data_export.failed',
      userId: auth.userId,
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: 'export failed' });
  }
}

async function checkSoleOwnership(prisma: PrismaClient, userId: string, memberships: any[]): Promise<boolean> {
  for (const membership of memberships) {
    if (membership.role === 'owner') {
      const otherOwners = await prisma.membership.count({
        where: {
          tenantId: membership.tenantId,
          role: 'owner' as any,
          userId: { not: userId },
        },
      });
      if (otherOwners === 0) return true;
    }
  }
  return false;
}

async function purgeUserAndRelated(prisma: PrismaClient, userId: string): Promise<void> {
  try {
    await prisma.presence.deleteMany({ where: { userId } });
  } catch {}
  try {
    await prisma.passwordReset.deleteMany({ where: { userId } });
  } catch {}
  try {
    await prisma.apiToken.deleteMany({ where: { userId } });
  } catch {}
  try {
    await prisma.invite.updateMany({ where: { usedById: userId }, data: { usedById: null } });
  } catch {}
  try {
    await prisma.invite.updateMany({ where: { createdBy: userId }, data: { createdBy: null } });
  } catch {}
  try {
    await prisma.membership.deleteMany({ where: { userId } });
  } catch {}
  await prisma.user.delete({ where: { id: userId } });
}

async function handleDeleteMe(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const userId = auth.userId;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: true },
    });
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }

    const isSoleOwner = await checkSoleOwnership(prisma, userId, user.memberships);
    if (isSoleOwner) {
      res.status(400).json({
        error: 'cannot delete account - you are the sole owner of an organization. Transfer ownership first.',
      });
      return;
    }

    logger.info('[Users] Account self-deletion initiated', { userId, email: user.email });
    await purgeUserAndRelated(prisma, userId);
    logger.info('[Users] Account deleted successfully', { userId });

    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true, message: 'Account deleted successfully' });
  } catch (e) {
    logger.error('[Users] Account self-deletion failed', e);
    res.status(500).json({ error: 'deletion failed' });
  }
}

async function handleListInvites(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  const list = await prisma.invite.findMany({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'desc' } });
  res.json(list);
}

async function handleDeleteInvite(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
  const code = pathParam(req, 'code');
  try {
    const inv = await prisma.invite.findUnique({ where: { code } });
    if (!inv || (inv as any).tenantId !== tenant.id) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (inv.usedAt) {
      res.status(400).json({ error: 'already used' });
      return;
    }
    await prisma.invite.delete({ where: { code } });
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: 'delete failed' });
  }
}

async function handleListUsers(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }
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
        select: { role: true, expiresAt: true },
      },
    },
  });
  const result = users.map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    role: u.memberships?.[0]?.role || 'member',
    expiresAt: u.memberships?.[0]?.expiresAt?.toISOString() || null,
  }));
  res.json(result);
}

const updateUserSchema = z.object({ email: z.string().email().optional(), name: z.string().min(1).optional() });

async function handleUpdateUser(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const id = pathParam(req, 'id');
  if (id !== auth.userId) {
    const callerMembership = await requireMembership(req, auth.userId, prisma);
    if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const targetMembership = await prisma.membership.findFirst({ where: { userId: id, tenantId: tenant.id } });
    if (!targetMembership) {
      res.status(404).json({ error: 'user not found in this tenant' });
      return;
    }
  }

  const parse = updateUserSchema.safeParse(req.body || {});
  if (!parse.success || (!parse.data.email && !parse.data.name)) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  const { email, name } = parse.data;
  try {
    const normalized = email ? email.trim().toLowerCase() : undefined;
    const user = await prisma.user.update({
      where: { id },
      data: { email: normalized ?? undefined, name: name ?? undefined },
    });
    res.json({ id: user.id, email: user.email, name: user.name });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      res.status(400).json({ error: 'email already in use' });
      return;
    }
    res.status(400).json({ error: 'update failed' });
  }
}

const changeRoleSchema = z.object({ role: z.enum(['admin', 'member']) });

async function handleChangeRole(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const callerMembership = await requireMembership(req, auth.userId, prisma);
  if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
    res.status(403).json({ error: 'forbidden - only owners and admins can change roles' });
    return;
  }

  const id = pathParam(req, 'id');
  const parse = changeRoleSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'valid role required (admin or member)' });
    return;
  }

  if (id === auth.userId) {
    res.status(400).json({ error: 'cannot change own role' });
    return;
  }

  try {
    const membership = await prisma.membership.findFirst({
      where: { userId: id, tenantId: tenant.id },
    });
    if (!membership) {
      res.status(404).json({ error: 'user not found in this tenant' });
      return;
    }

    if ((membership as any).role === 'guest') {
      res.status(400).json({ error: 'cannot_change_guest_role' });
      return;
    }

    if ((membership as any).role === 'owner' && callerMembership.role !== 'owner') {
      res.status(403).json({ error: 'forbidden - only owners can change owner roles' });
      return;
    }

    await prisma.membership.update({
      where: { id: membership.id },
      data: { role: parse.data.role as any },
    });

    logger.info('[Users] Role changed', { userId: id, newRole: parse.data.role, changedBy: auth.userId });
    res.json({ ok: true, role: parse.data.role });
  } catch (e) {
    logger.error('[Users] Role change failed', e);
    res.status(400).json({ error: 'role change failed' });
  }
}

async function purgeUserMembershipData(prisma: PrismaClient, id: string): Promise<void> {
  try {
    await prisma.presence.deleteMany({ where: { userId: id } });
  } catch {}
  try {
    await prisma.passwordReset.deleteMany({ where: { userId: id } });
  } catch {}
  try {
    await prisma.apiToken.deleteMany({ where: { userId: id } });
  } catch {}
  try {
    await prisma.invite.updateMany({ where: { usedById: id }, data: { usedById: null } });
  } catch {}
  try {
    await prisma.membership.deleteMany({ where: { userId: id } });
  } catch {}
  await prisma.user.delete({ where: { id } });
}

async function handleDeleteUser(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const id = pathParam(req, 'id');
  if (id === auth.userId) {
    res.status(400).json({ error: 'cannot delete self' });
    return;
  }

  const tenant = getTenantFromReq(req);
  if (!tenant) {
    res.status(400).json({ error: 'tenant_required' });
    return;
  }

  const callerMembership = await requireMembership(req, auth.userId, prisma);
  if (!callerMembership || (callerMembership.role !== 'owner' && callerMembership.role !== 'admin')) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const targetMembership = await prisma.membership.findFirst({ where: { userId: id, tenantId: tenant.id } });
  if (!targetMembership) {
    res.status(404).json({ error: 'user not found in this tenant' });
    return;
  }

  if ((targetMembership as any).role === 'owner' && callerMembership.role !== 'owner') {
    res.status(403).json({ error: 'cannot delete owner' });
    return;
  }

  try {
    const exists = await prisma.user.findUnique({ where: { id } });
    if (!exists) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    await purgeUserMembershipData(prisma, id);
    logger.info({ event: 'user.deleted', userId: id, deletedBy: auth.userId, tenantId: tenant.id });
    res.json({ ok: true });
  } catch (e) {
    logger.error('[Users] delete failed', e);
    res.status(400).json({ error: 'delete failed' });
  }
}

export function registerMiscRoutes(app: express.Application, prisma: PrismaClient) {
  app.patch('/me', (req, res) => handleUpdateMe(prisma, req, res));
  app.get('/users/me/export', (req, res) => handleExportMyData(prisma, req, res));
  app.delete('/users/me', (req, res) => handleDeleteMe(prisma, req, res));
  app.get('/invites', (req, res) => handleListInvites(prisma, req, res));
  app.delete('/invites/:code', (req, res) => handleDeleteInvite(prisma, req, res));
  app.get('/users', (req, res) => handleListUsers(prisma, req, res));
  app.patch('/users/:id', (req, res) => handleUpdateUser(prisma, req, res));
  app.patch('/users/:id/role', (req, res) => handleChangeRole(prisma, req, res));
  app.delete('/users/:id', (req, res) => handleDeleteUser(prisma, req, res));
}
