import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubButton } from '../components/PubButton';
import { useReveal } from '../hooks/useReveal';

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

const TRUST_LOGOS = ['TechStartup', 'RemoteFirst', 'DigitalHQ', 'CloudTeam', 'Founders'];

export function HeroSection({ onSignup, onLogin, registrationEnabled = true }: HeroSectionProps) {
  const { t } = useTranslation('public');
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
      {/* Badge */}
      <div style={{ marginBottom: 32 }}>
        <PubBadge variant="dark" dot>
          {t('hero.badge')}
        </PubBadge>
      </div>

      {/* Headline */}
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

      {/* Subline */}
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

      {/* CTA Row */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          justifyContent: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        {registrationEnabled && (
          <PubButton
            variant="primary"
            size="lg"
            rightIcon={<ArrowRightIcon />}
            onClick={onSignup}
          >
            {t('hero.ctaPrimary')}
          </PubButton>
        )}
        <PubButton variant="secondary" size="lg" onClick={onLogin}>
          {t('hero.ctaSecondary')}
        </PubButton>
      </div>

      {/* Trust Text */}
      {registrationEnabled && (
        <p
          style={{
            fontFamily: 'var(--pub-font-body)',
            fontSize: 14,
            color: 'rgba(255,255,255,0.5)',
            marginBottom: 56,
          }}
        >
          {t('hero.trustNoCreditCard')} &middot; {t('hero.trustQuickSetup')}
        </p>
      )}
      {!registrationEnabled && <div style={{ marginBottom: 56 }} />}

      {/* Product Visual */}
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

      {/* Trust Logos */}
      <div
        style={{
          display: 'flex',
          gap: 48,
          justifyContent: 'center',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {TRUST_LOGOS.map((name) => (
          <span
            key={name}
            style={{
              fontFamily: 'var(--pub-font-display)',
              fontWeight: 700,
              fontSize: 20,
              color: 'rgba(255,255,255,0.15)',
              userSelect: 'none',
            }}
          >
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}
