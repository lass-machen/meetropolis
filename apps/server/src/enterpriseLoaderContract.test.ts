import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EXPECTED_ADMIN_MODULE_VERSION, adminEnterpriseSchema } from './adminLoader.js';
import type { AdminEnterpriseModule } from './adminLoader.js';
import { EXPECTED_BILLING_MODULE_VERSION, billingModuleSchema } from './billingLoader.js';
import type { BillingModule } from './billingLoader.js';

// ---------------------------------------------------------------------------
// Enterprise loader version contract
//
// The admin routes and the billing routes are shipped by the SAME closed-source
// `@meetropolis/billing` package, which exposes a single `version` const. Both
// loaders parse that same const, so their expected version literals MUST stay
// identical. A package bump that updates only one loader makes the other
// loader's `.parse()` throw and silently drops its routes on a full enterprise
// deployment. That is exactly what happened when the package moved to version 2
// while `adminLoader` still expected `z.literal(1)`, so this file pins the
// contract with a regression test.
//
// Version 3 (payment rework) added the generic `getConcurrentUsage` config slot
// to `setupBillingRoutes` and fixed the K1 contract drift where the EE
// `getTrialStatus` return shape was missing the `status` field the OSS trial
// gate reads. Those two additions are guarded below.
// ---------------------------------------------------------------------------

const noop = (): void => undefined;

/**
 * A well-formed `@meetropolis/billing` export shape at a given version. Because
 * both route families live in one package, a single object satisfies both the
 * admin and the billing schema.
 */
function enterpriseModuleFixture(version: number): Record<string, unknown> {
  return {
    version,
    // Billing surface
    setupBillingRoutes: noop,
    installEarlyMiddleware: noop,
    getTrialStatus: noop,
    startTrial: noop,
    getDunningStatus: noop,
    TRIAL_DAYS: 7,
    GRACE_PERIOD_DAYS: 7,
    CANCELLATION_DAYS: 14,
    // Admin surface
    setupAdminRoutes: noop,
    setupTenantAdminRoutes: noop,
    setupPricingPlanRoutes: noop,
    setupTenantUserRoutes: noop,
    setupPackMarketplaceRoutes: noop,
    setupDesktopUpdateRoutes: noop,
  };
}

describe('enterprise loader version contract', () => {
  it('admin and billing loaders expect the same package version', () => {
    // Guards the regression where a `@meetropolis/billing` bump updates only one
    // loader. Both read the same `version` const, so both must match.
    expect(EXPECTED_ADMIN_MODULE_VERSION).toBe(EXPECTED_BILLING_MODULE_VERSION);
  });

  it('both loaders pin the current payment-rework version 3', () => {
    // A version mismatch would make the loader silently fall back to OSS and drop
    // every admin/billing route, so the expected version is asserted explicitly.
    expect(EXPECTED_BILLING_MODULE_VERSION).toBe(3);
    expect(EXPECTED_ADMIN_MODULE_VERSION).toBe(3);
  });

  it('admin loader accepts a module reporting the expected version', () => {
    const result = adminEnterpriseSchema.safeParse(enterpriseModuleFixture(EXPECTED_ADMIN_MODULE_VERSION));
    expect(result.success).toBe(true);
  });

  it('admin loader rejects a module reporting the previous version 2', () => {
    const result = adminEnterpriseSchema.safeParse(enterpriseModuleFixture(2));
    expect(result.success).toBe(false);
  });

  it('billing loader accepts the same fixture at the expected version', () => {
    const result = billingModuleSchema.safeParse(enterpriseModuleFixture(EXPECTED_BILLING_MODULE_VERSION));
    expect(result.success).toBe(true);
  });

  it('billing loader rejects a module reporting the previous version 2', () => {
    const result = billingModuleSchema.safeParse(enterpriseModuleFixture(2));
    expect(result.success).toBe(false);
  });

  it('the version reported by the shared package is accepted by both loaders', () => {
    // Cross-check: whatever version the single package reports, both schemas
    // must accept it in lockstep.
    const fixture = enterpriseModuleFixture(EXPECTED_BILLING_MODULE_VERSION);
    expect(adminEnterpriseSchema.safeParse(fixture).success).toBe(true);
    expect(billingModuleSchema.safeParse(fixture).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// K1 — getTrialStatus return-shape contract
//
// The OSS trial gate (onJoin.limiter.ts) blocks on `trialStatus.status ===
// 'expired'`. The declared loader return type (billingLoader.ts) therefore MUST
// carry a `status` field with a value from the fixed enum. The runtime module
// schema only checks that `getTrialStatus` is a function (`z.function()` does
// not validate call results), so the return shape is pinned here separately:
// a zod schema mirroring the declared contract plus a compile-time assertion
// that the declared type still exposes `status`. This is the regression guard
// for the K1 drift where the EE implementation returned no `status` field and
// the trial-expiry gate never fired.
// ---------------------------------------------------------------------------

const TRIAL_STATUS_VALUES = ['none', 'active', 'expired', 'converted'] as const;

/** Mirrors the `getTrialStatus` return contract declared in `billingLoader.ts`. */
const trialStatusReturnSchema = z.object({
  status: z.enum(TRIAL_STATUS_VALUES),
  startedAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  daysRemaining: z.number().nullable(),
  convertedAt: z.date().nullable(),
});

// Compile-time guard: the declared loader return type must expose a `status`
// field of the exact enum union. If the interface loses `status` (the K1
// regression) or widens the enum, this assignment stops type-checking.
type TrialStatusReturn = Awaited<ReturnType<BillingModule['getTrialStatus']>>;
type _AssertStatusField = TrialStatusReturn['status'] extends 'none' | 'active' | 'expired' | 'converted'
  ? true
  : never;
const _statusFieldPresent: _AssertStatusField = true;
void _statusFieldPresent;

describe('billing loader getTrialStatus return-shape contract', () => {
  it('accepts a return object carrying a valid status enum value', () => {
    for (const status of TRIAL_STATUS_VALUES) {
      const sample = {
        status,
        startedAt: status === 'none' ? null : new Date(),
        endsAt: status === 'none' ? null : new Date(),
        daysRemaining: status === 'active' ? 5 : null,
        convertedAt: status === 'converted' ? new Date() : null,
      };
      expect(trialStatusReturnSchema.safeParse(sample).success).toBe(true);
    }
  });

  it('rejects the legacy EE return shape without a status field (K1 regression)', () => {
    // This is exactly the object the EE `getTrialStatus` returned before the K1
    // fix: `active`/`expired` booleans but no derived `status` field. The OSS
    // gate read `trialStatus.status`, always got `undefined`, and never fired.
    const legacyShape = {
      active: false,
      startedAt: null,
      endsAt: null,
      daysRemaining: null,
      convertedAt: null,
      expired: true,
    };
    expect(trialStatusReturnSchema.safeParse(legacyShape).success).toBe(false);
  });

  it('rejects a status value outside the declared enum', () => {
    const sample = {
      status: 'pending',
      startedAt: null,
      endsAt: null,
      daysRemaining: null,
      convertedAt: null,
    };
    expect(trialStatusReturnSchema.safeParse(sample).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// H1 / E7.1 — getConcurrentUsage config slot
//
// Loader v3 injects a generic `getConcurrentUsage(tenantIdOrSlug): number` into
// the `setupBillingRoutes` config so `/billing/status` reports the same live
// metric the seat cap enforces. The slot lives on the config parameter type
// (not the runtime module schema), so it is pinned with a compile-time
// assertion: if the slot is dropped or its shape changes, this file stops
// type-checking.
// ---------------------------------------------------------------------------

type BillingRoutesConfig = Parameters<BillingModule['setupBillingRoutes']>[1];
type AdminTenantConfig = Parameters<AdminEnterpriseModule['setupTenantAdminRoutes']>[1];

// The billing config must expose the v3 usage slot with the generic
// number-in/number-out signature (no Stripe types cross the boundary).
const _getConcurrentUsageSlot: BillingRoutesConfig['getConcurrentUsage'] = (_tenantIdOrSlug: string): number => 0;
void _getConcurrentUsageSlot;

// The admin tenant-admin config keeps its own slug-keyed usage helper; asserting
// it stays present documents the parallel injection point (adminLoader.ts).
const _computeOnlineUsageSlot: AdminTenantConfig['computeOnlineUsageByTenantSlug'] = (): Record<string, number> => ({});
void _computeOnlineUsageSlot;

describe('billing loader getConcurrentUsage config slot (v3)', () => {
  it('exposes a generic number-returning usage slot on the billing config', () => {
    // Runtime smoke check on the shape asserted at compile time above.
    expect(typeof _getConcurrentUsageSlot('tenant-slug')).toBe('number');
    expect(_getConcurrentUsageSlot('tenant-slug')).toBe(0);
  });
});
