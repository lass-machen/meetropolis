/**
 * Brand-Web Module Loader (Conditional Loading Pattern)
 *
 * Analog zu desktopLoader.ts und enterpriseWebLoader.ts.
 * Lädt @meetropolis/brand-web (privates Submodule unter packages/brand/) per
 * Dynamic Import. OSS-Builds ohne Submodule erhalten via optionalSubmodules-
 * Plugin ein leeres Modul, der Loader gibt dann null zurück; das OSS rendert
 * generische Fallback-Sections statt Marketing-Inhalte.
 *
 * Im Brand-Modul liegen ausschließlich Verkaufs- und Brand-spezifische Inhalte
 * (Hero, Pricing, Comparison, SocialProof, FinalCta, ProblemSolution, Legal,
 * Consent + Meta-Pixel, BrandLogo/Wordmark, Marketing-i18n).
 */

import type { ComponentType } from 'react';

export interface BrandModule {
  // Marketing landing sections
  HeroSection: ComponentType<{ onSignup: () => void; onLogin: () => void; registrationEnabled: boolean }>;
  ComparisonSection: ComponentType<Record<string, never>>;
  SocialProofSection: ComponentType<Record<string, never>>;
  FinalCtaSection: ComponentType<{ onSignup: () => void; registrationEnabled: boolean }>;
  ProblemSolutionSection: ComponentType<Record<string, never>>;
  PricingSection: ComponentType<{ onSignup: () => void; registrationEnabled?: boolean }>;

  // Legal
  TermsOfServicePage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;
  PrivacyPolicyPage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;
  ImpressumPage: ComponentType<{ onBack: () => void; registrationEnabled?: boolean }>;

  // Cookie consent + tracking
  PublicConsentGate: ComponentType<Record<string, never>>;
  clearMarketingConsent: () => void;

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
    const mod: any = await import('@meetropolis/brand-web');
    const resolved = mod.default ?? mod;
    if (!resolved || typeof resolved.HeroSection !== 'function') {
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
