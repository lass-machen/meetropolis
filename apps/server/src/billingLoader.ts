import type { Router, Request, Response, NextFunction, Express } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Expected `version` of the `@meetropolis/billing` module. Single source of
 * truth for the loader's compatibility check: the zod schema, the cached module
 * and the load log all derive from it. MUST equal `EXPECTED_ADMIN_MODULE_VERSION`
 * in `adminLoader.ts`, since the admin routes ship inside this very package.
 */
export const EXPECTED_BILLING_MODULE_VERSION = 3 as const;

/**
 * Enterprise Billing Module interface.
 *
 * This interface is the contract between the OSS host (this file) and the
 * closed-source `@meetropolis/billing` package. Both sides MUST be evolved in
 * lockstep:
 *
 * - When the OSS-facing `setupBillingRoutes` config slot changes shape, bump
 *   the `version` literal AND the `@meetropolis/billing` package major version.
 * - When the EE side adds new entry points (e.g. `installEarlyMiddleware`),
 *   add them here as `optional` so older EE builds still load.
 *
 * The OSS server intentionally knows nothing about Stripe types. Stripe is an
 * implementation detail of the EE module; this loader sees only generic
 * Express + Prisma types and a few callback shapes.
 */
export interface BillingModule {
  readonly version: typeof EXPECTED_BILLING_MODULE_VERSION;

  /**
   * Register the `/billing/*` routes on the supplied router. The EE module
   * reads `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from its own
   * `process.env`; the OSS host never reads or forwards them.
   */
  setupBillingRoutes(
    router: Router,
    config: {
      prisma: PrismaClient;
      emailService: {
        send(email: { to: string; subject: string; text: string; html: string }): Promise<void>;
      };
      logger: {
        info(obj: object): void;
        error(obj: object): void;
        warn(obj: object): void;
      };
      billingPortalUrl: string;
      pricingUrl: string;
      getOwnerEmail: (tenantId: string) => Promise<string | null>;
      requireTenantAdmin: (req: Request, res: Response, next: NextFunction) => void;
      /**
       * Optional super-admin gate. Without it the EE module cannot authorise
       * its operator-only endpoints and answers 501 — which is what happened to
       * `/billing/webhook-health`: the alarm that is supposed to make a webhook
       * outage visible could never fire, so the outage stayed invisible exactly
       * when it mattered. Optional (and therefore backward-compatible, no loader
       * version bump) because an OSS-only host has no such gate to inject.
       */
      requireSuperAdmin?: (req: Request, prisma: PrismaClient) => Promise<{ userId: string } | null>;
      getTenantId: (req: Request) => string | null;
      getUserId: (req: Request) => string | null;
      /**
       * Live count of concurrent connections for a tenant, keyed by tenant id
       * or slug. Generic number-in/number-out slot — the OSS host owns the
       * canonical presence source; the EE module must not reach into
       * `global.activeWorldRooms` itself. Added in loader version 3 so
       * `/billing/status` reports the same metric the seat-cap enforces.
       */
      getConcurrentUsage: (tenantIdOrSlug: string) => number;
      /**
       * Optional server-side analytics sink (host-callback contract). The OSS
       * host injects `@meetropolis/telemetry-node`'s `captureServerEvent` here so
       * billing can emit e.g. `purchase` from the Stripe webhook WITHOUT
       * importing the telemetry package — billing stays decoupled from Signalyr,
       * telemetry stays decoupled from Stripe, and the host is the single
       * orchestrator wiring the two optional modules together. Undefined (inert)
       * when telemetry is not loaded. Optional so this is a backward-compatible
       * config-shape addition — no billing loader version bump (the zod schema
       * validates the module's exports, not this config object).
       */
      captureServerEvent?: (event: { name: string; tenant?: string; properties?: Record<string, unknown> }) => void;
    },
  ): void;

  /**
   * Optional early-middleware hook. MUST be called by the OSS host BEFORE
   * `app.use(express.json(...))` so the Stripe webhook signature can be
   * verified against the unmodified raw request body. The EE module installs
   * `express.raw({ type: 'application/json' })` for `/billing/webhook` here.
   */
  installEarlyMiddleware?: (app: Express) => void;

  // Trial management
  getTrialStatus(
    prisma: PrismaClient,
    tenantId: string,
  ): Promise<{
    status: 'none' | 'active' | 'expired' | 'converted';
    startedAt: Date | null;
    endsAt: Date | null;
    daysRemaining: number | null;
    convertedAt: Date | null;
  }>;

  startTrial(prisma: PrismaClient, tenantId: string, trialDays?: number): Promise<void>;

  // Dunning
  getDunningStatus(
    prisma: PrismaClient,
    tenantId: string,
  ): Promise<{
    status: 'ok' | 'failing' | 'grace_period' | 'suspended';
    failedAt: Date | null;
    gracePeriodEndsAt: Date | null;
    dunningStep: number;
    lastEmailAt: Date | null;
    daysUntilCancellation: number | null;
  }>;

  // Constants
  TRIAL_DAYS: number;
  GRACE_PERIOD_DAYS: number;
  CANCELLATION_DAYS: number;
}

export const billingModuleSchema = z.object({
  version: z.literal(EXPECTED_BILLING_MODULE_VERSION),
  setupBillingRoutes: z.function(),
  installEarlyMiddleware: z.function().optional(),
  getTrialStatus: z.function().optional(),
  startTrial: z.function().optional(),
  getDunningStatus: z.function().optional(),
  TRIAL_DAYS: z.number().optional(),
  GRACE_PERIOD_DAYS: z.number().optional(),
  CANCELLATION_DAYS: z.number().optional(),
});

let cached: BillingModule | null = null;
let loadAttempted = false;

function unwrapDefaultExport(moduleValue: unknown): unknown {
  if (!moduleValue || typeof moduleValue !== 'object') return moduleValue;
  if (!('default' in moduleValue)) return moduleValue;
  const withDefault = moduleValue as { default?: unknown };
  return withDefault.default ?? moduleValue;
}

/**
 * Check if enterprise billing module is available
 */
export async function hasBillingModule(): Promise<boolean> {
  if (loadAttempted) return cached !== null;

  try {
    await getBillingModule();
    return cached !== null;
  } catch {
    return false;
  }
}

/**
 * Loads the optional enterprise billing module if present.
 * Returns null for OSS builds without enterprise features.
 */
export async function getBillingModule(): Promise<BillingModule | null> {
  if (loadAttempted) return cached;
  loadAttempted = true;

  try {
    // Dynamic import on runtime; absent in OSS
    const modUnknown: unknown = await import('@meetropolis/billing');
    const mod = billingModuleSchema.parse(unwrapDefaultExport(modUnknown));

    // Build the full module with defaults
    cached = {
      version: EXPECTED_BILLING_MODULE_VERSION,
      setupBillingRoutes: mod.setupBillingRoutes as BillingModule['setupBillingRoutes'],
      installEarlyMiddleware: mod.installEarlyMiddleware as BillingModule['installEarlyMiddleware'],
      getTrialStatus: mod.getTrialStatus as BillingModule['getTrialStatus'],
      startTrial: mod.startTrial as BillingModule['startTrial'],
      getDunningStatus: mod.getDunningStatus as BillingModule['getDunningStatus'],
      TRIAL_DAYS: (mod.TRIAL_DAYS as number) ?? 14,
      GRACE_PERIOD_DAYS: (mod.GRACE_PERIOD_DAYS as number) ?? 7,
      CANCELLATION_DAYS: (mod.CANCELLATION_DAYS as number) ?? 14,
    };

    logger.info({ event: 'billing.enterprise_loaded', version: EXPECTED_BILLING_MODULE_VERSION });
    return cached;
  } catch (_e) {
    // OSS build without enterprise billing - this is expected
    logger.debug({ event: 'billing.enterprise_not_available', message: 'Using OSS billing' });
    cached = null;
    return null;
  }
}

/**
 * Get billing module synchronously (returns null if not loaded yet)
 */
export function getBillingModuleSync(): BillingModule | null {
  return cached;
}
