import { PublicLayout } from '../layout/PublicLayout';
import { HeroSection } from './HeroSection';
import { ProblemSolutionSection } from './ProblemSolutionSection';
import { FeatureShowcaseSection } from './FeatureShowcaseSection';
import { SecondaryFeaturesSection } from './SecondaryFeaturesSection';
import { PricingSection } from './PricingSection';
import { SocialProofSection } from './SocialProofSection';
import { OpenSourceSection } from './OpenSourceSection';
import { FinalCtaSection } from './FinalCtaSection';

interface LandingPageProps {
  onLogin: () => void;
  onSignup: () => void;
  onPricing: () => void;
  registrationEnabled: boolean;
}

export function LandingPage({ onLogin, onSignup, onPricing: _onPricing, registrationEnabled: _registrationEnabled }: LandingPageProps) {
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout onLogin={onLogin} onSignup={onSignup} navigate={navigate}>
      <HeroSection onSignup={onSignup} onLogin={onLogin} />
      <ProblemSolutionSection />
      <FeatureShowcaseSection />
      <SecondaryFeaturesSection />
      <PricingSection onSignup={onSignup} />
      <SocialProofSection />
      <OpenSourceSection />
      <FinalCtaSection onSignup={onSignup} />
    </PublicLayout>
  );
}
