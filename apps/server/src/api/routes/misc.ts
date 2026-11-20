import type express from 'express';
import { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { displayNameSchema, invalidNameBodyFor } from '../utils/displayName.js';
import { deleteAccount, MembershipNotFoundError, removeMemberFromTenant } from '../../services/accountDeletion.js';
import { recordAuthEvent } from '../../services/authEvents.js';
import { updateOwnProfile } from './accountProfile.js';
import { registerInviteRoutes } from './invites.js';

type MembershipRow = Prisma.MembershipGetPayload<Record<string, never>>;
type UserListRow = Prisma.UserGetPayload<{
  select: {
    id: true;
    email: true;
    name: true;
    createdAt: true;
    updatedAt: true;
    memberships: { select: { role: true; expiresAt: true } };
  };
}>;

async function handleUpdateMe(prisma: PrismaClient, req: express.Request, res: express.Response): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  await updateOwnProfile(prisma, auth.userId, req.body, res);
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
      lastLoginAt: true,
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
  const authEvents = await prisma.authEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { type: true, success: true, tenantId: true, ipAddress: true, userAgent: true, createdAt: true },
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
  return { memberships, sessions, presences, apiTokens, authEvents };
}

async function buildExportData(prisma: PrismaClient, userId: string) {
  const user = await loadExportUser(prisma, userId);
  if (!user) return null;
  const { memberships, sessions, presences, apiTokens, authEvents } = await loadExportRelations(prisma, userId);

  return {
    exportedAt: new Date().toISOString(),
    gdprArticle: 'Art. 20 GDPR - Right to Data Portability',
    user: {
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() || null,
      lastLoginAt: user.lastLoginAt?.toISOString() || null,
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
    authEvents: authEvents.map((e) => ({
      type: e.type,
      success: e.success,
      tenantId: e.tenantId,
      ipAddress: e.ipAddress,
      userAgent: e.userAgent,
      createdAt: e.createdAt.toISOString(),
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

async function checkSoleOwnership(
  prisma: PrismaClient,
  userId: string,
  memberships: MembershipRow[],
): Promise<boolean> {
  for (const membership of memberships) {
    if (membership.role === 'owner') {
      const otherOwners = await prisma.membership.count({
        where: {
          tenantId: membership.tenantId,
          role: 'owner',
          userId: { not: userId },
        },
      });
      if (otherOwners === 0) return true;
    }
  }
  return false;
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

    logger.info({ event: 'user.self_delete.started', userId });
    await deleteAccount(prisma, userId);
    await recordAuthEvent(prisma, { type: 'account_delete', success: true, userId: null, tenantId: null, req });
    logger.info({ event: 'user.self_delete.completed', userId });

    res.clearCookie('token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    res.json({ ok: true, message: 'Account deleted successfully' });
  } catch (e) {
    logger.error({ event: 'user.self_delete.failed', userId, error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'deletion failed' });
  }
}

/**
 * The member directory of the tenant this request is about — names, e-mail
 * addresses, roles and guest expiry.
 *
 * MEMBERSHIP-GATED, and that gate is the whole security of the route.
 * `getTenantFromReq` only says WHICH tenant the request names, never that the
 * caller may touch it: tenancy.ts lets the client-supplied `X-Tenant` header
 * win over the session JWT (documented on `resolveTenantBySlug`). Without the
 * membership check below, any authenticated user could send
 * `X-Tenant: <foreign-slug>` and read a stranger's full member list including
 * every e-mail address — the same mistake, on PII instead of avatars, that made
 * `POST /avatars/resolve` leak across tenants.
 *
 * Same posture as `handleUpdateUser`/`handleChangeRole` below and as
 * `createRequireTenantAdmin`, except that plain membership is enough here: a
 * member may see who else is in their own tenant. Being a member is what is
 * checked, not what the caller claims.
 */
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
  const membership = await requireMembership(req, auth.userId, prisma);
  if (!membership) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const users = await prisma.user.findMany({
    where: { memberships: { some: { tenantId: tenant.id } } },
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
  const result = users.map((u: UserListRow) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    role: u.memberships[0]?.role || 'member',
    expiresAt: u.memberships[0]?.expiresAt?.toISOString() || null,
  }));
  res.json(result);
}

const updateUserSchema = z.object({ email: z.string().email().optional(), name: displayNameSchema.optional() });

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
  if (id === auth.userId) {
    await updateOwnProfile(prisma, auth.userId, req.body, res);
    return;
  }
  if (req.body && typeof req.body === 'object' && 'email' in req.body) {
    res.status(403).json({
      code: 'SELF_EMAIL_CHANGE_REQUIRED',
      error: 'Only the account holder can change their email address through a confirmation link.',
    });
    return;
  }
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
  if (!parse.success) {
    res.status(400).json(invalidNameBodyFor(parse.error) ?? { error: 'nothing to update' });
    return;
  }
  if (!parse.data.email && !parse.data.name) {
    res.status(400).json({ error: 'nothing to update' });
    return;
  }
  const { name } = parse.data;
  try {
    const user = await prisma.user.update({
      where: { id },
      data: { name: name ?? undefined },
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

type ChangeRoleOutcome = 'updated' | 'not_found' | 'guest' | 'caller_forbidden' | 'owner_forbidden' | 'last_owner';

class LastOwnerDemotionError extends Error {}

async function changeMembershipRole(
  prisma: PrismaClient,
  tenantId: string,
  targetUserId: string,
  callerUserId: string,
  newRole: 'admin' | 'member',
): Promise<ChangeRoleOutcome> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "tenantId" = ${tenantId} AND "role" = 'owner' FOR UPDATE`;
      // Read the caller role under the lock: a concurrent change may have demoted the caller since the route check.
      const caller = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: callerUserId } } });
      if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) return 'caller_forbidden';
      const membership = await tx.membership.findFirst({ where: { userId: targetUserId, tenantId } });
      if (!membership) return 'not_found';
      if (membership.role === 'guest') return 'guest';
      if (membership.role === 'owner' && caller.role !== 'owner') return 'owner_forbidden';
      const demotesOwner = membership.role === 'owner';
      await tx.membership.update({ where: { id: membership.id }, data: { role: newRole } });
      if (demotesOwner) {
        const owners = await tx.membership.count({ where: { tenantId, role: 'owner' } });
        if (owners === 0) throw new LastOwnerDemotionError();
      }
      return 'updated';
    });
  } catch (e) {
    if (e instanceof LastOwnerDemotionError) return 'last_owner';
    throw e;
  }
}

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
    const outcome = await changeMembershipRole(prisma, tenant.id, id, auth.userId, parse.data.role);
    if (outcome === 'caller_forbidden') {
      res.status(403).json({ error: 'forbidden - only owners and admins can change roles' });
      return;
    }
    if (outcome === 'not_found') {
      res.status(404).json({ error: 'user not found in this tenant' });
      return;
    }
    if (outcome === 'guest') {
      res.status(400).json({ error: 'cannot_change_guest_role' });
      return;
    }
    if (outcome === 'owner_forbidden') {
      res.status(403).json({ error: 'forbidden - only owners can change owner roles' });
      return;
    }
    if (outcome === 'last_owner') {
      res.status(400).json({ error: 'cannot_demote_last_owner' });
      return;
    }

    logger.info('[Users] Role changed', { userId: id, newRole: parse.data.role, changedBy: auth.userId });
    await recordAuthEvent(prisma, { type: 'role_change', success: true, userId: id, tenantId: tenant.id, req });
    res.json({ ok: true, role: parse.data.role });
  } catch (e) {
    logger.error('[Users] Role change failed', e);
    res.status(400).json({ error: 'role change failed' });
  }
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

  if (targetMembership.role === 'owner' && callerMembership.role !== 'owner') {
    res.status(403).json({ error: 'cannot delete owner' });
    return;
  }

  try {
    const { accountDeleted } = await removeMemberFromTenant(prisma, { userId: id, tenantId: tenant.id });
    logger.info({
      event: 'user.member_removed',
      userId: id,
      removedBy: auth.userId,
      tenantId: tenant.id,
      accountDeleted,
    });
    res.json({ ok: true, accountDeleted });
  } catch (e) {
    if (e instanceof MembershipNotFoundError) {
      res.status(404).json({ error: 'user not found in this tenant' });
      return;
    }
    logger.error({
      event: 'user.member_remove_failed',
      userId: id,
      tenantId: tenant.id,
      error: e instanceof Error ? e.message : String(e),
    });
    res.status(500).json({ error: 'delete failed' });
  }
}

export function registerMiscRoutes(app: express.Application, prisma: PrismaClient) {
  app.patch('/me', (req, res) => handleUpdateMe(prisma, req, res));
  app.get('/users/me/export', (req, res) => handleExportMyData(prisma, req, res));
  app.delete('/users/me', (req, res) => handleDeleteMe(prisma, req, res));
  registerInviteRoutes(app, prisma);
  app.get('/users', (req, res) => handleListUsers(prisma, req, res));
  app.patch('/users/:id', (req, res) => handleUpdateUser(prisma, req, res));
  app.patch('/users/:id/role', (req, res) => handleChangeRole(prisma, req, res));
  app.delete('/users/:id', (req, res) => handleDeleteUser(prisma, req, res));
}
