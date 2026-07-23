/**
 * Brand-web module loader (conditional loading pattern).
 *
 * Mirrors desktopLoader.ts and enterpriseWebLoader.ts. Loads
 * @meetropolis/brand-web (a private submodule under packages/brand/) via
 * dynamic import. OSS builds without the submodule receive an empty module
 * through the optionalSubmodules plugin, so the loader returns null and the
 * OSS app renders generic fallback sections instead of marketing content.
 *
 * The brand module contains only sales and brand-specific content (hero,
 * pricing, comparison, social proof, final CTA, problem/solution, legal,
 * BrandLogo/Wordmark, marketing i18n).
 */

import * as React from 'react';
import type { ComponentType } from 'react';

export interface BrandModule {
  // Marketing landing sections
  HeroSection: ComponentType<{ onSignup: () => void; onLogin: () => void; registrationEnabled: boolean }>;
  ComparisonSection: ComponentType<Record<string, never>>;
  SocialProofSection: ComponentType<Record<string, never>>;
  FinalCtaSection: ComponentType<{ onSignup: () => void; registrationEnabled: boolean }>;
  ProblemSolutionSection: ComponentType<Record<string, never>>;
  PricingSection: ComponentType<{ onSignup: (tierKey?: string) => void; registrationEnabled?: boolean }>;

  // Legal
  TermsOfServicePage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;
  PrivacyPolicyPage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;
  ImpressumPage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;

  // Branding primitives
  BrandLogo: ComponentType<{ size?: number; className?: string; alt?: string; src?: string }>;
  BrandWordmark: ComponentType<{ height?: number; src?: string; renderFallback?: () => React.ReactNode }>;

  // Marketing translations (loaded into i18next on init)
  marketingDe: Record<string, unknown>;
  marketingEn: Record<string, unknown>;
}

let cached: BrandModule | null | undefined = undefined;

export async function getBrandModule(): Promise<BrandModule | null> {
  if (cached !== undefined) return cached;

  try {
    // @meetropolis/brand-web is an optional private submodule. In OSS
    // builds it is absent and the Vite plugin returns an empty module.
    const mod = (await import('@meetropolis/brand-web')) as unknown as {
      default?: unknown;
      HeroSection?: unknown;
    };
    const resolved: unknown = mod.default ?? mod;
    if (
      !resolved ||
      typeof resolved !== 'object' ||
      typeof (resolved as { HeroSection?: unknown }).HeroSection !== 'function'
    ) {
      cached = null;
      return null;
    }
    cached = resolved as BrandModule;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

/**
 * React hook companion to `getBrandModule`. Returns `{ loading, hasBrand }`
 * so route-level code can decide whether to render landing/legal/marketing
 * pages (Brand build) or redirect them to /login (OSS build).
 */
export function useHasBrandModule(): { loading: boolean; hasBrand: boolean } {
  const [state, setState] = React.useState<{ loading: boolean; hasBrand: boolean }>(() => {
    if (cached === undefined) return { loading: true, hasBrand: false };
    return { loading: false, hasBrand: cached !== null };
  });

  React.useEffect(() => {
    if (cached !== undefined) {
      setState({ loading: false, hasBrand: cached !== null });
      return;
    }
    let cancelled = false;
    void getBrandModule().then((mod) => {
      if (!cancelled) setState({ loading: false, hasBrand: mod !== null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
