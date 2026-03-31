import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubButton } from '../components/PubButton';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

interface PricingSectionProps {
  onSignup: () => void;
}

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pub-accent-teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const CheckIconWhite = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

interface FeatureItemProps {
  text: string;
  white?: boolean;
}

function FeatureItem({ text, white }: FeatureItemProps) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, fontFamily: 'var(--pub-font-body)', color: white ? '#FFFFFF' : 'var(--pub-text-on-dark-secondary)' }}>
      {white ? <CheckIconWhite /> : <CheckIcon />}
      <span>{text}</span>
    </li>
  );
}

export function PricingSection({ onSignup }: PricingSectionProps) {
  const { t } = useTranslation('public');
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-dark)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container" style={{ textAlign: 'center' }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <PubBadge variant="teal" dot>
            {t('pricing.badge')}
          </PubBadge>
        </div>
        <h2
          className="pub-text-h2"
          style={{ color: 'var(--pub-text-on-dark)', marginBottom: 16 }}
        >
          {t('pricing.title')}
        </h2>
        <p
          className="pub-text-subline"
          style={{ color: 'var(--pub-text-on-dark-secondary)', marginBottom: 56, maxWidth: 600, marginLeft: 'auto', marginRight: 'auto' }}
        >
          {t('pricing.subtitle')}
        </p>

        {/* Pricing Cards */}
        <div className="pricing-cards-row">
          {/* Starter Card */}
          <PubCard variant="dark" className="pricing-card pricing-card--side">
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 15, fontWeight: 500, color: 'var(--pub-text-on-dark-secondary)', marginBottom: 16 }}>
                {t('pricing.starterName')}
              </p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>€</span>
                <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 56, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
                  {t('pricing.starterPrice')}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: 'var(--pub-text-on-dark-secondary)', marginBottom: 32 }}>
                {t('pricing.starterUnit')}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FeatureItem text={t('pricing.starterFeature1')} />
                <FeatureItem text={t('pricing.starterFeature2')} />
                <FeatureItem text={t('pricing.starterFeature3')} />
                <FeatureItem text={t('pricing.starterFeature4')} />
              </ul>
              <PubButton variant="secondary" onClick={onSignup} style={{ width: '100%' }}>
                {t('pricing.starterCta')}
              </PubButton>
            </div>
          </PubCard>

          {/* Team Card (highlighted) */}
          <PubCard
            variant="purple"
            className="pricing-card pricing-card--featured"
            style={{
              boxShadow: '0 0 40px rgba(139,92,246,0.3)',
            }}
          >
            <div style={{ textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.8)', margin: 0 }}>
                  {t('pricing.teamName')}
                </p>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 16px',
                    borderRadius: 'var(--pub-radius-pill)',
                    fontFamily: 'var(--pub-font-body)',
                    fontSize: 13,
                    fontWeight: 500,
                    background: '#FFFFFF',
                    color: 'var(--pub-accent-purple)',
                  }}
                >
                  {t('pricing.teamBadge')}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>€</span>
                <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 56, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
                  {t('pricing.teamPrice')}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: 'rgba(255,255,255,0.7)', marginBottom: 32 }}>
                {t('pricing.teamUnit')}
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FeatureItem text={t('pricing.teamFeature1')} white />
                <FeatureItem text={t('pricing.teamFeature2')} white />
                <FeatureItem text={t('pricing.teamFeature3')} white />
                <FeatureItem text={t('pricing.teamFeature4')} white />
              </ul>
              <PubButton variant="cta-white" onClick={onSignup} style={{ width: '100%' }}>
                {t('pricing.teamCta')}
              </PubButton>
            </div>
          </PubCard>

          {/* Enterprise Card */}
          <PubCard variant="dark" className="pricing-card pricing-card--side">
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 15, fontWeight: 500, color: 'var(--pub-text-on-dark-secondary)', marginBottom: 16 }}>
                {t('pricing.enterpriseName')}
              </p>
              <div style={{ marginBottom: 4 }}>
                <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 40, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
                  {t('pricing.enterprisePrice')}
                </span>
              </div>
              <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: 'var(--pub-text-on-dark-secondary)', marginBottom: 32, visibility: 'hidden' }}>
                &nbsp;
              </p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <FeatureItem text={t('pricing.enterpriseFeature1')} />
                <FeatureItem text={t('pricing.enterpriseFeature2')} />
                <FeatureItem text={t('pricing.enterpriseFeature3')} />
                <FeatureItem text={t('pricing.enterpriseFeature4')} />
              </ul>
              <PubButton variant="secondary" onClick={onSignup} style={{ width: '100%' }}>
                {t('pricing.enterpriseCta')}
              </PubButton>
            </div>
          </PubCard>
        </div>
      </div>
    </section>
  );
}
