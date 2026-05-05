import type express from 'express';
import { PrismaClient } from './generated/prisma/index.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// Route modules
import { registerAuthRoutes } from './api/routes/auth.js';
import { registerMapRoutes } from './api/routes/maps.js';
import { registerAssetPackRoutes } from './api/routes/assetPacks.js';
import { registerAvatarPackRoutes } from './api/routes/avatarPacks.js';
import { registerAdminRoutes } from './api/routes/admin.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerMiscRoutes } from './api/routes/misc.js';
import { registerTmjRoutes } from './api/routes/tmj.js';
import { registerMapObjectRoutes } from './api/routes/mapObjects.js';
import { registerNpcRoutes } from './api/routes/npcs.js';
import { registerNpcMediaRoutes } from './api/routes/npcMedia.js';
import { registerAdminMapRoutes } from './api/routes/adminMaps.js';
import { copyMapToTenant } from './api/routes/adminMaps.js';
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
import {
  requireAuth, requireApiToken, getApiTokenPepper, requireSuperAdmin,
  getTenantFromReq, requireMembership, getUserIdFromReq,
  computeOnlineUsageByTenantSlug, getJwtSecret, setAuthCookie,
  normalizeEmailForStorage,
} from './api/utils/authHelpers.js';

// Enterprise module loaders
import { getAdminEnterpriseModule } from './adminLoader.js';
import { getBillingModule } from './billingLoader.js';
import { getTenancyModule } from './tenancyLoader.js';
import { logger } from './logger.js';
import { getEmailService, emailTemplates } from './services/email.js';

const prisma = new PrismaClient();

function tenantContextFromReq(req: express.Request) {
  const t: any = (req as any).tenant;
  if (t && t.id && t.slug) {
    return { id: t.id, slug: t.slug, bypassLimits: !!t.bypassLimits, isInternal: !!t.isInternal };
  }
  return null;
}

async function copyTemplateMapsForSignup(prismaClient: PrismaClient, tenantId: string): Promise<void> {
  const templateSlug = process.env.TEMPLATE_TENANT_SLUG;
  if (!templateSlug) return;
  try {
    const templateTenant = await prismaClient.tenant.findUnique({
      where: { slug: templateSlug },
      include: { maps: true },
    });
    if (!templateTenant?.maps?.length) return;
    for (const tplMap of templateTenant.maps) {
      await copyMapToTenant(prismaClient, tplMap.id, tenantId, tplMap.name);
    }
    if (templateTenant.defaultMapName) {
      await prismaClient.tenant.update({
        where: { id: tenantId },
        data: { defaultMapName: templateTenant.defaultMapName },
      });
    }
  } catch (e) {
    logger.error({ event: 'signup.template_copy_failed', tenantId, error: String(e) });
  }
}

function sendSignupWelcomeEmail(params: { email: string; name: string; slug: string; tenantId: string }): void {
  const { email, name, slug, tenantId } = params;
  const loginUrl = process.env.BILLING_PUBLIC_URL
    ? `${process.env.BILLING_PUBLIC_URL.replace(/\/$/, '')}/#/app`
    : `https://${slug}.meetropolis.de`;
  const emailService = getEmailService();
  const emailContent = emailTemplates.welcomeTenant({
    name,
    tenantName: name,
    loginUrl,
  });
  emailContent.to = email;
  emailService.send(emailContent).catch((e: unknown) => {
    logger.error({ event: 'signup.welcome_email_failed', tenantId, error: String(e) });
  });
}

async function registerEnterpriseAdminRoutes(app: express.Express) {
  const adminEnterprise = await getAdminEnterpriseModule();
  if (!adminEnterprise) return;

  const tenancy = await getTenancyModule();

  adminEnterprise.setupAdminRoutes(app, { prisma, logger, requireSuperAdmin });

  adminEnterprise.setupTenantAdminRoutes(app, {
    prisma: prisma as any,
    logger,
    requireSuperAdmin: requireSuperAdmin as any,
    computeOnlineUsageByTenantSlug,
    isMultiTenantEnabled: () => tenancy.isMultiTenantEnabled(),
    hashPassword: (password: string) => bcrypt.hash(password, 10),
    signSessionJwt: (payload) => jwt.sign(payload, getJwtSecret(), { expiresIn: '30d' }),
    setAuthCookie,
    normalizeEmail: normalizeEmailForStorage,
    copyTemplateMaps: (p, tenantId) => copyTemplateMapsForSignup(p as any, tenantId),
    sendWelcomeEmail: sendSignupWelcomeEmail,
  });

  adminEnterprise.setupPricingPlanRoutes(app, {
    prisma: prisma as any,
    logger,
    requireSuperAdmin: requireSuperAdmin as any,
  });

  adminEnterprise.setupTenantUserRoutes(app, {
    prisma: prisma as any,
    logger,
    requireSuperAdmin: requireSuperAdmin as any,
    normalizeEmail: normalizeEmailForStorage,
  });

  adminEnterprise.setupPackMarketplaceRoutes(app, {
    prisma: prisma as any,
    logger,
    requireAuth,
    getTenantFromReq,
    requireMembership: requireMembership as any,
    requireSuperAdmin: requireSuperAdmin as any,
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
 * Register all API routes on the Express app.
 *
 * Order matters: enterprise admin/tenant/pricing routes must be registered
 * BEFORE the OSS admin fallback so the enterprise variants of `/public/config`
 * win when the optional module is present. registerAdminUserRoutes registers
 * Multi-Tenant user-management routes; in OSS-only installs these are
 * harmless because the routes operate on a single internal tenant.
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

  // Enterprise admin/tenant/pricing first — Express dispatches to the first match,
  // so enterprise variants of /public/config and /admin/settings win when present.
  await registerEnterpriseAdminRoutes(app);
  await registerEnterpriseBillingRoutes(app);

  // OSS fallback admin routes (only health/stats/debug + minimal /public/config).
  registerAdminRoutes(app, prisma);
  registerTenantRoutes(app, prisma);
  registerAdminMapRoutes(app, prisma);

  registerLegacyModularRoutes(app);
}
