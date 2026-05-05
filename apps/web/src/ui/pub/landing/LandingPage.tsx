import { PublicLayout } from '../layout/PublicLayout';
import { HeroSection } from './HeroSection';
import { ProblemSolutionSection } from './ProblemSolutionSection';
import { FeatureShowcaseSection } from './FeatureShowcaseSection';
import { SecondaryFeaturesSection } from './SecondaryFeaturesSection';
import { HowItWorksSection } from './HowItWorksSection';
import { SocialProofSection } from './SocialProofSection';
import { ComparisonSection } from './ComparisonSection';
import { PricingSection } from './PricingSection';
import { FaqSection } from './FaqSection';
import { OpenSourceSection } from './OpenSourceSection';
import { FinalCtaSection } from './FinalCtaSection';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onPricing: () => void;
  registrationEnabled: boolean;
}

export function LandingPage({ onLogin, onSignup, onPricing: _onPricing, registrationEnabled }: LandingPageProps) {
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  // When registration is disabled, CTA buttons redirect to login instead
  const effectiveSignup = registrationEnabled ? onSignup : onLogin;

  return (
    <PublicLayout onLogin={onLogin} onSignup={effectiveSignup} navigate={navigate} registrationEnabled={registrationEnabled}>
      <HeroSection onSignup={effectiveSignup} onLogin={onLogin} registrationEnabled={registrationEnabled} />
      <ProblemSolutionSection />
      <FeatureShowcaseSection />
      <SecondaryFeaturesSection />
      <HowItWorksSection />
      <SocialProofSection />
      <ComparisonSection />
      <PricingSection onSignup={effectiveSignup} registrationEnabled={registrationEnabled} />
      <FaqSection />
      <OpenSourceSection />
      <FinalCtaSection onSignup={effectiveSignup} registrationEnabled={registrationEnabled} />
    </PublicLayout>
  );
}
