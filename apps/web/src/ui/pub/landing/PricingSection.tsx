import { useRef, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubButton } from '../components/PubButton';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import type { PublicPricingPlan, I18nText } from '../../billing/types';

function t18n(obj: I18nText | null | undefined, locale: string): string {
  if (!obj) return '';
  return obj[locale] || obj.en || '';
}

interface PricingSectionProps {
  onSignup: () => void;
  registrationEnabled?: boolean;
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

function PriceDisplay({ plan, locale }: { plan: PublicPricingPlan; locale: string }) {
  if (plan.customPricing) {
    return (
      <div style={{ marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 40, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
          {t18n(plan.priceLabel, locale)}
        </span>
      </div>
    );
  }

  const amount = plan.priceAmount != null ? Math.round(plan.priceAmount / 100) : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
      <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 24, fontWeight: 800, color: '#FFFFFF' }}>&euro;</span>
      <span style={{ fontFamily: 'var(--pub-font-display)', fontSize: 56, fontWeight: 800, color: '#FFFFFF', lineHeight: 1 }}>
        {amount}
      </span>
    </div>
  );
}

function PlanCard({ plan, locale, onSignup, registrationEnabled }: {
  plan: PublicPricingPlan;
  locale: string;
  onSignup: () => void;
  registrationEnabled: boolean;
}) {
  const isHighlighted = plan.highlighted;
  const variant = isHighlighted ? 'purple' : 'dark';
  const className = isHighlighted ? 'pricing-card pricing-card--featured' : 'pricing-card pricing-card--side';
  const textColor = isHighlighted ? 'rgba(255,255,255,0.8)' : 'var(--pub-text-on-dark-secondary)';
  const unitColor = isHighlighted ? 'rgba(255,255,255,0.7)' : 'var(--pub-text-on-dark-secondary)';

  const handleCtaClick = () => {
    if (plan.ctaUrl && (plan.ctaUrl.startsWith('http') || plan.ctaUrl.startsWith('mailto:'))) {
      window.open(plan.ctaUrl, '_blank');
    } else {
      onSignup();
    }
  };

  const showCta = registrationEnabled || !!plan.ctaUrl;

  return (
    <PubCard
      variant={variant}
      className={className}
      style={isHighlighted ? { boxShadow: '0 0 40px rgba(139,92,246,0.3)' } : {}}
    >
      <div style={{ textAlign: 'left' }}>
        {/* Plan name + badge row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 15, fontWeight: 500, color: textColor, margin: 0 }}>
            {t18n(plan.name, locale)}
          </p>
          {isHighlighted && plan.badgeLabel && (
            <span style={{
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
            }}>
              {t18n(plan.badgeLabel, locale)}
            </span>
          )}
        </div>

        <PriceDisplay plan={plan} locale={locale} />

        {/* Unit label — hide for custom pricing */}
        {!plan.customPricing ? (
          <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: unitColor, marginBottom: 32 }}>
            {t18n(plan.unitLabel, locale)}
          </p>
        ) : (
          <p style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: unitColor, marginBottom: 32, visibility: 'hidden' }}>
            &nbsp;
          </p>
        )}

        {/* Features */}
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plan.features.map((f, idx) => (
            <FeatureItem key={idx} text={t18n(f, locale)} white={isHighlighted} />
          ))}
        </ul>

        {/* CTA */}
        {showCta && (
          <PubButton
            variant={isHighlighted ? 'cta-white' : 'secondary'}
            onClick={handleCtaClick}
            style={{ width: '100%' }}
          >
            {t18n(plan.ctaLabel, locale)}
          </PubButton>
        )}
      </div>
    </PubCard>
  );
}

export function PricingSection({ onSignup, registrationEnabled = true }: PricingSectionProps) {
  const { t, i18n } = useTranslation('public');
  const locale = i18n.language?.split('-')[0] || 'en';
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  const [plans, setPlans] = useState<PublicPricingPlan[]>([]);

  useEffect(() => {
    fetch(`${getApiBaseFromWindow()}/public/pricing-plans`)
      .then((r) => r.json())
      .then((data: { plans?: PublicPricingPlan[] }) => setPlans(data.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

  if (plans.length === 0) return null;

  return (
    <section
      id="pricing"
      ref={sectionRef}
      className="pub-reveal"
      style={{ background: 'var(--pub-bg-dark)', padding: 'var(--pub-section-padding)' }}
    >
      <div className="pub-container" style={{ textAlign: 'center' }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <PubBadge variant="teal" dot>
            {t('pricing.badge')}
          </PubBadge>
        </div>
        <h2 className="pub-text-h2" style={{ color: 'var(--pub-text-on-dark)', marginBottom: 16 }}>
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
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              locale={locale}
              onSignup={onSignup}
              registrationEnabled={registrationEnabled}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
