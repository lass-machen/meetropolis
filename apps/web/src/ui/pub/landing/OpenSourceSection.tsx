import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { PubButton } from '../components/PubButton';
import { useReveal } from '../hooks/useReveal';

const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--pub-accent-teal)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

interface CheckItemProps {
  text: string;
}

function CheckItem({ text }: CheckItemProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <CheckIcon />
      <span
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 15,
          fontWeight: 500,
          color: 'var(--pub-text-primary)',
        }}
      >
        {text}
      </span>
    </div>
  );
}

export function OpenSourceSection() {
  const { t } = useTranslation('public');
  const sectionRef = useRef<HTMLElement>(null);
  useReveal(sectionRef);

  return (
    <section
      id="open-source"
      ref={sectionRef}
      className="pub-reveal"
      style={{
        background: 'var(--pub-bg-surface)',
        padding: 'var(--pub-section-padding)',
      }}
    >
      <div className="pub-container">
        <div className="open-source-layout">
          {/* Left: Image */}
          <div className="open-source-image-container">
            <img
              src="/images/pub/open-source-teaser-ide.png"
              alt="Open Source IDE"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </div>

          {/* Right: Content */}
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ marginBottom: 20 }}>
              <PubBadge variant="teal" icon={<CodeIcon />}>
                {t('openSource.badge')}
              </PubBadge>
            </div>

            <h2
              className="pub-text-h3"
              style={{
                color: 'var(--pub-text-primary)',
                marginBottom: 16,
              }}
            >
              {t('openSource.title')}
            </h2>

            <p
              className="pub-text-body"
              style={{
                color: 'var(--pub-text-secondary)',
                marginBottom: 28,
                maxWidth: 480,
              }}
            >
              {t('openSource.text')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
              <CheckItem text={t('openSource.check1')} />
              <CheckItem text={t('openSource.check2')} />
              <CheckItem text={t('openSource.check3')} />
            </div>

            <div>
              <PubButton
                variant="ghost"
                rightIcon={<ArrowRightIcon />}
                style={{
                  background: 'var(--pub-bg-dark)',
                  color: '#FFFFFF',
                }}
              >
                {t('openSource.cta')}
              </PubButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
