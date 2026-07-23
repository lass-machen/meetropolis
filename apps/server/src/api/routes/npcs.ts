import type express from 'express';
import type { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { requireAuth, requireApiToken, getTenantFromReq, requireMembership } from '../utils/authHelpers.js';
import { pathParam } from '../utils/requestHelpers.js';
import { logger } from '../../logger.js';
import { npcServiceSpawn, npcServiceDespawn } from '../utils/npcServiceClient.js';
import { isAllowedAvatarId, isCustomAvatarId } from '../../services/avatarAccess.js';
import { resolvePackScope } from '../utils/resolvePackScope.js';
import type { Room } from 'colyseus';

// --- Auth helpers ---

async function getAuth(req: express.Request, prisma: PrismaClient) {
  return requireAuth(req) || (await requireApiToken(req, prisma));
}

async function isAdminOrOwner(req: express.Request, userId: string, prisma: PrismaClient): Promise<boolean> {
  const membership = await requireMembership(req, userId, prisma);
  if (!membership) return false;
  return membership.role === 'admin' || membership.role === 'owner';
}

/**
 * NPC avatars are subject to the same AvatarPack ownership veto as user
 * avatars (see prisma/schema.prisma, "not wearable"). Without this check a
 * tenant admin could pin an NPC to an id out of ANOTHER tenant's private pack:
 * the value was persisted, handed to the NPC service and broadcast into the
 * room, where every client rendered `__MISSING` because the owning pack never
 * lists for them.
 *
 * Resolved through the SAME scope resolver the REST avatar routes use, so
 * "listable" and "wearable" cannot drift apart between the user and the NPC
 * surface.
 *
 * Custom avatars are rejected outright, whatever the scope says. NPCs never
 * legitimately wear one — the realtime handler already refuses them on that
 * grounds (rooms/handlers/avatarHandler.ts), so anything persisted here was
 * silently dropped on the way into the room anyway. Worse, it is the ONE id
 * class that must not ride an NPC: NPC players are exempt from the per-client
 * tenant StateView (rooms/lifecycle/tenantView.ts `isPlayerVisibleToTenant`)
 * and are broadcast to every tenant sharing the apex-domain room, so an NPC
 * pinned to `custom:<uuid>` would hand that uuid — and with it the public,
 * session-less sprite URL of services/avatarComposer.ts `customSpriteUrl` — to
 * foreign tenants. Even an admin of the OWNING tenant must not be able to do
 * that; the leak is against the members whose avatar it is.
 */
async function isNpcAvatarAllowed(prisma: PrismaClient, req: express.Request, avatarId: string): Promise<boolean> {
  if (isCustomAvatarId(avatarId)) return false;
  const scope = await resolvePackScope(prisma, req);
  return isAllowedAvatarId(prisma, avatarId, scope);
}

// --- Zod schemas ---

const createNpcSchema = z.object({
  identity: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9\-_]+$/),
  name: z.string().min(1).max(200),
  avatarId: z.string().min(1).max(200).optional(),
  spawnX: z.number().optional(),
  spawnY: z.number().optional(),
  spawnDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
  enabled: z.boolean().optional(),
  showBadge: z.boolean().optional(),
  mapName: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const updateNpcSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatarId: z.string().min(1).max(200).optional(),
  spawnX: z.number().optional(),
  spawnY: z.number().optional(),
  spawnDirection: z.enum(['up', 'down', 'left', 'right']).optional(),
  enabled: z.boolean().optional(),
  showBadge: z.boolean().optional(),
  mapName: z.string().nullable().optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
});

const commandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('move'),
    payload: z.object({ x: z.number(), y: z.number(), speed: z.number().optional() }),
  }),
  z.object({ action: z.literal('stop_movement'), payload: z.undefined().optional() }),
  z.object({
    action: z.literal('play_audio'),
    payload: z.object({ mediaFileId: z.string(), loop: z.boolean().optional() }),
  }),
  z.object({
    action: z.literal('play_video'),
    payload: z.object({ mediaFileId: z.string(), loop: z.boolean().optional() }),
  }),
  z.object({
    action: z.literal('play_screenshare'),
    payload: z.object({ mediaFileId: z.string(), loop: z.boolean().optional() }),
  }),
  z.object({ action: z.literal('stop_media'), payload: z.undefined().optional() }),
  z.object({ action: z.literal('set_dnd'), payload: z.object({ dnd: z.boolean() }) }),
  z.object({ action: z.literal('set_avatar'), payload: z.object({ avatarId: z.string() }) }),
]);

// --- Route handlers ---

async function handleListNpcs(req: express.Request, res: express.Response, prisma: PrismaClient) {
  // Internal service auth via NPC_SERVICE_SECRET (service-to-service)
  const npcSecret = process.env.NPC_SERVICE_SECRET;
  const reqSecret = req.headers['x-npc-secret'] as string | undefined;
  const isServiceAuth = !!(npcSecret && reqSecret && npcSecret === reqSecret);

  if (isServiceAuth) {
    // Service-to-service: return all enabled NPCs across all tenants
    const enabledFilter = req.query.enabled === 'true' ? { enabled: true } : {};
    const npcs = await prisma.npc.findMany({
      where: enabledFilter,
      orderBy: { createdAt: 'desc' },
      include: { tenant: { select: { slug: true } }, mediaFiles: true },
    });
    return res.json(npcs);
  }

  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  const enabledOnly = req.query.enabled === 'true';
  const where: { tenantId: string; enabled?: boolean } = { tenantId: tenant.id };
  if (enabledOnly) where.enabled = true;

  const npcs = await prisma.npc.findMany({ where, orderBy: { createdAt: 'desc' }, include: { mediaFiles: true } });
  res.json(npcs);
}

async function handleCreateNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!(await isAdminOrOwner(req, auth.userId, prisma))) return res.status(403).json({ error: 'forbidden' });

  const parse = createNpcSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid_payload', details: parse.error.issues });

  const data = parse.data;
  if (data.avatarId && !(await isNpcAvatarAllowed(prisma, req, data.avatarId))) {
    return res.status(400).json({ error: 'invalid_avatar_id' });
  }

  const existing = await prisma.npc.findUnique({
    where: { tenantId_identity: { tenantId: tenant.id, identity: data.identity } },
  });
  if (existing) return res.status(409).json({ error: 'identity_exists' });

  const npc = await prisma.npc.create({
    data: {
      tenantId: tenant.id,
      identity: data.identity,
      name: data.name,
      avatarId: data.avatarId,
      spawnX: data.spawnX,
      spawnY: data.spawnY,
      spawnDirection: data.spawnDirection,
      enabled: data.enabled,
      showBadge: data.showBadge,
      mapName: data.mapName,
      config: data.config as Parameters<typeof prisma.npc.create>[0]['data']['config'],
    },
  });
  res.status(201).json(npc);
}

async function handleGetNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  const npc = await prisma.npc.findFirst({
    where: { id: pathParam(req, 'id'), tenantId: tenant.id },
    include: { mediaFiles: true },
  });
  if (!npc) return res.status(404).json({ error: 'not_found' });
  res.json(npc);
}

async function handleUpdateNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!(await isAdminOrOwner(req, auth.userId, prisma))) return res.status(403).json({ error: 'forbidden' });

  const parse = updateNpcSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid_payload', details: parse.error.issues });
  if (parse.data.avatarId && !(await isNpcAvatarAllowed(prisma, req, parse.data.avatarId))) {
    return res.status(400).json({ error: 'invalid_avatar_id' });
  }

  const npc = await prisma.npc.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  const updateData = { ...parse.data } as Parameters<typeof prisma.npc.update>[0]['data'];
  const updated = await prisma.npc.update({ where: { id: npc.id }, data: updateData });
  res.json(updated);
}

async function handleDeleteNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!(await isAdminOrOwner(req, auth.userId, prisma))) return res.status(403).json({ error: 'forbidden' });

  const npc = await prisma.npc.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  // Try to despawn first (best-effort)
  try {
    await npcServiceDespawn(npc.identity, tenant.slug);
  } catch (e) {
    logger.debug('[NPC] despawn on delete failed (may not be running)', e);
  }

  // Delete media files from disk
  try {
    const mediaFiles = await prisma.npcMediaFile.findMany({ where: { npcId: npc.id } });
    const fsp = await import('fs/promises');
    const npcMediaDir = process.env.NPC_MEDIA_DIR || '/data/npc-media';
    for (const mf of mediaFiles) {
      try {
        await fsp.rm(`${npcMediaDir}/${mf.storagePath}`, { force: true });
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }

  await prisma.npc.delete({ where: { id: npc.id } });
  res.json({ ok: true });
}

async function handleSpawnNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!(await isAdminOrOwner(req, auth.userId, prisma))) return res.status(403).json({ error: 'forbidden' });

  const npc = await prisma.npc.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  try {
    const result = await npcServiceSpawn({
      npc: {
        id: npc.id,
        tenantId: npc.tenantId,
        identity: npc.identity,
        name: npc.name,
        avatarId: npc.avatarId,
        spawnX: npc.spawnX,
        spawnY: npc.spawnY,
        spawnDirection: npc.spawnDirection,
        enabled: npc.enabled,
        showBadge: npc.showBadge,
        mapName: npc.mapName,
        config: npc.config as Record<string, unknown> | null,
      },
      tenantSlug: tenant.slug,
      serverUrl: process.env.NPC_SERVER_URL || `http://localhost:${process.env.PORT || 2567}`,
      livekitUrl: process.env.LIVEKIT_URL || 'ws://livekit:7880',
      livekitApiKey: process.env.LIVEKIT_API_KEY || 'devkey',
      livekitApiSecret: process.env.LIVEKIT_API_SECRET || 'secret',
    });
    res.json({ ok: true, ...(result as Record<string, unknown>) });
  } catch (e: unknown) {
    logger.error('[NPC] spawn failed', e);
    res.status(502).json({ error: 'npc_service_error', message: e instanceof Error ? e.message : String(e) });
  }
}

async function handleDespawnNpc(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });
  if (!(await isAdminOrOwner(req, auth.userId, prisma))) return res.status(403).json({ error: 'forbidden' });

  const npc = await prisma.npc.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  try {
    await npcServiceDespawn(npc.identity, tenant.slug);
    res.json({ ok: true });
  } catch (e: unknown) {
    logger.error('[NPC] despawn failed', e);
    res.status(502).json({ error: 'npc_service_error', message: e instanceof Error ? e.message : String(e) });
  }
}

async function handleNpcCommand(req: express.Request, res: express.Response, prisma: PrismaClient) {
  const auth = await getAuth(req, prisma);
  if (!auth) return res.status(401).json({ error: 'unauthorized' });
  const tenant = getTenantFromReq(req);
  if (!tenant) return res.status(400).json({ error: 'tenant_required' });

  const npc = await prisma.npc.findFirst({ where: { id: pathParam(req, 'id'), tenantId: tenant.id } });
  if (!npc) return res.status(404).json({ error: 'not_found' });

  const parse = commandSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid_command', details: parse.error.issues });

  const cmd = parse.data;
  // `set_avatar` is the third way an avatar id reaches an NPC (create, update,
  // live command), so it carries the same ownership veto — otherwise the guard
  // on the two persisting paths is trivially bypassed by a command.
  if (cmd.action === 'set_avatar' && !(await isNpcAvatarAllowed(prisma, req, cmd.payload.avatarId))) {
    return res.status(400).json({ error: 'invalid_avatar_id' });
  }

  // For media commands, verify media file exists
  if (cmd.action === 'play_audio' || cmd.action === 'play_video' || cmd.action === 'play_screenshare') {
    const mediaFile = await prisma.npcMediaFile.findFirst({ where: { id: cmd.payload.mediaFileId, npcId: npc.id } });
    if (!mediaFile) return res.status(404).json({ error: 'media_not_found' });
    (cmd.payload as Record<string, unknown>).storagePath = mediaFile.storagePath;
    (cmd.payload as Record<string, unknown>).mimeType = mediaFile.mimeType;
  }

  // Broadcast command to all active Colyseus rooms
  const activeWorldRooms = (global as Record<string, unknown>).activeWorldRooms as Set<Room> | undefined;
  let delivered = 0;
  if (activeWorldRooms && activeWorldRooms.size > 0) {
    for (const room of activeWorldRooms) {
      try {
        if (typeof room?.broadcast === 'function') {
          room.broadcast('npc_command', { npcIdentity: npc.identity, ...cmd });
          delivered++;
        }
      } catch {
        /* ignore broadcast errors */
      }
    }
  }
  res.json({ ok: true, delivered });
}

// --- Route registration ---

export function registerNpcRoutes(app: express.Application, prisma: PrismaClient) {
  app.get('/npcs', (req, res) => handleListNpcs(req, res, prisma));
  app.post('/npcs', (req, res) => handleCreateNpc(req, res, prisma));
  app.get('/npcs/:id', (req, res) => handleGetNpc(req, res, prisma));
  app.patch('/npcs/:id', (req, res) => handleUpdateNpc(req, res, prisma));
  app.delete('/npcs/:id', (req, res) => handleDeleteNpc(req, res, prisma));
  app.post('/npcs/:id/spawn', (req, res) => handleSpawnNpc(req, res, prisma));
  app.post('/npcs/:id/despawn', (req, res) => handleDespawnNpc(req, res, prisma));
  app.post('/npcs/:id/command', (req, res) => handleNpcCommand(req, res, prisma));
}
