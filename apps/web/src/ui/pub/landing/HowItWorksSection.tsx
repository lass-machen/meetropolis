import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubCard } from '../components/PubCard';
import { useReveal } from '../hooks/useReveal';

/* ---------- Step config ---------- */

interface StepData {
  numKey: string;
  titleKey: string;
  textKey: string;
  accentColor: string;
  numberColor: string;
}

const STEPS: StepData[] = [
  {
    numKey: 'howItWorks.step1Num',
    titleKey: 'howItWorks.step1Title',
    textKey: 'howItWorks.step1Text',
    accentColor: 'var(--pub-accent-purple)',
    numberColor: 'rgba(139,92,246,0.2)',
  },
  {
    numKey: 'howItWorks.step2Num',
    titleKey: 'howItWorks.step2Title',
    textKey: 'howItWorks.step2Text',
    accentColor: 'var(--pub-accent-teal)',
    numberColor: 'rgba(20,184,166,0.2)',
  },
  {
    numKey: 'howItWorks.step3Num',
    titleKey: 'howItWorks.step3Title',
    textKey: 'howItWorks.step3Text',
    accentColor: 'var(--pub-accent-pink)',
    numberColor: 'rgba(244,114,182,0.2)',
  },
];

const HOW_IT_WORKS_STYLES = `
  .pub-howitworks-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
  }
  .pub-howitworks-card {
    width: calc(33.333% - 16px);
    min-width: 0;
    box-sizing: border-box;
  }
  @media (max-width: 768px) {
    .pub-howitworks-card {
      width: 100%;
    }
  }
`;

/* ---------- Sub-Components ---------- */

function HowItWorksHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="purple">
          {t('howItWorks.badge')}
        </PubBadge>
      </div>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('howItWorks.title')}
      </h2>
      <p
        className="pub-text-subline"
        style={{ maxWidth: 560, margin: '0 auto' }}
      >
        {t('howItWorks.subtitle')}
      </p>
    </div>
  );
}

interface StepCardProps {
  step: StepData;
}

function StepCard({ step }: StepCardProps) {
  const { t } = useTranslation('public');
  return (
    <PubCard
      variant="surface"
      hover
      className="pub-howitworks-card"
    >
      <span
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 800,
          fontSize: 56,
          lineHeight: 1,
          color: step.numberColor,
          display: 'block',
          marginBottom: 16,
        }}
      >
        {t(step.numKey)}
      </span>
      <h3
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 700,
          fontSize: 20,
          color: 'var(--pub-text-primary)',
          marginBottom: 8,
        }}
      >
        {t(step.titleKey)}
      </h3>
      <p
        className="pub-text-body-sm"
        style={{ color: 'var(--pub-text-secondary)' }}
      >
        {t(step.textKey)}
      </p>
    </PubCard>
  );
}

function StepGrid() {
  return (
    <div className="pub-howitworks-grid">
      {STEPS.map((step) => (
        <StepCard key={step.numKey} step={step} />
      ))}
    </div>
  );
}

/* ---------- Component ---------- */

export function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-surface)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <HowItWorksHeader />
        <StepGrid />
      </div>
      <style>{HOW_IT_WORKS_STYLES}</style>
    </section>
  );
}
