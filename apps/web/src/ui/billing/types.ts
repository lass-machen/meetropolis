/**
 * Read-only PaymentStatus shape, shared between OSS and enterprise web.
 *
 * Full billing/checkout types (AvailablePlan, BillingStatus, Invoice) live in
 * the enterprise web submodule because they are only consumed by the
 * BillingDashboard, which is enterprise-only.
 *
 * The marketing-facing PublicPricingPlan + I18nText shapes are kept here
 * because the OSS PricingSection still consumes them. Phase 3 moves the
 * marketing landing into the brand submodule, at which point these types
 * can move there as well.
 */
export interface PaymentStatus {
  status: 'ok' | 'failing' | 'grace_period' | 'suspended';
  failedAt: string | null;
  gracePeriodEndsAt: string | null;
  dunningStep: number;
  daysUntilCancellation: number | null;
}

export interface I18nText {
  en: string;
  de: string;
  [key: string]: string;
}

export interface PublicPricingPlan {
  id: string;
  name: I18nText;
  description?: I18nText | null;
  priceAmount?: number | null;
  priceCurrency: string;
  priceInterval?: 'month' | 'year' | null;
  priceLabel?: I18nText | null;
  unitLabel?: I18nText | null;
  features: I18nText[];
  ctaLabel: I18nText;
  ctaUrl?: string | null;
  highlighted: boolean;
  badgeLabel?: I18nText | null;
  customPricing: boolean;
  sortOrder: number;
}
