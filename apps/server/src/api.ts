import type express from 'express';
import { PrismaClient } from './generated/prisma/index.js';

// Route modules
import { registerAuthRoutes } from './api/routes/auth.js';
import { registerMapRoutes } from './api/routes/maps.js';
import { registerAssetPackRoutes } from './api/routes/assetPacks.js';
import { registerAvatarPackRoutes } from './api/routes/avatarPacks.js';
import { registerAdminRoutes } from './api/routes/admin.js';
import { registerAdminUserRoutes } from './api/routes/adminUsers.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerMiscRoutes } from './api/routes/misc.js';
import { registerTmjRoutes } from './api/routes/tmj.js';
import { registerMapObjectRoutes } from './api/routes/mapObjects.js';
import { registerNpcRoutes } from './api/routes/npcs.js';
import { registerNpcMediaRoutes } from './api/routes/npcMedia.js';
import { registerAdminMapRoutes } from './api/routes/adminMaps.js';
import { registerGuestRoutes } from './api/routes/guests.js';
import { registerDesktopRoutes } from './api/routes/desktop.js';
import { guestExpiryMiddleware } from './api/middleware/guestExpiry.js';

// Existing modular routes (already extracted)
import { registerApiTokenRoutes } from './api/routes/tokens.js';
import { registerPresenceRoutes } from './api/routes/presence.js';
import { registerUserRoutes } from './api/routes/users.js';
import { registerControlRoutes } from './api/routes/controls.js';

// Auth utilities for existing modular routes
import { requireAuth, requireApiToken, getApiTokenPepper, requireSuperAdmin, getTenantFromReq, requireMembership, getUserIdFromReq } from './api/utils/authHelpers.js';

// Enterprise module loaders
import { getAdminEnterpriseModule } from './adminLoader.js';
import { getBillingModule } from './billingLoader.js';
import { logger } from './logger.js';

const prisma = new PrismaClient();

/**
 * Register all API routes on the Express app
 */
export async function registerApi(app: express.Express) {
  // Health, config, readiness probes
  registerHealthRoutes(app, prisma);

  // Desktop app update & download endpoints (public, no auth required)
  registerDesktopRoutes(app);

  // Authentication routes
  registerAuthRoutes(app, prisma);

  // Guest expiry middleware (after auth, before business routes)
  app.use(guestExpiryMiddleware);

  // Guest management & guest auth routes
  registerGuestRoutes(app, prisma);

  // User management, invites, profile
  registerMiscRoutes(app, prisma);

  // Map routes (v2 state, chunks, editor, zones)
  registerMapRoutes(app, prisma);

  // TMJ import/export
  registerTmjRoutes(app, prisma);

  // Map object routes (placement, collision)
  registerMapObjectRoutes(app, prisma);

  // Asset packs upload/management
  registerAssetPackRoutes(app, prisma);

  // Avatar packs management
  registerAvatarPackRoutes(app, prisma);

  // Admin routes (tenants, billing management)
  registerAdminRoutes(app, prisma);

  // Admin user management & billing detail routes
  registerAdminUserRoutes(app, prisma);

  // Admin map management routes
  registerAdminMapRoutes(app, prisma);

  // Enterprise admin routes (billing management, pack marketplace) — loaded dynamically
  const adminEnterprise = await getAdminEnterpriseModule();
  if (adminEnterprise) {
    adminEnterprise.setupAdminRoutes(app, { prisma, logger, requireSuperAdmin });
    adminEnterprise.setupPackMarketplaceRoutes(app, {
      prisma,
      logger,
      requireAuth,
      getTenantFromReq,
      requireMembership,
      requireSuperAdmin,
    });
  }

  // Enterprise billing routes (Stripe webhook, trial, dunning, etc.)
  const billingModule = await getBillingModule();
  if (billingModule && process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET) {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
    const { getEmailService } = await import('./services/email.js');
    const emailServiceImpl = getEmailService();
    const emailService = {
      async send(email: { to: string; subject: string; text: string; html: string }): Promise<void> {
        await emailServiceImpl.send(email);
      }
    };

    const billingPortalUrl = process.env.BILLING_PORTAL_URL || process.env.BILLING_PUBLIC_URL || '';
    const pricingUrl = process.env.PRICING_URL || process.env.BILLING_PUBLIC_URL || '';

    const getOwnerEmail = async (tenantId: string): Promise<string | null> => {
      try {
        const membership = await prisma.membership.findFirst({
          where: { tenantId, role: 'owner' },
          include: { user: { select: { email: true } } },
        });
        return membership?.user?.email ?? null;
      } catch {
        return null;
      }
    };

    const requireTenantAdmin = (req: any, res: any, next: any) => {
      const auth = requireAuth(req);
      if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
      const tenant = getTenantFromReq(req);
      if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
      next();
    };

    const getTenantId = (req: any): string | null => {
      const tenant = getTenantFromReq(req);
      return tenant?.id ?? null;
    };

    const getUserId = (req: any): string | null => {
      return getUserIdFromReq(req);
    };

    const { default: express } = await import('express');
    const router = express.Router();
    billingModule.setupBillingRoutes(router, {
      prisma,
      stripe,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      emailService,
      logger,
      billingPortalUrl,
      pricingUrl,
      getOwnerEmail,
      requireTenantAdmin,
      getTenantId,
      getUserId,
    });
    app.use(router);
    logger.info({ event: 'billing.enterprise_routes_registered' });
  }

  // Existing modular routes (already extracted before this refactoring)
  registerPresenceRoutes(app, prisma, requireAuth, (req) => {
    const t: any = (req as any).tenant;
    if (t && t.id && t.slug) return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
    return null;
  });
  registerUserRoutes(app, prisma, requireAuth, (req) => {
    const t: any = (req as any).tenant;
    if (t && t.id && t.slug) return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
    return null;
  });
  registerApiTokenRoutes(app, prisma, requireAuth, getApiTokenPepper());
  registerControlRoutes(app, requireAuth, (req) => requireApiToken(req, prisma));

  // NPC management routes
  registerNpcRoutes(app, prisma);
  registerNpcMediaRoutes(app, prisma);
}
