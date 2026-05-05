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
import { registerTenantRoutes } from './api/routes/tenant.js';
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

function tenantContextFromReq(req: express.Request) {
  const t: any = (req as any).tenant;
  if (t && t.id && t.slug) {
    return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  }
  return null;
}

async function registerEnterpriseAdminRoutes(app: express.Express) {
  const adminEnterprise = await getAdminEnterpriseModule();
  if (!adminEnterprise) return;
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

async function getBillingOwnerEmail(tenantId: string): Promise<string | null> {
  try {
    const membership = await prisma.membership.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: { select: { email: true } } },
    });
    return membership?.user?.email ?? null;
  } catch {
    return null;
  }
}

function requireTenantAdminMiddleware(req: any, res: any, next: any): void {
  const auth = requireAuth(req);
  if (!auth) { res.status(401).json({ error: 'unauthorized' }); return; }
  const tenant = getTenantFromReq(req);
  if (!tenant) { res.status(400).json({ error: 'tenant_required' }); return; }
  next();
}

async function buildBillingRouter(billingModule: NonNullable<Awaited<ReturnType<typeof getBillingModule>>>) {
  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });
  const { getEmailService } = await import('./services/email.js');
  const emailServiceImpl = getEmailService();
  const emailService = {
    async send(email: { to: string; subject: string; text: string; html: string }): Promise<void> {
      await emailServiceImpl.send(email);
    },
  };

  const billingPortalUrl = process.env.BILLING_PORTAL_URL || process.env.BILLING_PUBLIC_URL || '';
  const pricingUrl = process.env.PRICING_URL || process.env.BILLING_PUBLIC_URL || '';

  const { default: express } = await import('express');
  const router = express.Router();
  billingModule.setupBillingRoutes(router, {
    prisma,
    stripe,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    emailService,
    logger,
    billingPortalUrl,
    pricingUrl,
    getOwnerEmail: getBillingOwnerEmail,
    requireTenantAdmin: requireTenantAdminMiddleware,
    getTenantId: (req: any) => getTenantFromReq(req)?.id ?? null,
    getUserId: (req: any) => getUserIdFromReq(req),
  });
  return router;
}

async function registerEnterpriseBillingRoutes(app: express.Express) {
  const billingModule = await getBillingModule();
  if (!billingModule || !process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return;
  const router = await buildBillingRouter(billingModule);
  app.use(router);
  logger.info({ event: 'billing.enterprise_routes_registered' });
}

function registerLegacyModularRoutes(app: express.Express) {
  registerPresenceRoutes(app, prisma, requireAuth, tenantContextFromReq);
  registerUserRoutes(app, prisma, requireAuth, tenantContextFromReq);
  registerApiTokenRoutes(app, prisma, requireAuth, getApiTokenPepper());
  registerControlRoutes(app, requireAuth, (req) => requireApiToken(req, prisma));

  registerNpcRoutes(app, prisma);
  registerNpcMediaRoutes(app, prisma);
}

/**
 * Register all API routes on the Express app
 */
export async function registerApi(app: express.Express) {
  registerHealthRoutes(app, prisma);
  registerDesktopRoutes(app);
  registerAuthRoutes(app, prisma);

  app.use(guestExpiryMiddleware);

  registerGuestRoutes(app, prisma);
  registerMiscRoutes(app, prisma);
  registerMapRoutes(app, prisma);
  registerTmjRoutes(app, prisma);
  registerMapObjectRoutes(app, prisma);
  registerAssetPackRoutes(app, prisma);
  registerAvatarPackRoutes(app, prisma);
  registerAdminRoutes(app, prisma);
  registerTenantRoutes(app, prisma);
  registerAdminUserRoutes(app, prisma);
  registerAdminMapRoutes(app, prisma);

  await registerEnterpriseAdminRoutes(app);
  await registerEnterpriseBillingRoutes(app);

  registerLegacyModularRoutes(app);
}
