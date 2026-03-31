import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

interface StatItemProps {
  value: string;
  label: string;
  color: string;
}

function StatItem({ value, label, color }: StatItemProps) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontSize: 40,
          fontWeight: 800,
          color,
          lineHeight: 1.2,
          marginBottom: 4,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          fontWeight: 400,
          color: 'var(--pub-text-secondary)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

interface TestimonialProps {
  quote: string;
  name: string;
  role: string;
  initials: string;
  accentColor: string;
}

function TestimonialCard({ quote, name, role, initials, accentColor }: TestimonialProps) {
  return (
    <PubCard variant="surface" style={{ padding: 32, flex: '1 1 0', minWidth: 280 }}>
      <p
        style={{
          fontStyle: 'italic',
          fontSize: 15,
          fontFamily: 'var(--pub-font-body)',
          fontWeight: 400,
          color: 'var(--pub-text-primary)',
          lineHeight: 1.7,
          marginBottom: 24,
        }}
      >
        &ldquo;{quote}&rdquo;
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: accentColor,
            color: '#FFFFFF',
            fontFamily: 'var(--pub-font-body)',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <div>
          <div
            style={{
              fontFamily: 'var(--pub-font-body)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--pub-text-primary)',
            }}
          >
            {name}
          </div>
          <div
            style={{
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              fontWeight: 400,
              color: 'var(--pub-text-secondary)',
            }}
          >
            {role}
          </div>
        </div>
      </div>
    </PubCard>
  );
}

export function SocialProofSection() {
  const { t } = useTranslation('public');
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="social-proof"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-primary)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 className="pub-text-h2" style={{ color: 'var(--pub-text-primary)', marginBottom: 12 }}>
            {t('social.title')}
          </h2>
          <p className="pub-text-subline">
            {t('social.subtitle')}
          </p>
        </div>

        {/* Stats Row */}
        <div className="social-stats-row" style={{ marginBottom: 56 }}>
          <StatItem
            value={t('social.stat1Value')}
            label={t('social.stat1Label')}
            color="var(--pub-accent-purple)"
          />
          <StatItem
            value={t('social.stat2Value')}
            label={t('social.stat2Label')}
            color="var(--pub-accent-teal)"
          />
          <StatItem
            value={t('social.stat3Value')}
            label={t('social.stat3Label')}
            color="var(--pub-accent-pink)"
          />
          <StatItem
            value={t('social.stat4Value')}
            label={t('social.stat4Label')}
            color="var(--pub-accent-amber)"
          />
        </div>

        {/* Testimonials */}
        <div className="social-testimonials-row">
          <TestimonialCard
            quote={t('social.testimonial1Quote')}
            name={t('social.testimonial1Name')}
            role={t('social.testimonial1Role')}
            initials={t('social.testimonial1Initials')}
            accentColor="var(--pub-accent-purple)"
          />
          <TestimonialCard
            quote={t('social.testimonial2Quote')}
            name={t('social.testimonial2Name')}
            role={t('social.testimonial2Role')}
            initials={t('social.testimonial2Initials')}
            accentColor="var(--pub-accent-teal)"
          />
          <TestimonialCard
            quote={t('social.testimonial3Quote')}
            name={t('social.testimonial3Name')}
            role={t('social.testimonial3Role')}
            initials={t('social.testimonial3Initials')}
            accentColor="var(--pub-accent-pink)"
          />
        </div>
      </div>
    </section>
  );
}
