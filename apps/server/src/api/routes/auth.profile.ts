import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireAuth, getTenantFromReq } from '../utils/authHelpers.js';

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

async function getOrCreateDefaultRoom(prisma: PrismaClient, tenantId: string, roomId: string) {
  const room = await prisma.room.findFirst({ where: { name: roomId, tenantId } });
  if (room) return room;

  let map = await prisma.map.findFirst({ where: { name: 'office', tenantId } });
  if (!map) {
    map = await prisma.map.create({
      data: {
        name: 'office',
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
