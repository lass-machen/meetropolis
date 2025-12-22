import type express from 'express';
import { PrismaClient } from '../../generated/prisma/index.js';
import { z } from 'zod';
import Stripe from 'stripe';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { logger } from '../../logger.js';
import {
  requireAuth,
  requireInternalOwner,
  computeOnlineUsageByTenantSlug,
  getJwtSecret,
  setAuthCookie,
  normalizeEmailForStorage,
} from '../utils/authHelpers.js';
import { getEmailService, emailTemplates } from '../../services/email.js';

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

export function registerAdminRoutes(app: express.Application, prisma: PrismaClient) {
  // Tenants list
  app.get('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const list = await prisma.tenant.findMany({ orderBy: { createdAt: 'asc' } });
    const usage = computeOnlineUsageByTenantSlug();
    const out = list.map((t: any) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      concurrentLimit: t.concurrentLimit,
      freeSeats: (t as any).freeSeats ?? 0,
      bypassLimits: !!t.bypassLimits,
      isInternal: !!t.isInternal,
      status: t.status || null,
      stripeCustomerId: t.stripeCustomerId || null,
      stripeSubscriptionId: t.stripeSubscriptionId || null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      online: usage[t.slug] || 0,
    }));
    res.json(out);
  });

  // Create tenant
  app.post('/admin/tenants', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const schema = z.object({ slug: z.string().min(2).max(64), name: z.string().min(1), concurrentLimit: z.number().int().nonnegative().default(50), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const freeDefault = typeof parse.data.freeSeats === 'number' ? parse.data.freeSeats : await getDefaultFreeSeats(prisma);
      const t = await prisma.tenant.create({ data: { slug: parse.data.slug.toLowerCase(), name: parse.data.name, concurrentLimit: parse.data.concurrentLimit, freeSeats: freeDefault, bypassLimits: !!parse.data.bypassLimits } });
      res.json({ id: t.id });
    } catch (e: any) {
      if (e?.code === 'P2002') return res.status(400).json({ error: 'slug_exists' });
      return res.status(400).json({ error: 'create_failed' });
    }
  });

  // Update tenant
  app.patch('/admin/tenants/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    const id = req.params.id;
    const schema = z.object({ name: z.string().min(1).optional(), concurrentLimit: z.number().int().nonnegative().optional(), freeSeats: z.number().int().nonnegative().optional(), bypassLimits: z.boolean().optional(), status: z.string().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const t = await prisma.tenant.update({ where: { id }, data: { name: parse.data.name ?? undefined, concurrentLimit: parse.data.concurrentLimit ?? undefined, freeSeats: parse.data.freeSeats ?? undefined, bypassLimits: parse.data.bypassLimits ?? undefined, status: parse.data.status ?? undefined } });
      res.json({ ok: true, id: t.id });
    } catch (e) {
      res.status(400).json({ error: 'update_failed' });
    }
  });

  // Billing products list
  app.get('/admin/billing/products', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const prods = await stripe.products.list({ limit: 100, expand: ['data.default_price'] });
      const prices = await stripe.prices.list({ limit: 100, expand: ['data.product'] });
      const priceByProduct = new Map<string, any[]>();
      for (const p of prices.data) {
        const pid = (typeof p.product === 'string') ? p.product : (p.product as any).id;
        const arr = priceByProduct.get(pid) || [];
        arr.push({
          id: p.id,
          unitAmount: p.unit_amount,
          currency: p.currency,
          recurring: (p.recurring || null),
          active: p.active,
          metadata: p.metadata || {},
        });
        priceByProduct.set(pid, arr);
      }
      const out = prods.data.map(pr => ({
        id: pr.id,
        name: pr.name,
        description: pr.description || null,
        active: pr.active,
        metadata: pr.metadata || {},
        prices: priceByProduct.get(pr.id) || [],
      }));
      res.json(out);
    } catch (e: any) {
      logger.error({ event: 'admin.billing.products.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'failed_to_list_products' });
    }
  });

  // Create billing product
  app.post('/admin/billing/products', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ name: z.string().min(1), description: z.string().optional(), amount: z.number().int().nonnegative(), currency: z.string().default('eur'), interval: z.enum(['month', 'year']).default('month'), concurrentLimit: z.number().int().positive() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const product = await stripe.products.create({ name: parse.data.name, description: parse.data.description, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      const price = await stripe.prices.create({ product: product.id, unit_amount: parse.data.amount, currency: parse.data.currency, recurring: { interval: parse.data.interval }, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      res.json({ id: product.id, priceId: price.id });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.products.create.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'create_failed' });
    }
  });

  // Create price for product
  app.post('/admin/billing/products/:id/prices', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ amount: z.number().int().nonnegative(), currency: z.string().default('eur'), interval: z.enum(['month', 'year']).default('month'), concurrentLimit: z.number().int().positive() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const price = await stripe.prices.create({ product: req.params.id, unit_amount: parse.data.amount, currency: parse.data.currency, recurring: { interval: parse.data.interval }, metadata: { concurrent_limit: String(parse.data.concurrentLimit) } });
      res.json({ id: price.id });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.price.create.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'create_failed' });
    }
  });

  // Update product
  app.patch('/admin/billing/products/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ name: z.string().min(1).optional(), description: z.string().optional(), active: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const pr = await stripe.products.update(req.params.id, { name: parse.data.name ?? undefined, description: parse.data.description ?? undefined, active: parse.data.active ?? undefined });
      res.json({ id: pr.id, active: pr.active });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.product.update.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  // Update price
  app.patch('/admin/billing/prices/:id', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    const schema = z.object({ active: z.boolean().optional() });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const price = await stripe.prices.update(req.params.id, { active: parse.data.active ?? undefined });
      res.json({ id: price.id, active: price.active });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.price.update.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'update_failed' });
    }
  });

  // Billing metrics
  app.get('/admin/billing/metrics', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });
    if (!process.env.STRIPE_SECRET_KEY) return res.status(501).json({ error: 'billing_not_configured' });
    try {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' } as any);
      const subs = await stripe.subscriptions.list({ status: 'all', limit: 100, expand: ['data.items.data.price.product'] });
      const now = Date.now();
      const last30 = now - 30 * 24 * 60 * 60 * 1000;
      let activeCount = 0;
      let mrrCents = 0;
      let revenue30dCents = 0;
      for (const s of subs.data) {
        const isActive = ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status as any);
        if (isActive) activeCount++;
        const it = s.items?.data?.[0];
        const price: any = it?.price;
        const amount = Number(price?.unit_amount || 0);
        const interval = price?.recurring?.interval || 'month';
        if (interval === 'month') mrrCents += amount;
        if (s.current_period_start && s.status === 'active' && s.current_period_start * 1000 >= last30) {
          revenue30dCents += amount;
        }
      }
      res.json({ activeSubscriptions: activeCount, mrrCents, revenue30dCents });
    } catch (e: any) {
      logger.error({ event: 'admin.billing.metrics.error', error: e?.message || String(e) });
      res.status(500).json({ error: 'metrics_failed' });
    }
  });

  // Public signup: create tenant + owner user and sign in
  app.post('/public/tenants', async (req: express.Request, res: express.Response) => {
    const schema = z.object({ slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(100), email: z.string().email(), password: z.string().min(8) });
    const parse = schema.safeParse(req.body || {});
    if (!parse.success) return res.status(400).json({ error: 'invalid payload' });
    const slug = parse.data.slug.toLowerCase();
    try {
      const exists = await prisma.tenant.findUnique({ where: { slug } });
      if (exists) return res.status(400).json({ error: 'slug_exists' });
      const freeDefault = await getDefaultFreeSeats(prisma);
      const tenant = await prisma.tenant.create({ data: { slug, name: parse.data.name, concurrentLimit: 0, freeSeats: freeDefault, bypassLimits: false } });
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
    } catch (e: any) {
      logger.error({ event: 'public.signup.error', error: e?.message || String(e) });
      return res.status(400).json({ error: 'signup_failed' });
    }
  });

  // Debug endpoint for Colyseus rooms
  app.get('/debug/rooms', async (_req: express.Request, res: express.Response) => {
    const gameServer = (global as any).gameServer;
    if (!gameServer) return res.json({ error: 'Game server not initialized' });

    const rooms: any[] = [];
    try {
      let roomArray: any[] = [];
      const activeWorldRooms = (global as any).activeWorldRooms;
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
    } catch (e: any) {
      return res.json({ error: 'Failed to get rooms', details: e.message });
    }

    res.json({ rooms, total: rooms.length });
  });

  // Admin System Health Dashboard
  app.get('/admin/health', async (req: express.Request, res: express.Response) => {
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

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
    } catch (e: any) {
      health.database = {
        status: 'error',
        error: e?.message || String(e),
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
      const gameServer = (global as any).gameServer;
      const activeWorldRooms = (global as any).activeWorldRooms;
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
    } catch (e: any) {
      health.websocket = {
        status: 'error',
        error: e?.message || String(e),
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

    // Stripe status
    try {
      if (process.env.STRIPE_SECRET_KEY) {
        health.stripe = {
          status: 'configured',
          webhookConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
        };
      } else {
        health.stripe = {
          status: 'not_configured',
        };
      }
    } catch {
      health.stripe = { status: 'error' };
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
    const auth = requireAuth(req);
    if (!auth) return res.status(401).json({ error: 'unauthorized' });
    const ok = await requireInternalOwner(req, auth.userId, prisma);
    if (!ok) return res.status(403).json({ error: 'forbidden' });

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
    } catch (e: any) {
      logger.error({ event: 'admin.stats.error', error: e?.message || String(e) });
      return res.status(500).json({ error: 'stats_failed' });
    }
  });
}
