/**
 * @meetropolis/brand-web — exports for the Meetropolis brand bundle.
 *
 * Loaded by the OSS web app via apps/web/src/lib/brandLoader.ts. When the
 * submodule is absent, Vite resolves the import to `export default null;`
 * via the optionalSubmodules plugin and the OSS renders a generic
 * Self-Hosted-style landing instead.
 */

// Marketing landing sections
export { HeroSection } from './landing/HeroSection';
export { ComparisonSection } from './landing/ComparisonSection';
export { SocialProofSection } from './landing/SocialProofSection';
export { FinalCtaSection } from './landing/FinalCtaSection';
export { ProblemSolutionSection } from './landing/ProblemSolutionSection';
export { PricingSection } from './landing/PricingSection';

// Legal
export { TermsOfServicePage } from './legal/TermsOfServicePage';
export { PrivacyPolicyPage } from './legal/PrivacyPolicyPage';
export { ImpressumPage } from './legal/ImpressumPage';

// Cookie consent + tracking
export { PublicConsentGate } from './consent/PublicConsentGate';
export { clearMarketingConsent } from './tracking/marketingConsent';

// Branding primitives
export { BrandLogo } from './branding/BrandLogo';
export { BrandWordmark } from './branding/BrandWordmark';

// Marketing locale bundles
export { default as marketingDe } from './locales/de/marketing.json';
export { default as marketingEn } from './locales/en/marketing.json';
