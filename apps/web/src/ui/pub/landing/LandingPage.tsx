import * as React from 'react';
import { PublicLayout } from '../layout/PublicLayout';
import { TrustBarSection } from './TrustBarSection';
import { FeatureShowcaseSection } from './FeatureShowcaseSection';
import { SecondaryFeaturesSection } from './SecondaryFeaturesSection';
import { HowItWorksSection } from './HowItWorksSection';
import { FaqSection } from './FaqSection';
import { OpenSourceSection } from './OpenSourceSection';
import { OssHeroSection } from './OssHeroSection';
import { OssFinalCtaSection } from './OssFinalCtaSection';
import { getBrandModule } from '../../../lib/brandLoader';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: (tierKey?: string) => void;
  onPricing: () => void;
  registrationEnabled: boolean;
}

type HeroProps = { onSignup: () => void; onLogin: () => void; registrationEnabled: boolean };
type EmptyProps = Record<string, never>;
type PricingProps = { onSignup: (tierKey?: string) => void; registrationEnabled?: boolean };
type FinalCtaProps = { onSignup: () => void; registrationEnabled: boolean };

const HeroLazy = React.lazy<React.ComponentType<HeroProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: OssHeroSection };
  return { default: mod.HeroSection };
});

const ProblemSolutionLazy = React.lazy<React.ComponentType<EmptyProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: () => null };
  return { default: mod.ProblemSolutionSection };
});

const ComparisonLazy = React.lazy<React.ComponentType<EmptyProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: () => null };
  return { default: mod.ComparisonSection };
});

const SocialProofLazy = React.lazy<React.ComponentType<EmptyProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: () => null };
  return { default: mod.SocialProofSection };
});

const PricingLazy = React.lazy<React.ComponentType<PricingProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: () => null };
  return { default: mod.PricingSection };
});

const FinalCtaLazy = React.lazy<React.ComponentType<FinalCtaProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: OssFinalCtaSection };
  return { default: mod.FinalCtaSection };
});

export function LandingPage({ onLogin, onSignup, onPricing: _onPricing, registrationEnabled }: LandingPageProps) {
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  // Typed as tier-aware so the pricing cards can forward their `tierKey`.
  // `onLogin` (used when registration is disabled) simply ignores the arg.
  const effectiveSignup: (tierKey?: string) => void = registrationEnabled ? onSignup : onLogin;

  return (
    <PublicLayout
      onLogin={onLogin}
      onSignup={effectiveSignup}
      navigate={navigate}
      registrationEnabled={registrationEnabled}
    >
      <React.Suspense fallback={null}>
        <HeroLazy onSignup={effectiveSignup} onLogin={onLogin} registrationEnabled={registrationEnabled} />
      </React.Suspense>

      <TrustBarSection />

      <React.Suspense fallback={null}>
        <ProblemSolutionLazy />
      </React.Suspense>

      <HowItWorksSection />
      <FeatureShowcaseSection />
      <SecondaryFeaturesSection />

      <React.Suspense fallback={null}>
        <ComparisonLazy />
      </React.Suspense>

      <React.Suspense fallback={null}>
        <SocialProofLazy />
      </React.Suspense>

      <OpenSourceSection />

      <React.Suspense fallback={null}>
        <PricingLazy onSignup={effectiveSignup} registrationEnabled={registrationEnabled} />
      </React.Suspense>

      <FaqSection />

      <React.Suspense fallback={null}>
        <FinalCtaLazy onSignup={effectiveSignup} registrationEnabled={registrationEnabled} />
      </React.Suspense>
    </PublicLayout>
  );
}
