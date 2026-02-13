import type express from 'express';
import { PrismaClient } from './generated/prisma/index.js';

// Route modules
import { registerAuthRoutes } from './api/routes/auth.js';
import { registerMapRoutes } from './api/routes/maps.js';
import { registerAssetPackRoutes } from './api/routes/assetPacks.js';
import { registerAvatarPackRoutes } from './api/routes/avatarPacks.js';
import { registerBillingRoutes } from './api/routes/billing.js';
import { registerAdminRoutes } from './api/routes/admin.js';
import { registerHealthRoutes } from './api/routes/health.js';
import { registerMiscRoutes } from './api/routes/misc.js';
import { registerTmjRoutes } from './api/routes/tmj.js';
import { registerMapObjectRoutes } from './api/routes/mapObjects.js';
import { registerNpcRoutes } from './api/routes/npcs.js';
import { registerNpcMediaRoutes } from './api/routes/npcMedia.js';
import { registerPackCatalogAdminRoutes } from './api/routes/packCatalogAdmin.js';
import { registerPackStoreRoutes } from './api/routes/packStore.js';

// Existing modular routes (already extracted)
import { registerApiTokenRoutes } from './api/routes/tokens.js';
import { registerPresenceRoutes } from './api/routes/presence.js';
import { registerUserRoutes } from './api/routes/users.js';
import { registerControlRoutes } from './api/routes/controls.js';

// Auth utilities for existing modular routes
import { requireAuth, requireApiToken, getApiTokenPepper } from './api/utils/authHelpers.js';

const prisma = new PrismaClient();

/**
 * Register all API routes on the Express app
 */
export async function registerApi(app: express.Express) {
  // Health, config, readiness probes
  registerHealthRoutes(app, prisma);

  // Authentication routes
  registerAuthRoutes(app, prisma);

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

  // Billing (Stripe) - async to allow enterprise module loading
  await registerBillingRoutes(app, prisma);

  // Admin routes (tenants, billing management)
  registerAdminRoutes(app, prisma);

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

  // Pack catalog admin + pack store routes
  registerPackCatalogAdminRoutes(app, prisma);
  registerPackStoreRoutes(app, prisma);

  // NPC management routes
  registerNpcRoutes(app, prisma);
  registerNpcMediaRoutes(app, prisma);
}
