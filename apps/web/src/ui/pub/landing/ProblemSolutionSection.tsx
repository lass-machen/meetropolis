import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubButton } from '../components/PubButton';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

/* ---------- Inline SVG Icons ---------- */

const WifiOffIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h.01" />
    <path d="M8.5 16.429a5 5 0 0 1 7 0" />
    <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
    <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
    <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
    <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
    <path d="m2 2 20 20" />
  </svg>
);

const VideoOffIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.66 5H14a2 2 0 0 1 2 2v2.34l1 .67 4-2.67v10.5" />
    <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2" />
    <path d="m2 2 20 20" />
  </svg>
);

const PuzzleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.452-.968-.908a2.5 2.5 0 0 0-4.716.225 2.5 2.5 0 0 0 1.803 3.042c.462.124.876-.14 1.214-.478l.112-.112a.98.98 0 0 1 1.414 0l1.568 1.568a2.41 2.41 0 0 1 0 3.408l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.452-.968-.908a2.5 2.5 0 0 0-4.716.225A2.5 2.5 0 0 0 12 24" />
    <path d="M15.5 7.5 19 4l1 1-3.5 3.5" />
    <path d="m2 2 20 20" />
    <path d="M9 6V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    <path d="M9 18v3a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-3" />
    <path d="M6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3" />
    <path d="M18 9h3a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-3" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--pub-accent-purple)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="m19 12-7 7-7-7" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

/* ---------- Pain Card data ---------- */

interface PainCard {
  iconBg: string;
  iconColor: string;
  Icon: React.FC;
  titleKey: string;
  textKey: string;
}

const PAIN_CARDS: PainCard[] = [
  {
    iconBg: 'var(--pub-icon-bg-red)',
    iconColor: '#EF4444',
    Icon: WifiOffIcon,
    titleKey: 'problem.card1Title',
    textKey: 'problem.card1Text',
  },
  {
    iconBg: 'var(--pub-icon-bg-amber)',
    iconColor: '#F59E0B',
    Icon: VideoOffIcon,
    titleKey: 'problem.card2Title',
    textKey: 'problem.card2Text',
  },
  {
    iconBg: 'var(--pub-icon-bg-indigo)',
    iconColor: '#6366F1',
    Icon: PuzzleIcon,
    titleKey: 'problem.card3Title',
    textKey: 'problem.card3Text',
  },
];

const PROBLEM_SOLUTION_STYLES = `
  .pub-problem__cards {
    display: flex;
    gap: 24px;
  }
  .pub-problem__cards > * {
    flex: 1;
    min-width: 0;
  }
  .pub-solution-box {
    background: var(--pub-gradient-purple);
    border-radius: var(--pub-radius-card-lg);
    padding: 48px;
    display: flex;
    gap: 48px;
    align-items: center;
  }
  .pub-solution-box__text {
    flex: 1;
    min-width: 0;
  }
  .pub-solution-box__image {
    width: 440px;
    height: 300px;
    flex-shrink: 0;
    border-radius: var(--pub-radius-image);
    overflow: hidden;
  }
  @media (max-width: 768px) {
    .pub-problem__cards {
      flex-direction: column;
    }
    .pub-solution-box {
      flex-direction: column;
      padding: 32px 24px;
    }
    .pub-solution-box__image {
      width: 100%;
      height: auto;
      aspect-ratio: 440 / 300;
    }
  }
`;

/* ---------- Sub-Components ---------- */

function ProblemHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="pink" dot>
          {t('problem.badge')}
        </PubBadge>
      </div>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('problem.title')}
      </h2>
      <p
        className="pub-text-subline"
        style={{ maxWidth: 600, margin: '0 auto' }}
      >
        {t('problem.subtitle')}
      </p>
    </div>
  );
}

function PainCardItem({ card }: { card: PainCard }) {
  const { t } = useTranslation('public');
  const { iconBg, iconColor, Icon, titleKey, textKey } = card;
  return (
    <PubCard variant="surface" hover>
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
      <h3
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 700,
          fontSize: 17,
          lineHeight: 1.3,
          color: 'var(--pub-text-primary)',
          marginBottom: 8,
        }}
      >
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

function PainCardsGrid() {
  return (
    <div className="pub-problem__cards">
      {PAIN_CARDS.map((card) => (
        <PainCardItem key={card.titleKey} card={card} />
      ))}
    </div>
  );
}

function SolutionBox() {
  const { t } = useTranslation('public');
  return (
    <div className="pub-solution-box">
      <div className="pub-solution-box__text">
        <h3
          style={{
            fontFamily: 'var(--pub-font-display)',
            fontWeight: 800,
            fontSize: 32,
            lineHeight: 1.2,
            color: '#FFFFFF',
            marginBottom: 16,
          }}
        >
          {t('solution.title')}
        </h3>
        <p
          style={{
            fontFamily: 'var(--pub-font-body)',
            fontSize: 15,
            lineHeight: 1.7,
            color: 'rgba(255,255,255,0.8)',
            marginBottom: 32,
          }}
        >
          {t('solution.text')}
        </p>
        <PubButton
          variant="cta-white"
          rightIcon={<ArrowRightIcon />}
          onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          {t('solution.cta')}
        </PubButton>
      </div>
      <div className="pub-solution-box__image">
        <img
          src="/images/pub/meetropolis-screen-2.webp"
          alt="Meetropolis pixel art conversation"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

/* ---------- Component ---------- */

export function ProblemSolutionSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="product"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-primary)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <ProblemHeader />
        <PainCardsGrid />
        <div style={{ textAlign: 'center', margin: '32px 0' }}>
          <ArrowDownIcon />
        </div>
        <SolutionBox />
      </div>
      <style>{PROBLEM_SOLUTION_STYLES}</style>
    </section>
  );
}
