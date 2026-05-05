import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

/* ---------- Inline SVG Icons ---------- */

const ShieldCheckIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const LinkIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <path d="M2 12h20" />
  </svg>
);

const CreditCardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="14" x="2" y="5" rx="2" />
    <path d="M2 10h20" />
  </svg>
);

const LayoutDashboardIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  </svg>
);

const BuildingIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M12 10h.01" />
    <path d="M12 14h.01" />
    <path d="M16 10h.01" />
    <path d="M16 14h.01" />
    <path d="M8 10h.01" />
    <path d="M8 14h.01" />
  </svg>
);

/* ---------- Card config ---------- */

interface CardData {
  Icon: React.FC;
  iconBg: string;
  iconColor: string;
  titleKey: string;
  textKey: string;
}

const CARDS: CardData[] = [
  {
    Icon: ShieldCheckIcon,
    iconBg: 'var(--pub-icon-bg-purple)',
    iconColor: 'var(--pub-accent-purple)',
    titleKey: 'secondaryFeatures.card1Title',
    textKey: 'secondaryFeatures.card1Text',
  },
  {
    Icon: LinkIcon,
    iconBg: 'var(--pub-icon-bg-teal)',
    iconColor: 'var(--pub-accent-teal)',
    titleKey: 'secondaryFeatures.card2Title',
    textKey: 'secondaryFeatures.card2Text',
  },
  {
    Icon: GlobeIcon,
    iconBg: 'var(--pub-icon-bg-pink)',
    iconColor: 'var(--pub-accent-pink)',
    titleKey: 'secondaryFeatures.card3Title',
    textKey: 'secondaryFeatures.card3Text',
  },
  {
    Icon: CreditCardIcon,
    iconBg: 'var(--pub-icon-bg-amber)',
    iconColor: 'var(--pub-accent-amber)',
    titleKey: 'secondaryFeatures.card4Title',
    textKey: 'secondaryFeatures.card4Text',
  },
  {
    Icon: LayoutDashboardIcon,
    iconBg: 'var(--pub-icon-bg-red)',
    iconColor: '#EF4444',
    titleKey: 'secondaryFeatures.card5Title',
    textKey: 'secondaryFeatures.card5Text',
  },
  {
    Icon: BuildingIcon,
    iconBg: 'var(--pub-icon-bg-indigo)',
    iconColor: '#6366F1',
    titleKey: 'secondaryFeatures.card6Title',
    textKey: 'secondaryFeatures.card6Text',
  },
];

const SECONDARY_FEATURES_STYLES = `
  .pub-secondary-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }
  .pub-secondary-card {
    width: calc(33.333% - 16px);
    min-width: 0;
    box-sizing: border-box;
  }
  @media (max-width: 768px) {
    .pub-secondary-card {
      width: 100%;
    }
  }
`;

/* ---------- Sub-Components ---------- */

function SecondaryFeaturesHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('secondaryFeatures.title')}
      </h2>
      <p
        className="pub-text-subline"
        style={{ maxWidth: 560, margin: '0 auto' }}
      >
        {t('secondaryFeatures.subtitle')}
      </p>
    </div>
  );
}

interface SecondaryCardProps {
  card: CardData;
}

function SecondaryCard({ card }: SecondaryCardProps) {
  const { t } = useTranslation('public');
  const { Icon, iconBg, iconColor, titleKey, textKey } = card;
  return (
    <PubCard variant="surface" hover className="pub-secondary-card">
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--pub-radius-icon)',
          background: iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          marginBottom: 20,
        }}
      >
        <Icon />
      </div>
      <h3 className="pub-text-h6" style={{ marginBottom: 8 }}>
        {t(titleKey)}
      </h3>
      <p
        className="pub-text-body-sm"
        style={{ color: 'var(--pub-text-secondary)' }}
      >
        {t(textKey)}
      </p>
    </PubCard>
  );
}

function SecondaryCardGrid() {
  return (
    <div className="pub-secondary-grid">
      {CARDS.map((card) => (
        <SecondaryCard key={card.titleKey} card={card} />
      ))}
    </div>
  );
}

/* ---------- Component ---------- */

export function SecondaryFeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-primary)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <SecondaryFeaturesHeader />
        <SecondaryCardGrid />
      </div>
      <style>{SECONDARY_FEATURES_STYLES}</style>
    </section>
  );
}
