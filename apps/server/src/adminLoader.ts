import type { Application, Request, Response } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Enterprise Admin Module interface
 * Provides admin billing routes, tenant CRUD, pricing plans, pack marketplace
 * when enterprise package is available.
 */
export interface AdminEnterpriseModule {
  readonly version: 1;

  setupAdminRoutes(
    app: Application,
    config: {
      prisma: PrismaClient;
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      requireSuperAdmin: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
    }
  ): void;

  setupTenantAdminRoutes(
    app: Application,
    config: {
      prisma: PrismaClient;
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      requireSuperAdmin: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
      computeOnlineUsageByTenantSlug: () => Record<string, number>;
      isMultiTenantEnabled: () => boolean;
      hashPassword: (password: string) => Promise<string>;
      signSessionJwt: (payload: { sub: string; tid: string }) => string;
      setAuthCookie: (res: Response, token: string) => void;
      normalizeEmail: (email: string) => string;
      copyTemplateMaps: (prisma: PrismaClient, tenantId: string) => Promise<void>;
      sendWelcomeEmail: (params: { email: string; name: string; slug: string; tenantId: string }) => void;
    }
  ): void;

  setupPricingPlanRoutes(
    app: Application,
    config: {
      prisma: PrismaClient;
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      requireSuperAdmin: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
    }
  ): void;

  setupTenantUserRoutes(
    app: Application,
    config: {
      prisma: PrismaClient;
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      requireSuperAdmin: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
      normalizeEmail: (email: string) => string;
    }
  ): void;

  setupPackMarketplaceRoutes(
    app: Application,
    config: {
      prisma: PrismaClient;
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      requireAuth: (req: Request) => { userId: string } | null;
      getTenantFromReq: (req: Request) => { id: string; slug: string } | null;
      requireMembership: (req: Request, userId: string, prisma: PrismaClient) => Promise<{ role: string } | null>;
      requireSuperAdmin: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
    }
  ): void;
}

const adminEnterpriseSchema = z.object({
  version: z.literal(1),
  setupAdminRoutes: z.function(),
  setupTenantAdminRoutes: z.function(),
  setupPricingPlanRoutes: z.function(),
  setupTenantUserRoutes: z.function(),
  setupPackMarketplaceRoutes: z.function(),
});

let cached: AdminEnterpriseModule | null = null;
let loadAttempted = false;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

/**
 * Check if enterprise admin module is available
 */
export async function hasAdminEnterpriseModule(): Promise<boolean> {
  if (loadAttempted) return cached !== null;

  try {
    await getAdminEnterpriseModule();
    return cached !== null;
  } catch {
    return false;
  }
}

/**
 * Loads the optional enterprise admin module if present.
 * Returns null for OSS builds without enterprise features.
 */
export async function getAdminEnterpriseModule(): Promise<AdminEnterpriseModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    const modUnknown: unknown = await import('@meetropolis/billing');
    const mod = adminEnterpriseSchema.parse(unwrapDefaultExport(modUnknown));

    cached = {
      version: 1,
      setupAdminRoutes: mod.setupAdminRoutes as AdminEnterpriseModule['setupAdminRoutes'],
      setupTenantAdminRoutes: mod.setupTenantAdminRoutes as AdminEnterpriseModule['setupTenantAdminRoutes'],
      setupPricingPlanRoutes: mod.setupPricingPlanRoutes as AdminEnterpriseModule['setupPricingPlanRoutes'],
      setupTenantUserRoutes: mod.setupTenantUserRoutes as AdminEnterpriseModule['setupTenantUserRoutes'],
      setupPackMarketplaceRoutes: mod.setupPackMarketplaceRoutes as AdminEnterpriseModule['setupPackMarketplaceRoutes'],
    };

    logger.info({ event: 'admin.enterprise_loaded', version: 1 });
    return cached;
  } catch {
    logger.debug({ event: 'admin.enterprise_not_available', message: 'Enterprise admin routes not loaded (OSS mode)' });
    cached = null;
    return null;
  }
}

/**
 * Get admin enterprise module synchronously (returns null if not loaded yet)
 */
export function getAdminEnterpriseModuleSync(): AdminEnterpriseModule | null {
  return cached;
}
