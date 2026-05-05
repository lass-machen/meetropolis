import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '@app/ui/pub/components/PubBadge';
import { PubButton } from '@app/ui/pub/components/PubButton';
import { useReveal } from '@app/ui/pub/hooks/useReveal';

interface HeroSectionProps {
  onSignup: () => void;
  onLogin: () => void;
  registrationEnabled?: boolean;
}

const ArrowRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

function HeroBadge() {
  const { t } = useTranslation('public');
  return (
    <div style={{ marginBottom: 32 }}>
      <PubBadge variant="dark" dot>
        {t('hero.badge')}
      </PubBadge>
    </div>
  );
}

function HeroHeadline() {
  const { t } = useTranslation('public');
  return (
    <>
      <h1
        className="pub-text-hero"
        style={{
          color: '#FFFFFF',
          maxWidth: 900,
          margin: '0 auto 24px',
        }}
      >
        {t('hero.titleLine1')}
        <br />
        {t('hero.titleLine2')}
      </h1>
      <p
        className="pub-text-subline"
        style={{
          color: 'rgba(255,255,255,0.73)',
          maxWidth: 700,
          margin: '0 auto 40px',
        }}
      >
        {t('hero.subtitle')}
      </p>
    </>
  );
}

interface HeroCtaProps {
  onSignup: () => void;
  onLogin: () => void;
  registrationEnabled: boolean;
}

function HeroCta({ onSignup, onLogin, registrationEnabled }: HeroCtaProps) {
  const { t } = useTranslation('public');
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        justifyContent: 'center',
        flexWrap: 'wrap',
        marginBottom: 16,
      }}
    >
      {registrationEnabled ? (
        <PubButton
          variant="primary"
          size="lg"
          rightIcon={<ArrowRightIcon />}
          onClick={onSignup}
        >
          {t('hero.ctaPrimary')}
        </PubButton>
      ) : (
        <PubButton variant="primary" size="lg" onClick={onLogin}>
          {t('hero.ctaLoginInstead')}
        </PubButton>
      )}
    </div>
  );
}

function HeroTrustText({ registrationEnabled }: { registrationEnabled: boolean }) {
  const { t } = useTranslation('public');
  if (!registrationEnabled) return <div style={{ marginBottom: 56 }} />;
  return (
    <div style={{ marginBottom: 56, textAlign: 'center' }}>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          color: 'rgba(255,255,255,0.5)',
          marginBottom: 8,
        }}
      >
        {t('hero.trustNoCreditCard')} &middot; {t('hero.trustQuickSetup')} &middot; {t('hero.trustGdpr')}
      </p>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 13,
          fontStyle: 'italic',
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        {t('hero.urgency')}
      </p>
    </div>
  );
}

function HeroVisual() {
  return (
    <div
      style={{
        maxWidth: 1100,
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 0 80px rgba(139,92,246,0.25), 0 24px 64px rgba(0,0,0,0.4)',
        marginBottom: 56,
      }}
    >
      <img
        src="/images/pub/meetropolis-screen-hero.webp"
        alt="Meetropolis product screenshot"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );
}

export function HeroSection({ onSignup, onLogin, registrationEnabled = true }: HeroSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="hero"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-gradient-hero)',
        padding: 'var(--pub-section-padding)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        overflow: 'hidden',
      }}
    >
      <HeroBadge />
      <HeroHeadline />
      <HeroCta onSignup={onSignup} onLogin={onLogin} registrationEnabled={registrationEnabled} />
      <HeroTrustText registrationEnabled={registrationEnabled} />
      <HeroVisual />
    </section>
  );
}
