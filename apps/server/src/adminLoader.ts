import type { Application, Request, Response } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Expected `version` of the shared `@meetropolis/billing` module.
 *
 * The enterprise admin routes ship inside the SAME closed-source
 * `@meetropolis/billing` package as the billing routes (see `billingLoader.ts`).
 * That package exposes a single `version` const, so this literal MUST equal
 * `EXPECTED_BILLING_MODULE_VERSION` and evolve in lockstep. Bumping one loader
 * without the other makes `adminEnterpriseSchema.parse()` throw, which silently
 * drops every admin route on a full enterprise deployment.
 *
 * Raised from 1 to 2 together with the package, when the billing loader
 * interface lost the Stripe-typed config slot and gained
 * `installEarlyMiddleware`. Raised from 2 to 3 in lockstep with the billing
 * loader, when `setupBillingRoutes` gained the generic `getConcurrentUsage`
 * config slot (this admin package ships alongside billing, so it must move
 * synchronously). Older enterprise builds that still report an earlier version
 * must not load against this host.
 */
export const EXPECTED_ADMIN_MODULE_VERSION = 3 as const;

/**
 * Enterprise Admin Module interface
 * Provides admin billing routes, tenant CRUD, pricing plans, pack marketplace
 * when enterprise package is available.
 */
export interface AdminEnterpriseModule {
  readonly version: typeof EXPECTED_ADMIN_MODULE_VERSION;

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
    },
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
      // `name` is the TENANT/company name; `ownerName` is the natural person who
      // signed up and is what the mail's greeting must address. Keeping them
      // apart is what stops the welcome mail from opening with "Hallo <Firma>".
      // Optional field ⇒ function surface unchanged ⇒ no version bump.
      sendWelcomeEmail: (params: {
        email: string;
        name: string;
        slug: string;
        tenantId: string;
        ownerName?: string | null;
      }) => void;
      // Optional: resolves the caller's live session (or null). The EE public
      // signup uses it to authorise the single case where signup touches an
      // EXISTING account — attaching it to a new tenant — which an anonymous
      // caller must never be able to do. Absent ⇒ the EE handler refuses that
      // branch outright (fails closed). Optional field, no version bump.
      requireAuth?: (req: Request) => { userId: string } | null;
      // Optional: starts a real, revocable session (writes the `Session` row,
      // THEN sets the cookie) and returns the token. On a session-backed host
      // this is what makes the signup cookie authenticate at all: the legacy
      // signSessionJwt + setAuthCookie pair mints a signature with no session
      // row behind it, which the session middleware correctly rejects — the
      // customer would be logged out the moment the account is created.
      // Absent ⇒ EE falls back to the legacy pair. No version bump (optional
      // field, same pattern as isNativeClientRequest).
      establishSession?: (p: {
        req: Request;
        res: Response;
        userId: string;
        tenantId: string;
      }) => Promise<{ token: string; sessionId: string; expiresAt: Date }>;
      // Optional: kicks off e-mail verification for a freshly created account.
      // The verification machinery is OSS-internal and cannot be imported from
      // the closed-source package, so the host injects it. Called detached by
      // EE. Absent ⇒ no verification mail. Optional field, no version bump.
      startEmailVerification?: (p: { req: Request; userId: string }) => Promise<unknown>;
      // Optional: lets the EE public-signup handler return the session token in
      // the response body for native (Tauri desktop) clients, which cannot use
      // the cross-site auth cookie. Older EE builds ignore it; when the host
      // omits it the handler falls back to cookie-only behaviour. Adding an
      // optional config field does not change the module's function surface, so
      // it stays within schema version 2 (no version bump required).
      isNativeClientRequest?: (req: Request) => boolean;
      // Optional: host-callback returning the telemetry activation block for
      // GET /public/config ({ enabled, environment }) or null when telemetry is
      // off. The enterprise /public/config handler wins over the OSS fallback
      // (handleOssPublicConfig), so the host injects this from the closed-source
      // telemetry module to keep browser-telemetry activation reaching the wire
      // in enterprise deployments. Undefined (inert) in OSS-only builds; adding
      // an optional config field keeps the function surface unchanged, so no
      // schema version bump is required.
      getTelemetryPublicConfig?: () => { enabled: boolean; environment: string } | null;
    },
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
    },
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
    },
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
    },
  ): void;

  /**
   * Desktop update + download routes for the Tauri updater. Reuses the same
   * `@meetropolis/billing` module as the other enterprise admin routes.
   * Returns 503 at request time when no GitHub PAT is configured.
   */
  setupDesktopUpdateRoutes?(
    app: Application,
    config: {
      logger?: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      githubPat?: string;
      githubRepo?: string;
      cacheTtlMs?: number;
    },
  ): void;
}

export const adminEnterpriseSchema = z.object({
  // Shares the single `version` const of `@meetropolis/billing`; kept in
  // lockstep with `billingLoader` via EXPECTED_ADMIN_MODULE_VERSION.
  version: z.literal(EXPECTED_ADMIN_MODULE_VERSION),
  setupAdminRoutes: z.function(),
  setupTenantAdminRoutes: z.function(),
  setupPricingPlanRoutes: z.function(),
  setupTenantUserRoutes: z.function(),
  setupPackMarketplaceRoutes: z.function(),
  // Optional: older enterprise builds may not ship the desktop update routes.
  setupDesktopUpdateRoutes: z.function().optional(),
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
      version: EXPECTED_ADMIN_MODULE_VERSION,
      setupAdminRoutes: mod.setupAdminRoutes as AdminEnterpriseModule['setupAdminRoutes'],
      setupTenantAdminRoutes: mod.setupTenantAdminRoutes as AdminEnterpriseModule['setupTenantAdminRoutes'],
      setupPricingPlanRoutes: mod.setupPricingPlanRoutes as AdminEnterpriseModule['setupPricingPlanRoutes'],
      setupTenantUserRoutes: mod.setupTenantUserRoutes as AdminEnterpriseModule['setupTenantUserRoutes'],
      setupPackMarketplaceRoutes: mod.setupPackMarketplaceRoutes as AdminEnterpriseModule['setupPackMarketplaceRoutes'],
      setupDesktopUpdateRoutes: mod.setupDesktopUpdateRoutes as AdminEnterpriseModule['setupDesktopUpdateRoutes'],
    };

    logger.info({ event: 'admin.enterprise_loaded', version: EXPECTED_ADMIN_MODULE_VERSION });
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
