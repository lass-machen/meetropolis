import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

/* ---------- Icons ---------- */

const HandshakeIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m11 17 2 2a1 1 0 1 0 3-3" />
    <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
    <path d="m21 3 1 11h-2" />
    <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
    <path d="M3 4h8" />
  </svg>
);

const LockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const KeyIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21 2-9.6 9.6" />
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-3 3" />
    <path d="m18 5 3 3" />
    <path d="M14 6.5 17.5 10" />
  </svg>
);

const QuoteIcon = ({ color }: { color: string }) => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill={color} stroke="none">
    <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.75-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2c0 4-2 5-3 5v3zm12 0c3 0 7-1 7-8V5c0-1.25-.75-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h2c0 4-2 5-3 5v3z" />
  </svg>
);

const VerifiedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2 9 5l-4-1-1 4-3 3 3 3-1 4 4-1 3 3 3-3 4 1 1-4 3-3-3-3 1-4-4 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/* ---------- Stats ---------- */

interface StatItemProps {
  value: string;
  label: string;
  color: string;
}

function StatItem({ value, label, color }: StatItemProps) {
  return (
    <div style={{ textAlign: 'center', flex: '1 1 0', minWidth: 140 }}>
      <div
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontSize: 48,
          fontWeight: 800,
          color,
          lineHeight: 1.1,
          marginBottom: 6,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--pub-text-secondary)',
          lineHeight: 1.4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* ---------- Quote Card ---------- */

interface QuoteCardProps {
  text: string;
  role: string;
  meta: string;
  verifiedLabel: string;
  accentColor: string;
}

function QuoteCard({ text, role, meta, verifiedLabel, accentColor }: QuoteCardProps) {
  return (
    <PubCard
      variant="surface"
      className="pub-quote-card"
      style={{ padding: 32, display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ marginBottom: 16, opacity: 0.85 }}>
        <QuoteIcon color={accentColor} />
      </div>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 15,
          lineHeight: 1.7,
          color: 'var(--pub-text-primary)',
          marginBottom: 24,
          flex: 1,
        }}
      >
        {text}
      </p>
      <div
        style={{
          paddingTop: 20,
          borderTop: '1px solid var(--pub-border-light)',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--pub-font-display)',
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--pub-text-primary)',
            marginBottom: 2,
          }}
        >
          {role}
        </div>
        <div
          style={{
            fontFamily: 'var(--pub-font-body)',
            fontSize: 13,
            color: 'var(--pub-text-secondary)',
            marginBottom: 12,
          }}
        >
          {meta}
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: 'var(--pub-font-body)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: accentColor,
          }}
        >
          <VerifiedIcon />
          {verifiedLabel}
        </span>
      </div>
    </PubCard>
  );
}

/* ---------- Pillars ---------- */

interface PillarData {
  Icon: React.FC;
  iconBg: string;
  iconColor: string;
  titleKey: string;
  textKey: string;
}

const PILLARS: PillarData[] = [
  {
    Icon: HandshakeIcon,
    iconBg: 'var(--pub-icon-bg-purple)',
    iconColor: 'var(--pub-accent-purple)',
    titleKey: 'social.pillar1Title',
    textKey: 'social.pillar1Text',
  },
  {
    Icon: LockIcon,
    iconBg: 'var(--pub-icon-bg-teal)',
    iconColor: 'var(--pub-accent-teal)',
    titleKey: 'social.pillar2Title',
    textKey: 'social.pillar2Text',
  },
  {
    Icon: KeyIcon,
    iconBg: 'var(--pub-icon-bg-pink)',
    iconColor: 'var(--pub-accent-pink)',
    titleKey: 'social.pillar3Title',
    textKey: 'social.pillar3Text',
  },
];

const SOCIAL_PROOF_STYLES = `
  .pub-stats-row {
    display: flex;
    flex-wrap: wrap;
    gap: 32px;
    padding: 32px 24px;
    margin-bottom: 72px;
    background: var(--pub-bg-surface);
    border-radius: var(--pub-radius-card-lg);
    align-items: center;
    justify-content: space-between;
  }
  .pub-quotes-row {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    margin-bottom: 0;
    align-items: stretch;
  }
  .pub-quote-card {
    width: calc(33.333% - 16px);
    min-width: 0;
    box-sizing: border-box;
  }
  .pub-pillars-divider {
    height: 1px;
    background: var(--pub-border-light);
    margin: 80px 0 56px;
    max-width: 480px;
    margin-left: auto;
    margin-right: auto;
  }
  .pub-pillars-row {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }
  .pub-pillar-card {
    width: calc(33.333% - 16px);
    min-width: 0;
    box-sizing: border-box;
  }
  @media (max-width: 1024px) {
    .pub-quote-card {
      width: calc(50% - 12px);
    }
    .pub-pillar-card {
      width: calc(50% - 12px);
    }
  }
  @media (max-width: 768px) {
    .pub-stats-row {
      padding: 24px 16px;
      gap: 24px;
    }
    .pub-quote-card {
      width: 100%;
    }
    .pub-pillar-card {
      width: 100%;
    }
  }
`;

const SUBHEAD_TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--pub-font-display)',
  fontSize: 24,
  fontWeight: 700,
  color: 'var(--pub-text-primary)',
  marginBottom: 8,
  letterSpacing: '-0.01em',
};

const SUBHEAD_SUBTITLE_STYLE: React.CSSProperties = {
  fontFamily: 'var(--pub-font-body)',
  fontSize: 14,
  color: 'var(--pub-text-secondary)',
  maxWidth: 560,
  margin: '0 auto',
  lineHeight: 1.6,
};

/* ---------- Sub-Components ---------- */

function SocialProofHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 56 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="amber" dot>
          {t('social.badge')}
        </PubBadge>
      </div>
      <h2
        className="pub-text-h2"
        style={{ color: 'var(--pub-text-primary)', maxWidth: 720, margin: '0 auto 16px' }}
      >
        {t('social.title')}
      </h2>
      <p className="pub-text-subline" style={{ maxWidth: 700, margin: '0 auto' }}>
        {t('social.subtitle')}
      </p>
    </div>
  );
}

function StatsRow() {
  const { t } = useTranslation('public');
  return (
    <div className="pub-stats-row">
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
  );
}

function SubHead({ titleKey, subtitleKey }: { titleKey: string; subtitleKey: string }) {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 32 }}>
      <h3 style={SUBHEAD_TITLE_STYLE}>
        {t(titleKey)}
      </h3>
      <p style={SUBHEAD_SUBTITLE_STYLE}>
        {t(subtitleKey)}
      </p>
    </div>
  );
}

function QuotesRow() {
  const { t } = useTranslation('public');
  const verifiedLabel = t('social.quoteVerifiedLabel');
  return (
    <div className="pub-quotes-row">
      <QuoteCard
        text={t('social.quote1Text')}
        role={t('social.quote1Role')}
        meta={t('social.quote1Meta')}
        verifiedLabel={verifiedLabel}
        accentColor="var(--pub-accent-purple)"
      />
      <QuoteCard
        text={t('social.quote2Text')}
        role={t('social.quote2Role')}
        meta={t('social.quote2Meta')}
        verifiedLabel={verifiedLabel}
        accentColor="var(--pub-accent-teal)"
      />
      <QuoteCard
        text={t('social.quote3Text')}
        role={t('social.quote3Role')}
        meta={t('social.quote3Meta')}
        verifiedLabel={verifiedLabel}
        accentColor="var(--pub-accent-pink)"
      />
    </div>
  );
}

function PillarCardItem({ pillar }: { pillar: PillarData }) {
  const { t } = useTranslation('public');
  const { Icon, iconBg, iconColor, titleKey, textKey } = pillar;
  return (
    <PubCard variant="surface" hover className="pub-pillar-card">
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
      <h4
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 700,
          fontSize: 18,
          color: 'var(--pub-text-primary)',
          marginBottom: 8,
          lineHeight: 1.3,
        }}
      >
        {t(titleKey)}
      </h4>
      <p
        className="pub-text-body-sm"
        style={{ color: 'var(--pub-text-secondary)' }}
      >
        {t(textKey)}
      </p>
    </PubCard>
  );
}

function PillarsRow() {
  return (
    <div className="pub-pillars-row">
      {PILLARS.map((pillar) => (
        <PillarCardItem key={pillar.titleKey} pillar={pillar} />
      ))}
    </div>
  );
}

/* ---------- Component ---------- */

export function SocialProofSection() {
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
        <SocialProofHeader />
        <StatsRow />
        <SubHead titleKey="social.quotesTitle" subtitleKey="social.quotesSubtitle" />
        <QuotesRow />
        <div className="pub-pillars-divider" aria-hidden="true" />
        <SubHead titleKey="social.pillarsTitle" subtitleKey="social.pillarsSubtitle" />
        <PillarsRow />
      </div>
      <style>{SOCIAL_PROOF_STYLES}</style>
    </section>
  );
}
