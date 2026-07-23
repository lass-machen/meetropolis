import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';
import { isAllowedAvatarId } from '../../services/avatarAccess.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';

const onboardingSchema = z.object({
  avatarId: z.string().min(1).max(200).optional(),
});

export async function handleOnboardingComplete(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const auth = requireAuth(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const parse = onboardingSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid body', details: parse.error.issues });
    return;
  }

  try {
    const updateData: { onboardingCompleted: boolean; avatarId?: string } = { onboardingCompleted: true };
    if (parse.data.avatarId) {
      // Validate the id resolves to something real AND in this caller's reach
      // before persisting: a default, an avatar from a pack the caller's scope
      // covers, or a custom avatar of the caller's OWN PROVEN TENANT. The
      // custom branch is tenant-scoped like the pack branch — see
      // `isAllowedAvatarId` in services/avatarAccess.ts before loosening it.
      const scope = await resolvePackScope(prisma, req);
      if (!(await isAllowedAvatarId(prisma, parse.data.avatarId, scope))) {
        res.status(400).json({ error: 'invalid avatarId' });
        return;
      }
      updateData.avatarId = parse.data.avatarId;
    }

    const updatedUser = await prisma.user.update({
      where: { id: auth.userId },
      data: updateData,
      select: { id: true, email: true, name: true, avatarId: true, onboardingCompleted: true },
    });

    res.json(updatedUser);
  } catch (e: unknown) {
    logger.error({ event: 'auth.onboarding.complete_failed', userId: auth.userId, error: String(e) });
    res.status(500).json({ error: 'onboarding completion failed' });
  }
}

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
  direction: z.enum(['up', 'down', 'left', 'right']),
  roomId: z.string().optional(),
  mapName: z.string().optional(),
});

/**
 * Emergency path for a presence upsert that arrives before the tenant has the
 * room it is pointing at.
 *
 * The map is resolved through `Tenant.defaultMapName` — the SAME selector the
 * seed, `copyTemplateMapsForSignup` and the Colyseus lifecycle use — and not
 * through a hardcoded 'office'. With the literal, a tenant whose default map
 * was renamed in the editor got a SECOND, empty 32x32 map called 'office' here,
 * silently breaking the "exactly one map per new tenant" invariant. The
 * `|| 'office'` fallback only covers the nullable column, matching
 * onJoin.completion.ts.
 */
async function getOrCreateDefaultRoom(prisma: PrismaClient, tenantId: string, roomId: string) {
  const room = await prisma.room.findFirst({ where: { name: roomId, tenantId } });
  if (room) return room;

  const tenantRecord = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { defaultMapName: true },
  });
  const mapName = tenantRecord?.defaultMapName || 'office';

  let map = await prisma.map.findFirst({ where: { name: mapName, tenantId } });
  if (!map) {
    map = await prisma.map.create({
      data: {
        name: mapName,
        meta: {},
        tenantId,
        width: 32,
        height: 32,
        tileWidth: 16,
        tileHeight: 16,
        chunkSize: 32,
      },
    });
  }
  return prisma.room.create({ data: { name: roomId, mapId: map.id, tenantId } });
}

async function upsertPresence(
  prisma: PrismaClient,
  userId: string,
  tenantId: string,
  roomId: string,
  data: { x: number; y: number; direction: string; mapName?: string },
) {
  const existingPresence = await prisma.presence.findFirst({
    where: { userId, roomId, tenantId },
  });

  if (existingPresence) {
    await prisma.presence.update({
      where: { id: existingPresence.id },
      data: {
        x: data.x,
        y: data.y,
        direction: data.direction,
        ...(data.mapName ? { mapName: data.mapName } : {}),
      },
    });
  } else {
    await prisma.presence.create({
      data: {
        userId,
        roomId,
        tenantId,
        x: data.x,
        y: data.y,
        direction: data.direction,
        ...(data.mapName ? { mapName: data.mapName } : {}),
      },
    });
  }
}

function broadcastPresenceUpdate(
  tenantSlug: string,
  userId: string,
  data: { x: number; y: number; direction: string },
) {
  try {
    const globalScope = global as {
      activeWorldRooms?: Set<{ metadata?: { tenant?: string }; broadcast?: (event: string, data: unknown) => void }>;
    };
    const rooms = Array.from((globalScope.activeWorldRooms || new Set()).values());
    for (const r of rooms) {
      const meta = r.metadata || {};
      if (meta && meta.tenant && meta.tenant !== tenantSlug) continue;
      try {
        r.broadcast?.('presence_update', {
          userId,
          x: data.x,
          y: data.y,
          direction: data.direction,
          updatedAt: new Date().toISOString(),
        });
      } catch {}
    }
  } catch {}
}

export async function handleAuthPosition(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
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
    const parse = positionSchema.safeParse(req.body || {});
    if (!parse.success) {
      res.status(400).json({ error: 'invalid position data' });
      return;
    }

    const { x, y, direction, roomId = 'world' } = parse.data;
    const room = await getOrCreateDefaultRoom(prisma, tenant.id, roomId);
    await upsertPresence(prisma, auth.userId, tenant.id, room.id, {
      x,
      y,
      direction,
      mapName: parse.data.mapName,
    });

    broadcastPresenceUpdate(tenant.slug, auth.userId, { x, y, direction });

    res.json({ ok: true });
  } catch (e: unknown) {
    try {
      logger.error('[Auth] position update failed', e);
    } catch {}
    res.status(500).json({ error: 'position update failed' });
  }
}
