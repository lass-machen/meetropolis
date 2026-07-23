/**
 * Team-size ↔ plan matching for the commercial signup (step 2 team size → step 3
 * recommendation). Pure functions only.
 *
 * The team-size buckets are DERIVED from the live catalog caps rather than
 * hardcoded, so they always line up with the plans a tenant can actually buy —
 * even after an admin edits the caps. Each non-custom plan contributes one
 * bucket `[prevCap+1 .. thisCap]` on the concurrency scale (`concurrentLimit` is
 * peak simultaneous participants, not headcount); a custom/enterprise plan adds
 * an open-ended `[maxCap+1 .. ∞]` bucket that routes to sales.
 */
import type { CatalogPlan } from './pricing';

export interface TeamSizeOption {
  /**
   * Stable value stored as `regData.teamSize`. For a capped plan it is the
   * bucket's upper concurrency as a string (e.g. "15"); the open-ended bucket
   * uses "custom".
   */
  value: string;
  /** Lower bound of the bucket (1-based, inclusive). */
  from: number;
  /** Upper bound (inclusive), or null for the open-ended custom bucket. */
  to: number | null;
  /** The plan this bucket maps to. */
  tierKey: string;
}

/** Non-custom plans with a positive cap, ascending by cap. */
function cappedPlans(plans: CatalogPlan[]): CatalogPlan[] {
  return plans
    .filter((p) => !p.customPricing && typeof p.concurrentLimit === 'number' && p.concurrentLimit > 0)
    .sort((a, b) => (a.concurrentLimit as number) - (b.concurrentLimit as number));
}

/** Build the team-size buckets from the catalog caps (see file header). */
export function deriveTeamSizeOptions(plans: CatalogPlan[]): TeamSizeOption[] {
  const capped = cappedPlans(plans);
  const opts: TeamSizeOption[] = [];
  let prev = 0;
  for (const p of capped) {
    const cap = p.concurrentLimit as number;
    // Skip a duplicate cap (two plans with the same cap): the first wins the bucket.
    if (cap <= prev) continue;
    opts.push({ value: String(cap), from: prev + 1, to: cap, tierKey: p.tierKey });
    prev = cap;
  }
  const custom = plans.find((p) => p.customPricing);
  if (custom) opts.push({ value: 'custom', from: prev + 1, to: null, tierKey: custom.tierKey });
  return opts;
}

/**
 * The tier recommended for a stored team-size value, or null when the value
 * does not match a derived bucket (a legacy/unknown value, or no catalog). Null
 * means "no team-size signal" — the caller then shows no recommendation badge
 * and falls back to its own default (e.g. the highlighted plan).
 */
export function recommendedTier(plans: CatalogPlan[], teamSize: string | null | undefined): string | null {
  const match = deriveTeamSizeOptions(plans).find((o) => o.value === teamSize);
  return match ? match.tierKey : null;
}

/**
 * The tier to PRESELECT for checkout given a recommendation. Equal to the
 * recommendation when it is checkout-able (a real, non-custom plan); when the
 * recommendation is the custom/enterprise tier (a large team routed to sales),
 * falls back to the largest capped plan so the order CTA still has a concrete,
 * payable selection. Null when nothing is payable.
 */
export function checkoutDefaultTier(plans: CatalogPlan[], recommended: string | null): string | null {
  const rec = plans.find((p) => p.tierKey === recommended);
  if (rec && !rec.customPricing) return rec.tierKey;
  const capped = cappedPlans(plans);
  return capped.length ? capped[capped.length - 1].tierKey : null;
}
