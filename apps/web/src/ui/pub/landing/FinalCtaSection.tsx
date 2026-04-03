import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';
import { useReveal } from '../hooks/useReveal';

interface FinalCtaSectionProps {
  onSignup: () => void;
  registrationEnabled?: boolean;
}

const ArrowRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const CircleCheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--pub-accent-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

interface TrustItemProps {
  text: string;
}

function TrustItem({ text }: TrustItemProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <CircleCheckIcon />
      <span
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          fontWeight: 400,
          color: '#FFFFFF',
        }}
      >
        {text}
      </span>
    </div>
  );
}

export function FinalCtaSection({ onSignup, registrationEnabled = true }: FinalCtaSectionProps) {
  const { t } = useTranslation('public');
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="final-cta"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-gradient-cta)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div
        className="pub-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--pub-font-display)',
            fontSize: 52,
            fontWeight: 800,
            lineHeight: 1.1,
            color: '#FFFFFF',
            maxWidth: 800,
            marginBottom: 20,
          }}
        >
          {t('cta.title')}
        </h2>

        <p
          className="pub-text-subline"
          style={{
            color: 'rgba(255,255,255,0.7)',
            maxWidth: 600,
            marginBottom: 40,
          }}
        >
          {t('cta.subtitle')}
        </p>

        {/* CTA Row */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: 32,
          }}
        >
          {registrationEnabled && (
            <PubButton
              variant="primary"
              size="lg"
              rightIcon={<ArrowRightIcon />}
              onClick={onSignup}
            >
              {t('cta.ctaPrimary')}
            </PubButton>
          )}
          <PubButton variant="secondary" size="lg">
            {t('cta.ctaSecondary')}
          </PubButton>
        </div>

        {/* Trust Checkmarks */}
        <div className="final-cta-trust-row">
          <TrustItem text={t('cta.check1')} />
          <TrustItem text={t('cta.check2')} />
          <TrustItem text={t('cta.check3')} />
        </div>
      </div>
    </section>
  );
}
