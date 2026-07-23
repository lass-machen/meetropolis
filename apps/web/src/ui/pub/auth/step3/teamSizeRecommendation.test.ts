import { describe, it, expect } from 'vitest';
import {
  deriveTeamSizeOptions,
  recommendedTier,
  checkoutDefaultTier,
  type TeamSizeOption,
} from './teamSizeRecommendation';
import type { CatalogPlan } from './pricing';

/** Mirrors the seeded catalog: Startup 5, Team 15, Business 35, Enterprise custom. */
const PLANS = [
  { tierKey: 'startup', concurrentLimit: 5, customPricing: false },
  { tierKey: 'team', concurrentLimit: 15, customPricing: false },
  { tierKey: 'business', concurrentLimit: 35, customPricing: false },
  { tierKey: 'enterprise', concurrentLimit: null, customPricing: true },
] as unknown as CatalogPlan[];

describe('deriveTeamSizeOptions', () => {
  it('builds one bucket per capped plan plus an open-ended custom bucket', () => {
    const opts = deriveTeamSizeOptions(PLANS);
    expect(opts.map((o) => [o.from, o.to, o.value, o.tierKey])).toEqual([
      [1, 5, '5', 'startup'],
      [6, 15, '15', 'team'],
      [16, 35, '35', 'business'],
      [36, null, 'custom', 'enterprise'],
    ]);
  });

  it('sorts unsorted caps and skips duplicate caps', () => {
    const messy = [
      { tierKey: 'b', concurrentLimit: 35, customPricing: false },
      { tierKey: 'a', concurrentLimit: 5, customPricing: false },
      { tierKey: 'dup', concurrentLimit: 5, customPricing: false },
    ] as unknown as CatalogPlan[];
    const opts = deriveTeamSizeOptions(messy);
    expect(opts.map((o) => o.value)).toEqual(['5', '35']);
    expect(opts[0].tierKey).toBe('a'); // first 5-cap plan wins the bucket
  });

  it('omits the custom bucket when there is no custom plan', () => {
    const noCustom = PLANS.filter((p) => !p.customPricing);
    const opts = deriveTeamSizeOptions(noCustom);
    expect(opts.some((o: TeamSizeOption) => o.value === 'custom')).toBe(false);
  });
});

describe('recommendedTier', () => {
  it('maps each derived bucket value to its plan', () => {
    expect(recommendedTier(PLANS, '5')).toBe('startup');
    expect(recommendedTier(PLANS, '15')).toBe('team');
    expect(recommendedTier(PLANS, '35')).toBe('business');
    expect(recommendedTier(PLANS, 'custom')).toBe('enterprise');
  });

  it('returns null for a legacy/unknown value (no team-size signal)', () => {
    expect(recommendedTier(PLANS, '1-10')).toBeNull();
    expect(recommendedTier(PLANS, undefined)).toBeNull();
  });

  it('returns null when no plan is usable', () => {
    expect(recommendedTier([], '15')).toBeNull();
  });
});

describe('checkoutDefaultTier', () => {
  it('keeps a non-custom recommendation', () => {
    expect(checkoutDefaultTier(PLANS, 'team')).toBe('team');
  });

  it('falls back to the largest capped plan when the recommendation is custom', () => {
    expect(checkoutDefaultTier(PLANS, 'enterprise')).toBe('business');
  });

  it('returns null when nothing is payable', () => {
    const onlyCustom = PLANS.filter((p) => p.customPricing);
    expect(checkoutDefaultTier(onlyCustom, 'enterprise')).toBeNull();
  });
});
