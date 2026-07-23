/**
 * Pricing helpers for the commercial signup step (PAYMENT_REWORK_DESIGN.md
 * E1.6/E1.7/E5.8). Pure functions only — the plan catalog is fetched from the
 * EE `GET /public/pricing-plans` endpoint (see usePricingPlans). None of this is
 * OSS-neutral concern: the commercial step that consumes it is gated behind the
 * `billingEnabled` capability flag from `GET /public/config`.
 */

import { vatBreakdown } from '../../../../lib/vat';

/** Card-backed trial length in days — mirrors the EE `TRIAL_DAYS` (E4.2). */
export const TRIAL_DAYS = 7;

/** A localisable field as delivered by the catalog: `{ en, de }` or a string. */
export type LocalizedField = string | Record<string, string> | null | undefined;

/** Projected catalog plan (Stripe ids are stripped server-side, E5.1/E5.8). */
export interface CatalogPlan {
  tierKey: string;
  name: LocalizedField;
  priceAmount: number | null;
  priceCurrency: string;
  priceInterval: string | null;
  concurrentLimit: number | null;
  minConnections: number | null;
  features: LocalizedField[];
  unitLabel?: LocalizedField;
  ctaLabel?: LocalizedField;
  ctaUrl?: string | null;
  priceLabel?: LocalizedField;
  badgeLabel?: LocalizedField;
  highlighted?: boolean;
  customPricing?: boolean;
  sortOrder?: number;
}

/** Resolve a localisable catalog field to the active language, with fallbacks. */
export function localize(field: LocalizedField, lang: string): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  const base = (lang.split('-')[0] || lang).toLowerCase();
  return field[base] ?? field.en ?? field.de ?? Object.values(field)[0] ?? '';
}

/** Format an integer minor-unit amount (net) as a localised currency string. */
export function formatMoney(minor: number, currency: string, lang: string): string {
  try {
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency || 'EUR'}`;
  }
}

/**
 * Net / tax / gross of a catalog price, formatted for display.
 *
 * `priceAmount` from the catalog is NET in minor units; the gross shown here is
 * derived with the German display rate (see lib/vat.ts) and is therefore an
 * ASSUMPTION, not a quote. Callers must pair it with the gross-assumption
 * footnote. At checkout Stripe computes the real tax — never reuse these
 * figures there.
 */
export interface DisplayPriceParts {
  /** Formatted net amount, e.g. "19,99 €". */
  net: string;
  /** Formatted gross amount under the display rate, e.g. "23,79 €". */
  gross: string;
  /** The display rate as a whole percentage, e.g. 19. */
  percent: number;
}

/** Format the net/gross pair for one net minor-unit amount. */
export function displayPriceParts(netMinor: number, currency: string, lang: string): DisplayPriceParts {
  const { net, gross, percent } = vatBreakdown(netMinor);
  return {
    net: formatMoney(net, currency, lang),
    gross: formatMoney(gross, currency, lang),
    percent,
  };
}

/**
 * Best-case "from … per participant" price (E1.6): the flat price divided by
 * the full cap. Marketing display only, never a billing quantity — the flat
 * price always applies (N2). Returns the per-participant amount in minor units,
 * or null when it cannot be derived (custom pricing / no cap).
 */
export function perParticipantFrom(priceAmount: number | null, cap: number | null): number | null {
  if (priceAmount == null || cap == null || cap <= 0) return null;
  return priceAmount / cap;
}

/** Concrete trial-end date from a start instant plus {@link TRIAL_DAYS}. */
export function trialEndDate(from: Date = new Date(), days: number = TRIAL_DAYS): Date {
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Format a date as a short localised calendar date (e.g. "16.07.2026"). */
export function formatDate(date: Date, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Narrow the raw `{ plans }` payload from `GET /public/pricing-plans`. */
export function normalizePlans(payload: unknown): CatalogPlan[] {
  const raw = (payload as { plans?: unknown })?.plans;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is CatalogPlan => !!p && typeof (p as CatalogPlan).tierKey === 'string')
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}
