import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';

interface LegalSection {
  id: string;
  title: string;
  content: React.ReactNode;
}

interface LegalLayoutProps {
  title: string;
  subtitle: string;
  breadcrumbLabel: string;
  lastUpdated: string;
  sections: LegalSection[];
  onBack: () => void;
  navigate: (route: string) => void;
  registrationEnabled?: boolean;
}

function CalendarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M5.333 1.333v2M10.667 1.333v2M2.333 6.333h11.334M3.667 2.667h8.666c.737 0 1.334.597 1.334 1.333v8.667c0 .736-.597 1.333-1.334 1.333H3.667c-.737 0-1.334-.597-1.334-1.333V4c0-.736.597-1.333 1.334-1.333z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LegalLayout({
  title,
  subtitle,
  breadcrumbLabel,
  lastUpdated,
  sections,
  onBack,
  navigate,
  registrationEnabled,
}: LegalLayoutProps) {
  const { t } = useTranslation('public');
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const registerRef = useCallback(
    (id: string, el: HTMLElement | null) => {
      if (el) {
        sectionRefs.current.set(id, el);
      } else {
        sectionRefs.current.delete(id);
      }
    },
    [],
  );

  // IntersectionObserver for active section detection
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    const visibleSections = new Set<string>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const id = entry.target.getAttribute('data-section-id');
          if (!id) return;
          if (entry.isIntersecting) {
            visibleSections.add(id);
          } else {
            visibleSections.delete(id);
          }
        });

        // Pick the first visible section in document order
        for (const section of sections) {
          if (visibleSections.has(section.id)) {
            setActiveId(section.id);
            break;
          }
        }
      },
      {
        rootMargin: '-120px 0px -40% 0px',
        threshold: 0,
      },
    );

    // Observe all sections
    sectionRefs.current.forEach((el) => {
      observerRef.current?.observe(el);
    });

    return () => {
      observerRef.current?.disconnect();
    };
  }, [sections]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <PublicLayout
      onLogin={() => navigate('app')}
      onSignup={() => navigate('register')}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    >
      {/* Page Hero */}
      <div
        style={{
          background: 'var(--pub-bg-surface)',
          padding: '48px 120px 56px',
        }}
        className="legal-hero"
      >
        <div
          style={{
            maxWidth: 1000,
            margin: '0 auto',
          }}
        >
          {/* Breadcrumb */}
          <div
            style={{
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--pub-text-secondary)',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--pub-font-body)',
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--pub-accent-purple)',
                padding: 0,
              }}
            >
              {t('legal.breadcrumbHome')}
            </button>
            <span style={{ color: 'var(--pub-text-tertiary)' }}>/</span>
            <span>{breadcrumbLabel}</span>
          </div>

          {/* Title */}
          <h1
            className="pub-text-h3"
            style={{
              color: 'var(--pub-text-primary)',
              margin: 0,
              marginBottom: 12,
            }}
          >
            {title}
          </h1>

          {/* Subtitle */}
          <p
            className="pub-text-subline"
            style={{
              margin: 0,
            }}
          >
            {subtitle}
          </p>
        </div>
      </div>

      {/* Content Area */}
      <div
        className="legal-content-area"
        style={{
          maxWidth: 1000,
          margin: '0 auto',
          padding: '48px 120px 80px',
          display: 'flex',
          gap: 48,
        }}
      >
        {/* Sidebar */}
        <nav
          className="legal-sidebar"
          style={{
            width: 240,
            flexShrink: 0,
            position: 'sticky',
            top: 120,
            alignSelf: 'flex-start',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {sections.map((section) => {
            const isActive = activeId === section.id;
            return (
              <button
                key={section.id}
                onClick={() => scrollToSection(section.id)}
                style={{
                  background: isActive
                    ? 'var(--pub-accent-purple-soft)'
                    : 'transparent',
                  color: isActive
                    ? 'var(--pub-accent-purple)'
                    : 'var(--pub-text-secondary)',
                  border: 'none',
                  borderRadius: 8,
                  padding: '10px 16px',
                  fontFamily: 'var(--pub-font-body)',
                  fontSize: 14,
                  fontWeight: 500,
                  textAlign: 'left',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  lineHeight: 1.4,
                  overflowWrap: 'break-word',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--pub-text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.color = 'var(--pub-text-secondary)';
                  }
                }}
              >
                {section.title}
              </button>
            );
          })}
        </nav>

        {/* Main Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              data-section-id={section.id}
              ref={(el) => registerRef(section.id, el)}
              style={{ marginBottom: 48, scrollMarginTop: 120 }}
            >
              <h2
                className="pub-text-h5"
                style={{
                  color: 'var(--pub-text-primary)',
                  margin: 0,
                }}
              >
                {section.title}
              </h2>
              <div
                style={{
                  height: 1,
                  background: 'var(--pub-border-light)',
                  margin: '16px 0 24px',
                }}
              />
              <div
                className="pub-text-body legal-body-content"
                style={{
                  color: 'var(--pub-text-primary)',
                }}
              >
                {section.content}
              </div>
            </section>
          ))}

          {/* Last Updated */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              color: 'var(--pub-text-tertiary)',
              marginTop: 32,
              paddingTop: 24,
              borderTop: '1px solid var(--pub-border-light)',
            }}
          >
            <CalendarIcon />
            <span>
              {t('legal.lastUpdated')} {lastUpdated}
            </span>
          </div>
        </div>
      </div>

      {/* Responsive Styles */}
      <style>{`
        @media (max-width: 1024px) {
          .legal-hero {
            padding: 40px 40px 48px !important;
          }
          .legal-content-area {
            padding: 40px 40px 64px !important;
          }
        }
        @media (max-width: 768px) {
          .legal-hero {
            padding: 32px 24px 40px !important;
          }
          .legal-content-area {
            padding: 32px 24px 56px !important;
            flex-direction: column !important;
          }
          .legal-sidebar {
            display: none !important;
          }
        }
        .legal-body-content p {
          margin: 0 0 12px 0;
          line-height: 1.7;
        }
        .legal-body-content ul {
          padding-left: 24px;
          margin: 0 0 12px 0;
          line-height: 1.8;
        }
        .legal-body-content li {
          margin-bottom: 4px;
        }
        .legal-body-content a {
          color: var(--pub-accent-purple);
          text-decoration: underline;
        }
        .legal-body-content a:hover {
          color: var(--pub-accent-purple-dark);
        }
        .legal-body-content h3 {
          font-family: var(--pub-font-display);
          font-size: 18px;
          font-weight: 600;
          line-height: 1.3;
          color: var(--pub-text-primary);
          margin: 24px 0 12px 0;
        }
        .legal-body-content h3:first-child {
          margin-top: 0;
        }
        .legal-body-content strong {
          font-weight: 600;
        }
        .legal-body-content em {
          font-style: italic;
          color: var(--pub-text-secondary);
        }
      `}</style>
    </PublicLayout>
  );
}
