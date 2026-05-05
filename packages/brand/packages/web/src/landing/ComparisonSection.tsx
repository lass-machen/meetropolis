import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '@app/ui/pub/components/PubBadge';
import { PubCard } from '@app/ui/pub/components/PubCard';
import { useReveal } from '@app/ui/pub/hooks/useReveal';

/* ---------- Inline SVG Icons ---------- */

const VideoCallIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 8-6 4 6 4V8Z" />
    <rect width="14" height="12" x="2" y="6" rx="2" ry="2" />
  </svg>
);

const ChatBubbleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const BuildingOfficeIcon = () => (
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

const CheckMarkIcon = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const DashIcon = ({ color }: { color: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
  </svg>
);

/* ---------- Card config ---------- */

interface CardData {
  Icon: React.FC;
  iconBg: string;
  iconColor: string;
  titleKey: string;
  subtitleKey: string;
  strengthKeys: string[];
  gapKeys: string[];
  highlighted: boolean;
  gapLabelKey: 'comparison.gapLabel' | 'comparison.plusLabel';
}

const CARDS: CardData[] = [
  {
    Icon: VideoCallIcon,
    iconBg: 'var(--pub-icon-bg-amber)',
    iconColor: 'var(--pub-accent-amber)',
    titleKey: 'comparison.card1Title',
    subtitleKey: 'comparison.card1Subtitle',
    strengthKeys: ['comparison.card1Strength1', 'comparison.card1Strength2'],
    gapKeys: ['comparison.card1Gap1', 'comparison.card1Gap2'],
    highlighted: false,
    gapLabelKey: 'comparison.gapLabel',
  },
  {
    Icon: ChatBubbleIcon,
    iconBg: 'var(--pub-icon-bg-teal)',
    iconColor: 'var(--pub-accent-teal)',
    titleKey: 'comparison.card2Title',
    subtitleKey: 'comparison.card2Subtitle',
    strengthKeys: ['comparison.card2Strength1', 'comparison.card2Strength2'],
    gapKeys: ['comparison.card2Gap1', 'comparison.card2Gap2'],
    highlighted: false,
    gapLabelKey: 'comparison.gapLabel',
  },
  {
    Icon: BuildingOfficeIcon,
    iconBg: 'rgba(255,255,255,0.18)',
    iconColor: '#FFFFFF',
    titleKey: 'comparison.card3Title',
    subtitleKey: 'comparison.card3Subtitle',
    strengthKeys: [
      'comparison.card3Strength1',
      'comparison.card3Strength2',
      'comparison.card3Strength3',
    ],
    gapKeys: [],
    highlighted: true,
    gapLabelKey: 'comparison.plusLabel',
  },
];

const COMPARISON_STYLES = `
  .pub-comparison-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: stretch;
  }
  .pub-comparison-card {
    width: calc(33.333% - 16px);
    min-width: 0;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
  }
  @media (max-width: 768px) {
    .pub-comparison-card {
      width: 100%;
    }
  }
`;

interface ComparisonColors {
  title: string;
  subtitle: string;
  label: string;
  item: string;
  check: string;
  dash: string;
}

function getComparisonColors(highlighted: boolean): ComparisonColors {
  return {
    title: highlighted ? '#FFFFFF' : 'var(--pub-text-primary)',
    subtitle: highlighted ? 'rgba(255,255,255,0.8)' : 'var(--pub-text-secondary)',
    label: highlighted ? 'rgba(255,255,255,0.7)' : 'var(--pub-text-secondary)',
    item: highlighted ? 'rgba(255,255,255,0.92)' : 'var(--pub-text-primary)',
    check: highlighted ? '#FFFFFF' : 'var(--pub-accent-teal)',
    dash: highlighted ? 'rgba(255,255,255,0.6)' : 'var(--pub-text-secondary)',
  };
}

/* ---------- Sub-Components ---------- */

function ComparisonHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="teal">
          {t('comparison.badge')}
        </PubBadge>
      </div>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('comparison.title')}
      </h2>
      <p
        className="pub-text-subline"
        style={{ maxWidth: 640, margin: '0 auto' }}
      >
        {t('comparison.subtitle')}
      </p>
    </div>
  );
}

function RecommendedBadge() {
  const { t } = useTranslation('public');
  return (
    <span
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '5px 12px',
        borderRadius: 'var(--pub-radius-pill)',
        fontFamily: 'var(--pub-font-body)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        background: '#FFFFFF',
        color: 'var(--pub-accent-purple)',
      }}
    >
      {t('comparison.recommendedLabel')}
    </span>
  );
}

function ComparisonCardHeader({ card, colors }: { card: CardData; colors: ComparisonColors }) {
  const { t } = useTranslation('public');
  return (
    <>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--pub-radius-icon)',
          background: card.iconBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: card.iconColor,
          marginBottom: 20,
        }}
      >
        <card.Icon />
      </div>
      <h3
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 700,
          fontSize: 20,
          color: colors.title,
          marginBottom: 4,
        }}
      >
        {t(card.titleKey)}
      </h3>
      <p
        className="pub-text-body-sm"
        style={{ color: colors.subtitle, marginBottom: 24 }}
      >
        {t(card.subtitleKey)}
      </p>
    </>
  );
}

interface BulletListProps {
  labelKey: string;
  itemKeys: string[];
  colors: ComparisonColors;
  variant: 'check' | 'dash';
  marginBottom?: number;
}

function BulletList({ labelKey, itemKeys, colors, variant, marginBottom = 0 }: BulletListProps) {
  const { t } = useTranslation('public');
  const itemColor = variant === 'check' ? colors.item : 'var(--pub-text-secondary)';
  return (
    <div style={{ marginBottom }}>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontWeight: 600,
          fontSize: 13,
          color: colors.label,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          margin: '0 0 12px 0',
        }}
      >
        {t(labelKey)}
      </p>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {itemKeys.map((key) => (
          <li
            key={key}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontFamily: 'var(--pub-font-body)',
              fontSize: 14,
              lineHeight: 1.5,
              color: itemColor,
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 2 }}>
              {variant === 'check'
                ? <CheckMarkIcon color={colors.check} />
                : <DashIcon color={colors.dash} />}
            </span>
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonCardItem({ card }: { card: CardData }) {
  const colors = getComparisonColors(card.highlighted);
  const strengthLabelKey = card.highlighted
    ? 'comparison.plusLabel'
    : 'comparison.strengthLabel';

  return (
    <PubCard
      variant={card.highlighted ? 'purple' : 'surface'}
      className="pub-comparison-card"
      style={
        card.highlighted
          ? { boxShadow: '0 0 40px rgba(139,92,246,0.3)', position: 'relative' }
          : {}
      }
    >
      {card.highlighted && <RecommendedBadge />}
      <ComparisonCardHeader card={card} colors={colors} />
      <BulletList
        labelKey={strengthLabelKey}
        itemKeys={card.strengthKeys}
        colors={colors}
        variant="check"
        marginBottom={card.gapKeys.length ? 20 : 0}
      />
      {card.gapKeys.length > 0 && (
        <BulletList
          labelKey={card.gapLabelKey}
          itemKeys={card.gapKeys}
          colors={colors}
          variant="dash"
        />
      )}
    </PubCard>
  );
}

function ComparisonGrid() {
  return (
    <div className="pub-comparison-grid">
      {CARDS.map((card) => (
        <ComparisonCardItem key={card.titleKey} card={card} />
      ))}
    </div>
  );
}

/* ---------- Component ---------- */

export function ComparisonSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="comparison"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-primary)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <ComparisonHeader />
        <ComparisonGrid />
      </div>
      <style>{COMPARISON_STYLES}</style>
    </section>
  );
}
