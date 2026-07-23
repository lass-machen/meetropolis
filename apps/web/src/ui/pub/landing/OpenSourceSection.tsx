import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { PubBadge } from '../components/PubBadge';
import { useReveal } from '../hooks/useReveal';
import { GITHUB_REPO_URL } from '../links';

const CodeIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

// GitHub mark, used purely to link to the repository.
const GithubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--pub-accent-teal)"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 6 9 17l-5-5" />
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
              <CheckItem text={t('openSource.check1')} />
              <CheckItem text={t('openSource.check2')} />
              <CheckItem text={t('openSource.check3')} />
            </div>

            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                alignItems: 'center',
                gap: 10,
                fontFamily: 'var(--pub-font-body)',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--pub-text-primary)',
                textDecoration: 'none',
                border: '1.5px solid var(--pub-border-light)',
                borderRadius: 'var(--pub-radius-pill)',
                padding: '12px 22px',
              }}
            >
              <GithubIcon />
              {t('openSource.cta')}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
