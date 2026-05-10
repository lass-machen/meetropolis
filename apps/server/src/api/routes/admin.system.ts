import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { requireSuperAdmin, computeOnlineUsageByTenantSlug } from '../utils/authHelpers.js';
import { hasBillingModule } from '../../billingLoader.js';

/**
 * Returns true when the enterprise billing routes are mounted AND a Stripe
 * secret key is configured. The web client uses this capability flag to skip
 * `/billing/*` calls in OSS-only deployments where those endpoints are not
 * registered (and would otherwise produce 404 console noise).
 */
export async function computeBillingEnabled(): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  return await hasBillingModule();
}

/**
 * OSS public config — exposed without auth. Returns the public-registration
 * flag, defaulting to the PUBLIC_REGISTRATION_ENABLED env (defaults to true),
 * plus the `billingEnabled` capability flag.
 *
 * The enterprise module overrides this endpoint to read the registration flag
 * from the `internal` tenant in DB. Express dispatches to the first registered
 * handler, so the OSS variant only serves when the enterprise module is
 * absent — registerAdminRoutes is called BEFORE registerEnterpriseAdminRoutes.
 */
export async function handleOssPublicConfig(_req: express.Request, res: express.Response): Promise<void> {
  const env = process.env.PUBLIC_REGISTRATION_ENABLED;
  const enabled = env === 'false' || env === '0' ? false : true;
  const billingEnabled = await computeBillingEnabled();
  res.json({ publicRegistrationEnabled: enabled, billingEnabled });
}

export async function handleGetSettings(
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
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    res.json({
      publicRegistrationEnabled: internal?.publicRegistrationEnabled ?? true,
      defaultFreeSeats: internal?.freeSeats ?? 3,
    });
  } catch (e: unknown) {
    logger.error({ event: 'admin.settings.read_error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'settings_read_failed' });
  }
}

const settingsSchema = z.object({
  publicRegistrationEnabled: z.boolean().optional(),
  defaultFreeSeats: z.number().int().nonnegative().optional(),
});

export async function handleUpdateSettings(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const parse = settingsSchema.safeParse(req.body || {});
  if (!parse.success) {
    res.status(400).json({ error: 'invalid payload' });
    return;
  }
  try {
    const data: Record<string, unknown> = {};
    if (typeof parse.data.publicRegistrationEnabled === 'boolean') {
      data.publicRegistrationEnabled = parse.data.publicRegistrationEnabled;
    }
    if (typeof parse.data.defaultFreeSeats === 'number') {
      data.freeSeats = parse.data.defaultFreeSeats;
    }
    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'no_changes' });
      return;
    }
    await prisma.tenant.update({ where: { slug: 'internal' }, data });
    const updated = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    res.json({
      publicRegistrationEnabled: updated?.publicRegistrationEnabled ?? true,
      defaultFreeSeats: updated?.freeSeats ?? 3,
    });
  } catch (e: unknown) {
    logger.error({ event: 'admin.settings.update_error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'settings_update_failed' });
  }
}

interface RoomPlayer {
  identity?: string;
  name?: string;
  x?: number;
  y?: number;
  dnd?: boolean;
}

interface RoomLike {
  roomId?: string;
  roomName?: string;
  clients?: { size?: number; length?: number };
  locked?: boolean;
  maxClients?: number;
  metadata?: Record<string, unknown>;
  state?: { players?: Map<string, RoomPlayer> };
}

interface RoomPlayerOut {
  sessionId: string;
  identity?: string;
  name?: string;
  x?: number;
  y?: number;
  dnd?: boolean;
}

function collectRoomPlayers(room: RoomLike): RoomPlayerOut[] {
  const players: RoomPlayerOut[] = [];
  if (room.state && room.state.players) {
    room.state.players.forEach((p: RoomPlayer, sid: string) => {
      players.push({
        sessionId: sid,
        identity: p.identity,
        name: p.name,
        x: p.x,
        y: p.y,
        dnd: p.dnd,
      });
    });
  }
  return players;
}

interface GameServerLike {
  matchMaker?: { query: (q: Record<string, unknown>) => Promise<RoomLike[]> };
  rooms?: Map<string, RoomLike> | RoomLike[];
}

async function loadRoomList(gameServer: GameServerLike): Promise<RoomLike[]> {
  const activeWorldRooms = global.activeWorldRooms;
  if (activeWorldRooms && activeWorldRooms.size > 0) return Array.from(activeWorldRooms) as unknown as RoomLike[];
  if (gameServer.matchMaker) return (await gameServer.matchMaker.query({})) || [];
  if (gameServer.rooms) {
    const gameRooms = gameServer.rooms;
    return gameRooms instanceof Map ? Array.from(gameRooms.values()) : Array.from(gameRooms);
  }
  return [];
}

export async function handleDebugRooms(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const gameServer = global.gameServer as GameServerLike | undefined;
  if (!gameServer) {
    res.json({ error: 'Game server not initialized' });
    return;
  }

  const rooms: Array<{
    roomId?: string;
    roomName: string;
    clients: number;
    locked: boolean;
    maxClients: number;
    metadata: Record<string, unknown>;
    players: RoomPlayerOut[];
  }> = [];
  try {
    const roomArray = await loadRoomList(gameServer);

    roomArray.forEach((room) => {
      rooms.push({
        roomId: room.roomId,
        roomName: room.roomName || 'world',
        clients: room.clients ? room.clients.size || room.clients.length || 0 : 0,
        locked: room.locked || false,
        maxClients: room.maxClients || 0,
        metadata: room.metadata || {},
        players: collectRoomPlayers(room),
      });
    });
  } catch (e: unknown) {
    res.json({ error: 'Failed to get rooms', details: e instanceof Error ? e.message : String(e) });
    return;
  }

  res.json({ rooms, total: rooms.length });
}

type ProbeResult = Record<string, unknown>;

function buildSystemSnapshot(): ProbeResult {
  return {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    memory: {
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
      rss: process.memoryUsage().rss,
      external: process.memoryUsage().external,
    },
  };
}

async function probeDatabase(prisma: PrismaClient): Promise<ProbeResult> {
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'connected', responseTime: Date.now() - dbStart };
  } catch (e: unknown) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

async function probeCounts(prisma: PrismaClient): Promise<ProbeResult> {
  try {
    const [userCount, tenantCount, sessionCount, membershipCount] = await Promise.all([
      prisma.user.count(),
      prisma.tenant.count(),
      prisma.session.count(),
      prisma.membership.count(),
    ]);
    return { users: userCount, tenants: tenantCount, sessions: sessionCount, memberships: membershipCount };
  } catch {
    return { error: 'failed to count' };
  }
}

interface ActiveRoomCount {
  clients?: { size?: number; length?: number } | number;
}

async function probeWebsocket(): Promise<ProbeResult> {
  try {
    const gameServer = global.gameServer as GameServerLike | undefined;
    const activeWorldRooms = global.activeWorldRooms;
    let activeConnections = 0;
    let roomCount = 0;

    if (activeWorldRooms && activeWorldRooms.size > 0) {
      roomCount = activeWorldRooms.size;
      activeWorldRooms.forEach((room) => {
        const r = room as ActiveRoomCount;
        const c = r.clients;
        if (typeof c === 'object' && c !== null) {
          activeConnections += c.size || c.length || 0;
        }
      });
    } else if (gameServer?.matchMaker) {
      const allRooms = await gameServer.matchMaker.query({});
      roomCount = allRooms?.length || 0;
      (allRooms || []).forEach((r) => {
        const c = (r as ActiveRoomCount).clients;
        if (typeof c === 'number') activeConnections += c;
        else if (c && typeof c === 'object') activeConnections += c.size || c.length || 0;
      });
    }
    return { status: 'ok', activeRooms: roomCount, activeConnections };
  } catch (e: unknown) {
    return { status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

function probeLivekit(): ProbeResult {
  try {
    if (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      return {
        status: 'configured',
        url: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'not set',
      };
    }
    return { status: 'not_configured' };
  } catch {
    return { status: 'error' };
  }
}

function probeEmail(): ProbeResult {
  try {
    const emailConfig = process.env.SMTP_HOST || process.env.RESEND_API_KEY;
    return {
      status: emailConfig ? 'configured' : 'not_configured',
      provider: process.env.RESEND_API_KEY ? 'resend' : process.env.SMTP_HOST ? 'smtp' : 'none',
    };
  } catch {
    return { status: 'error' };
  }
}

function probeOnlineUsage(): { onlineByTenant: Record<string, number>; totalOnline: number } {
  try {
    const usage = computeOnlineUsageByTenantSlug();
    return {
      onlineByTenant: usage,
      totalOnline: Object.values(usage).reduce((a: number, b: number) => a + b, 0),
    };
  } catch {
    return { onlineByTenant: {}, totalOnline: 0 };
  }
}

export async function handleAdminHealth(
  prisma: PrismaClient,
  req: express.Request,
  res: express.Response,
): Promise<void> {
  const admin = await requireSuperAdmin(req, prisma);
  if (!admin) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const startTime = Date.now();
  const health: Record<string, unknown> = buildSystemSnapshot();

  health.database = await probeDatabase(prisma);
  health.counts = await probeCounts(prisma);
  health.websocket = await probeWebsocket();
  health.livekit = probeLivekit();
  health.email = probeEmail();
  const onlineMetrics = probeOnlineUsage();
  health.onlineByTenant = onlineMetrics.onlineByTenant;
  health.totalOnline = onlineMetrics.totalOnline;
  health.responseTime = Date.now() - startTime;

  res.json(health);
}

export async function handleAdminStats(
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
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      usersLast24h,
      usersLast7d,
      usersLast30d,
      tenantsLast24h,
      tenantsLast7d,
      tenantsLast30d,
      totalUsers,
      totalTenants,
      activeSessions,
      verifiedUsers,
    ] = await Promise.all([
      prisma.user.count({ where: { createdAt: { gte: last24h } } }),
      prisma.user.count({ where: { createdAt: { gte: last7d } } }),
      prisma.user.count({ where: { createdAt: { gte: last30d } } }),
      prisma.tenant.count({ where: { createdAt: { gte: last24h } } }),
      prisma.tenant.count({ where: { createdAt: { gte: last7d } } }),
      prisma.tenant.count({ where: { createdAt: { gte: last30d } } }),
      prisma.user.count(),
      prisma.tenant.count(),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
      prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
    ]);

    res.json({
      users: {
        total: totalUsers,
        last24h: usersLast24h,
        last7d: usersLast7d,
        last30d: usersLast30d,
        verified: verifiedUsers,
        verificationRate: totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0,
      },
      tenants: {
        total: totalTenants,
        last24h: tenantsLast24h,
        last7d: tenantsLast7d,
        last30d: tenantsLast30d,
      },
      sessions: { active: activeSessions },
    });
  } catch (e: unknown) {
    logger.error({ event: 'admin.stats.error', error: e instanceof Error ? e.message : String(e) });
    res.status(500).json({ error: 'stats_failed' });
  }
}
