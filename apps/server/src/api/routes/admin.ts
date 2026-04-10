import type express from 'express';
import { Prisma, PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../../logger.js';
import {
  requireSuperAdmin,
  computeOnlineUsageByTenantSlug,
  getJwtSecret,
  setAuthCookie,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { getEmailService, emailTemplates } from '../../services/email.js';
import { getTenancyModule } from '../../tenancyLoader.js';

async function getDefaultFreeSeats(prisma: PrismaClient): Promise<number> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const v = (internal as any)?.freeSeats;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  } catch { }
  const envV = Number(process.env.FREE_SEATS_DEFAULT || '');
  if (Number.isFinite(envV) && envV >= 0) return envV;
  return 3;
}

async function isPublicRegistrationEnabled(prisma: PrismaClient): Promise<boolean> {
  try {
    const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
    const v = (internal as any)?.publicRegistrationEnabled;
    if (typeof v === 'boolean') return v;
  } catch { }
  const envV = process.env.PUBLIC_REGISTRATION_ENABLED;
  if (envV === 'false' || envV === '0') return false;
  return true;
}

export function registerAdminRoutes(app: express.Application, prisma: PrismaClient) {
  // Public config endpoint (no auth required) — exposes non-sensitive system settings
  app.get('/public/config', async (_req: express.Request, res: express.Response) => {
    try {
      const internal = await prisma.tenant.findUnique({ where: { slug: 'internal' } });
      res.json({
        publicRegistrationEnabled: internal?.publicRegistrationEnabled ?? true,
      });
    } catch {
      // Fallback: if DB is unreachable, default to true for backwards compatibility
      res.json({ publicRegistrationEnabled: true });
    }
  });

  // Tenants list
  app.get('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const list = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const usage = computeOnlineUsageByTenantSlug();
    const out = list.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      concurrentLimit: t.concurrentLimit,
      freeSeats: t.freeSeats ?? 0,
      bypassLimits: !!t.bypassLimits,
      isInternal: !!t.isInternal,
      publicRegistrationEnabled: !!t.publicRegistrationEnabled,
      defaultMapName: t.defaultMapName ?? null,
      status: t.status ?? null,
      stripeCustomerId: t.stripeCustomerId ?? null,
      stripeSubscriptionId: t.stripeSubscriptionId ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      online: usage[t.slug] || 0,
    }));
    res.json(out);
  });

  // Create tenant
  app.post('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({ slug: z.string().min(2).max(64), name: z.string().min(1), concurrentLimit: z.number().int().nonnegative().default(50), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const freeDefault = typeof parse.data.freeSeats === 'number' ? parse.data.freeSeats : await getDefaultFreeSeats(prisma);
      const t = await prisma.tenant.create({ data: { slug: parse.data.slug.toLowerCase(), name: parse.data.name, concurrentLimit: parse.data.concurrentLimit, freeSeats: freeDefault, bypassLimits: !!parse.data.bypassLimits } });
      res.json({ id: t.id });
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') return res.status(400).json({ error: 'slug_exists' });
      return res.status(400).json({ error: 'create_failed' });
    }
  });

  // Update tenant
  app.patch('/admin/tenants/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const id = req.params.id;
    const schema = z.object({ name: z.string().min(1).optional(), concurrentLimit: z.number().int().nonnegative().optional(), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional(), defaultMapName: z.string().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      // Validate defaultMapName if provided
      if (parse.data.defaultMapName) {
        const mapExists = await prisma.map.findFirst({ where: { tenantId: id, name: parse.data.defaultMapName } });
        if (!mapExists) return res.status(400).json({ error: 'map_not_found', message: `No map named "${parse.data.defaultMapName}" exists for this tenant.` });
      }
      const t = await prisma.tenant.update({ where: { id }, data: { name: parse.data.name ?? undefined, concurrentLimit: parse.data.concurrentLimit ?? undefined, freeSeats: parse.data.freeSeats ?? undefined, bypassLimits: parse.data.bypassLimits ?? undefined, defaultMapName: parse.data.defaultMapName ?? undefined } });
      res.json({ ok: true, id: t.id });
    } catch (e) {
      res.status(400).json({ error: 'update_failed' });
    }
  });

  // Delete tenant (cascade)
  app.delete('/admin/tenants/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const id = req.params.id;

    // Safety: internal tenant cannot be deleted
    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) return res.status(404).json({ error: 'not_found' });
    if (tenant.isInternal) return res.status(400).json({ error: 'cannot_delete_internal' });

    try {
      // Cascade deletion
      await prisma.presence.deleteMany({ where: { tenantId: id } });
      await prisma.invite.deleteMany({ where: { tenantId: id } });
      await prisma.membership.deleteMany({ where: { tenantId: id } });
      await prisma.tenant.delete({ where: { id } });

      logger.info({ event: 'admin.tenant_deleted', tenantId: id, deletedBy: admin.userId });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.tenant_delete.error', error: e instanceof Error ? e.message : String(e) });
      res.status(500).json({ error: 'delete_failed' });
    }
  });

  // Public signup: create tenant + owner user and sign in
  app.post('/public/tenants', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(100), email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });

    // Multi-tenant gate: only allow signup when multi-tenant is enabled
    const tenancy = await getTenancyModule();
    if (!tenancy.isMultiTenantEnabled()) {
      return res.status(403).json({ error: 'multi_tenant_required' });
    }

    // Public registration gate
    if (!(await isPublicRegistrationEnabled(prisma))) {
      return res.status(403).json({ error: 'registration_disabled' });
    }

    const slug = parse.data.slug.toLowerCase();
    try {
      const exists = await prisma.tenant.findUnique({ where: { slug } });
      if (exists) return res.status(400).json({ error: 'slug_exists' });
      const freeDefault = await getDefaultFreeSeats(prisma);
      const tenant = await prisma.tenant.create({ data: { slug, name: parse.data.name, concurrentLimit: 0, freeSeats: freeDefault, bypassLimits: false } });

      // Copy maps from template tenant if configured
      const templateSlug = process.env.TEMPLATE_TENANT_SLUG;
      if (templateSlug) {
        try {
          const templateTenant = await prisma.tenant.findUnique({
            where: { slug: templateSlug },
            include: { maps: true },
          });
          if (templateTenant?.maps?.length) {
            const { copyMapToTenant } = await import('./adminMaps.js');
            for (const tplMap of templateTenant.maps) {
              await copyMapToTenant(prisma, tplMap.id, tenant.id, tplMap.name);
            }
            // Adopt defaultMapName from template tenant
            if (templateTenant.defaultMapName) {
              await prisma.tenant.update({
                where: { id: tenant.id },
                data: { defaultMapName: templateTenant.defaultMapName },
              });
            }
          }
        } catch (e) {
          logger.error({ event: 'signup.template_copy_failed', tenantId: tenant.id, error: String(e) });
          // Non-blocking: Tenant exists, maps are just missing
        }
      }

      const email = normalizeEmailForStorage(parse.data.email);
      const hash = await bcrypt.hash(parse.data.password, 10);
      let user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
      if (!user) {
        user = await prisma.user.create({ data: { email, name: parse.data.name, passwordHash: hash, emailVerifiedAt: new Date() } });
      }
      await prisma.membership.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: (user as any).id } } as any, update: { role: 'owner' as any }, create: { tenantId: tenant.id, userId: (user as any).id, role: 'owner' as any } });
      const token = jwt.sign({ sub: (user as any).id, tid: tenant.id }, getJwtSecret(), { expiresIn: '30d' });
      setAuthCookie(res, token);

      // Send welcome email asynchronously
      const loginUrl = process.env.BILLING_PUBLIC_URL
        ? `${process.env.BILLING_PUBLIC_URL.replace(/\/$/, '')}/#/app`
        : `https://${slug}.meetropolis.de`;
      const emailService = getEmailService();
      const emailContent = emailTemplates.welcomeTenant({
        name: parse.data.name,
        tenantName: parse.data.name,
        loginUrl,
      });
      emailContent.to = email;
      emailService.send(emailContent).catch((e) => {
        logger.error({ event: 'signup.welcome_email_failed', tenantId: tenant.id, error: String(e) });
      });

      return res.json({ ok: true, tenant: { id: tenant.id, slug: tenant.slug, freeSeats: tenant.freeSeats }, user: { id: (user as any).id, email: (user as any).email } });
    } catch (e: unknown) {
      logger.error({ event: 'public.signup.error', error: e instanceof Error ? e.message : String(e) });
      return res.status(400).json({ error: 'signup_failed' });
    }
  });

  // System settings (read from internal tenant)
  app.get('/admin/settings', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
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
  });

  app.patch('/admin/settings', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({
      publicRegistrationEnabled: z.boolean().optional(),
      defaultFreeSeats: z.number().int().nonnegative().optional(),
    });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const data: Record<string, unknown> = {};
      if (typeof parse.data.publicRegistrationEnabled === 'boolean') {
        data.publicRegistrationEnabled = parse.data.publicRegistrationEnabled;
      }
      if (typeof parse.data.defaultFreeSeats === 'number') {
        data.freeSeats = parse.data.defaultFreeSeats;
      }
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: 'no_changes' });
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
  });

  // Debug endpoint for Colyseus rooms
  app.get('/debug/rooms', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const gameServer = global.gameServer;
    if (!gameServer) return res.json({ error: 'Game server not initialized' });

    const rooms: any[] = [];
    try {
      let roomArray: any[] = [];
      const activeWorldRooms = global.activeWorldRooms;
      if (activeWorldRooms && activeWorldRooms.size > 0) {
        roomArray = Array.from(activeWorldRooms);
      } else if (gameServer.matchMaker) {
        const allRooms = await gameServer.matchMaker.query({}) || [];
        roomArray = allRooms;
      } else if (gameServer.rooms) {
        const gameRooms = gameServer.rooms;
        roomArray = gameRooms instanceof Map ? Array.from(gameRooms.values()) : Array.from(gameRooms);
      }

      roomArray.forEach((room: any) => {
        const players: any[] = [];
        if (room.state && room.state.players) {
          room.state.players.forEach((p: any, sid: string) => {
            players.push({
              sessionId: sid,
              identity: p.identity,
              name: p.name,
              x: p.x,
              y: p.y,
              dnd: p.dnd
            });
          });
        }
        rooms.push({
          roomId: room.roomId,
          roomName: room.roomName || 'world',
          clients: room.clients ? room.clients.size || room.clients.length : 0,
          locked: room.locked || false,
          maxClients: room.maxClients || 0,
          metadata: room.metadata || {},
          players
        });
      });
    } catch (e: unknown) {
      return res.json({ error: 'Failed to get rooms', details: e instanceof Error ? e.message : String(e) });
    }

    res.json({ rooms, total: rooms.length });
  });

  // Admin System Health Dashboard
  app.get('/admin/health', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    const startTime = Date.now();
    const health: Record<string, any> = {
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

    // Database health
    try {
      const dbStart = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      health.database = {
        status: 'connected',
        responseTime: Date.now() - dbStart,
      };
    } catch (e: unknown) {
      health.database = {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // Count models
    try {
      const [userCount, tenantCount, sessionCount, membershipCount] = await Promise.all([
        prisma.user.count(),
        prisma.tenant.count(),
        prisma.session.count(),
        prisma.membership.count(),
      ]);
      health.counts = {
        users: userCount,
        tenants: tenantCount,
        sessions: sessionCount,
        memberships: membershipCount,
      };
    } catch {
      health.counts = { error: 'failed to count' };
    }

    // Active WebSocket connections
    try {
      const gameServer = global.gameServer;
      const activeWorldRooms = global.activeWorldRooms;
      let activeConnections = 0;
      let roomCount = 0;

      if (activeWorldRooms && activeWorldRooms.size > 0) {
        roomCount = activeWorldRooms.size;
        activeWorldRooms.forEach((room: any) => {
          activeConnections += room.clients?.size || room.clients?.length || 0;
        });
      } else if (gameServer?.matchMaker) {
        const allRooms = await gameServer.matchMaker.query({});
        roomCount = allRooms?.length || 0;
        (allRooms || []).forEach((r: any) => {
          activeConnections += r.clients || 0;
        });
      }

      health.websocket = {
        status: 'ok',
        activeRooms: roomCount,
        activeConnections,
      };
    } catch (e: unknown) {
      health.websocket = {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      };
    }

    // LiveKit status
    try {
      if (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        health.livekit = {
          status: 'configured',
          url: process.env.LIVEKIT_EXTERNAL_URL || process.env.LIVEKIT_URL || 'not set',
        };
      } else {
        health.livekit = {
          status: 'not_configured',
        };
      }
    } catch {
      health.livekit = { status: 'error' };
    }

    // Email service status
    try {
      const emailConfig = process.env.SMTP_HOST || process.env.RESEND_API_KEY;
      health.email = {
        status: emailConfig ? 'configured' : 'not_configured',
        provider: process.env.RESEND_API_KEY ? 'resend' : (process.env.SMTP_HOST ? 'smtp' : 'none'),
      };
    } catch {
      health.email = { status: 'error' };
    }

    // Online users by tenant (from Colyseus state)
    try {
      const usage = computeOnlineUsageByTenantSlug();
      health.onlineByTenant = usage;
      health.totalOnline = Object.values(usage).reduce((a: number, b: number) => a + b, 0);
    } catch {
      health.onlineByTenant = {};
      health.totalOnline = 0;
    }

    // Response time
    health.responseTime = Date.now() - startTime;

    res.json(health);
  });

  // Admin System Stats (for dashboard charts)
  app.get('/admin/stats', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });

    try {
      // Get stats over time
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
        sessions: {
          active: activeSessions,
        },
      });
    } catch (e: unknown) {
      logger.error({ event: 'admin.stats.error', error: e instanceof Error ? e.message : String(e) });
      return res.status(500).json({ error: 'stats_failed' });
    }
  });

  // ── Pricing Plans ──────────────────────────────────────────────────────

  // Prisma JSON fields reject raw `null`; they require Prisma.JsonNull instead.
  const JSON_NULLABLE_KEYS: ReadonlySet<string> = new Set([
    'description', 'priceLabel', 'unitLabel', 'badgeLabel',
  ]);
  function sanitiseJsonNulls<T extends Record<string, unknown>>(data: T): T {
    const out = { ...data };
    for (const key of JSON_NULLABLE_KEYS) {
      if (key in out && out[key] === null) {
        (out as Record<string, unknown>)[key] = Prisma.JsonNull;
      }
    }
    return out;
  }

  const i18nTextSchema = z.object({ en: z.string(), de: z.string() });

  const pricingPlanCreateSchema = z.object({
    name: i18nTextSchema,
    description: i18nTextSchema.optional().nullable(),
    stripeProductId: z.string().optional().nullable(),
    stripePriceId: z.string().optional().nullable(),
    priceAmount: z.number().int().nonnegative().optional().nullable(),
    priceCurrency: z.string().default('EUR'),
    priceInterval: z.enum(['month', 'year']).optional().nullable(),
    priceLabel: i18nTextSchema.optional().nullable(),
    unitLabel: i18nTextSchema.optional().nullable(),
    features: z.array(i18nTextSchema).default([]),
    ctaLabel: i18nTextSchema,
    ctaUrl: z.string().optional().nullable(),
    highlighted: z.boolean().default(false),
    badgeLabel: i18nTextSchema.optional().nullable(),
    customPricing: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    visible: z.boolean().default(true),
  });

  // Public pricing plans (no auth required) — serves landing page
  app.get('/public/pricing-plans', async (_req: express.Request, res: express.Response) => {
    try {
      const plans = await prisma.pricingPlan.findMany({
        where: { visible: true },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({
        plans: plans.map(({ stripeProductId, stripePriceId, visible, createdAt, updatedAt, ...rest }) => rest),
      });
    } catch (e: unknown) {
      logger.error({ event: 'public.pricing_plans.error', error: e instanceof Error ? e.message : String(e) });
      res.json({ plans: [] });
    }
  });

  // Admin: list all pricing plans (including invisible)
  app.get('/admin/pricing-plans', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const plans = await prisma.pricingPlan.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ plans });
  });

  // Admin: create pricing plan
  app.post('/admin/pricing-plans', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const parse = pricingPlanCreateSchema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.flatten() });
    try {
      const plan = await prisma.pricingPlan.create({ data: sanitiseJsonNulls(parse.data) as any });
      res.json(plan);
    } catch (e: unknown) {
      logger.error({ event: 'admin.pricing_plan.create_error', error: e instanceof Error ? e.message : String(e) });
      res.status(400).json({ error: 'create_failed' });
    }
  });

  // Admin: update pricing plan
  app.patch('/admin/pricing-plans/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const { id } = req.params;
    const parse = pricingPlanCreateSchema.partial().safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload', details: parse.error.flatten() });
    try {
      const plan = await prisma.pricingPlan.update({ where: { id }, data: sanitiseJsonNulls(parse.data) as any });
      res.json(plan);
    } catch (e: unknown) {
      logger.error({ event: 'admin.pricing_plan.update_error', error: e instanceof Error ? e.message : String(e) });
      res.status(400).json({ error: 'update_failed' });
    }
  });

  // Admin: delete pricing plan
  app.delete('/admin/pricing-plans/:id', async (req: express.Request, res: express.Response) => {
    const admin = await requireSuperAdmin(req, prisma);
    if (!admin) return res.status(403).json({ error: 'forbidden' });
    const { id } = req.params;
    try {
      await prisma.pricingPlan.delete({ where: { id } });
      res.json({ ok: true });
    } catch (e: unknown) {
      logger.error({ event: 'admin.pricing_plan.delete_error', error: e instanceof Error ? e.message : String(e) });
      res.status(400).json({ error: 'delete_failed' });
    }
  });
}
