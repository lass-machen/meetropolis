import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { useReveal } from '../hooks/useReveal';

/* ---------- Inline Icon ---------- */

const ChevronDownIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/* ---------- FAQ Items ---------- */

interface FaqItem {
  questionKey: string;
  answerKey: string;
}

const FAQ_ITEMS: FaqItem[] = [
  { questionKey: 'faq.q1Question', answerKey: 'faq.q1Answer' },
  { questionKey: 'faq.q2Question', answerKey: 'faq.q2Answer' },
  { questionKey: 'faq.q3Question', answerKey: 'faq.q3Answer' },
  { questionKey: 'faq.q4Question', answerKey: 'faq.q4Answer' },
  { questionKey: 'faq.q5Question', answerKey: 'faq.q5Answer' },
  { questionKey: 'faq.q6Question', answerKey: 'faq.q6Answer' },
];

const FAQ_STYLES = `
  .pub-faq-item {
    border: 1px solid var(--pub-bg-surface-hover);
    border-radius: 12px;
    margin-bottom: 12px;
    background: var(--pub-bg-primary);
  }
  .pub-faq-item summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 20px 24px;
    cursor: pointer;
    list-style: none;
    font-family: var(--pub-font-display);
    font-weight: 600;
    font-size: 16px;
    color: var(--pub-text-primary);
  }
  .pub-faq-item summary::-webkit-details-marker {
    display: none;
  }
  .pub-faq-item summary svg {
    transition: transform 0.2s;
    flex-shrink: 0;
    color: var(--pub-text-secondary);
  }
  .pub-faq-item[open] summary svg {
    transform: rotate(180deg);
  }
  .pub-faq-answer {
    padding: 0 24px 20px;
    font-family: var(--pub-font-body);
    font-size: 15px;
    line-height: 1.7;
    color: var(--pub-text-secondary);
  }
`;

/* ---------- Sub-Components ---------- */

function FaqHeader() {
  const { t } = useTranslation('public');
  return (
    <div style={{ textAlign: 'center', marginBottom: 48 }}>
      <div style={{ marginBottom: 24 }}>
        <PubBadge variant="purple">{t('faq.badge')}</PubBadge>
      </div>
      <h2 className="pub-text-h2" style={{ marginBottom: 16 }}>
        {t('faq.title')}
      </h2>
      <p className="pub-text-subline" style={{ maxWidth: 560, margin: '0 auto' }}>
        {t('faq.subtitle')}
      </p>
    </div>
  );
}

function FaqList() {
  const { t } = useTranslation('public');
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {FAQ_ITEMS.map((item) => (
        <details key={item.questionKey} className="pub-faq-item">
          <summary>
            <span>{t(item.questionKey)}</span>
            <ChevronDownIcon />
          </summary>
          <div className="pub-faq-answer">{t(item.answerKey)}</div>
        </details>
      ))}
    </div>
  );
}

/* ---------- Component ---------- */

export function FaqSection() {
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="faq"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-surface)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <FaqHeader />
        <FaqList />
      </div>
      <style>{FAQ_STYLES}</style>
    </section>
  );
}
