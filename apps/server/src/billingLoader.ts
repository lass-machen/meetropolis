import type { Router, Request, Response, NextFunction } from 'express';
import type { PrismaClient } from './generated/prisma/index.js';
import type Stripe from 'stripe';
import { z } from 'zod';
import { logger } from './logger.js';

/**
 * Enterprise Billing Module interface
 * Provides advanced billing features: trials, dunning, pause/resume, audit logs
 */
export interface BillingModule {
  readonly version: 1;

  // Route setup
  setupBillingRoutes(
    router: Router,
    config: {
      prisma: PrismaClient;
      stripe: Stripe;
      webhookSecret: string;
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
      getTenantId: (req: Request) => string | null;
      getUserId: (req: Request) => string | null;
    },
  ): void;

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

const billingModuleSchema = z.object({
  version: z.literal(1),
  setupBillingRoutes: z.function(),
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
      version: 1,
      setupBillingRoutes: mod.setupBillingRoutes as BillingModule['setupBillingRoutes'],
      getTrialStatus: mod.getTrialStatus as BillingModule['getTrialStatus'],
      startTrial: mod.startTrial as BillingModule['startTrial'],
      getDunningStatus: mod.getDunningStatus as BillingModule['getDunningStatus'],
      TRIAL_DAYS: (mod.TRIAL_DAYS as number) ?? 14,
      GRACE_PERIOD_DAYS: (mod.GRACE_PERIOD_DAYS as number) ?? 7,
      CANCELLATION_DAYS: (mod.CANCELLATION_DAYS as number) ?? 14,
    };

    logger.info({ event: 'billing.enterprise_loaded', version: 1 });
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
