import React from 'react';
import { useTranslation } from 'react-i18next';
import { GITHUB_REPO_URL } from '../links';

interface PublicFooterProps {
  navigate: (route: string) => void;
}

type FooterLinkAction =
  | { type: 'scroll'; anchorId: string }
  | { type: 'navigate'; route: string }
  | { type: 'external'; href: string }
  | { type: 'disabled' };

interface FooterLink {
  i18nKey: string;
  action: FooterLinkAction;
}

interface FooterColumn {
  titleKey: string;
  links: FooterLink[];
}

const FOOTER_COLUMNS: FooterColumn[] = [
  {
    titleKey: 'footer.productTitle',
    links: [
      { i18nKey: 'footer.productFeatures', action: { type: 'scroll', anchorId: 'features' } },
      { i18nKey: 'footer.productPricing', action: { type: 'scroll', anchorId: 'pricing' } },
      { i18nKey: 'footer.productChangelog', action: { type: 'disabled' } },
      { i18nKey: 'footer.productDesktopApp', action: { type: 'navigate', route: 'download' } },
      { i18nKey: 'footer.productSourceCode', action: { type: 'external', href: GITHUB_REPO_URL } },
    ],
  },
  {
    titleKey: 'footer.companyTitle',
    links: [
      { i18nKey: 'footer.companyAbout', action: { type: 'disabled' } },
      { i18nKey: 'footer.companyBlog', action: { type: 'disabled' } },
      { i18nKey: 'footer.companyCareers', action: { type: 'disabled' } },
      { i18nKey: 'footer.companyContact', action: { type: 'disabled' } },
    ],
  },
  {
    titleKey: 'footer.legalTitle',
    links: [
      { i18nKey: 'footer.legalPrivacy', action: { type: 'navigate', route: 'privacy' } },
      { i18nKey: 'footer.legalImprint', action: { type: 'navigate', route: 'impressum' } },
      { i18nKey: 'footer.legalTerms', action: { type: 'navigate', route: 'terms' } },
    ],
  },
];

const FOOTER_RESPONSIVE_STYLES = `
  @media (max-width: 768px) {
    .pub-footer__columns { justify-content: flex-start !important; }
  }
`;

function scrollToSectionFromFooter(anchorId: string) {
  const el = document.getElementById(anchorId);
  if (el) {
    history.pushState(null, '', `#${anchorId}`);
    el.scrollIntoView({ behavior: 'smooth' });
  } else {
    window.location.hash = '#/';
    setTimeout(() => {
      history.pushState(null, '', `#${anchorId}`);
      document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
    }, 300);
  }
}

function FooterLogo({ tagline }: { tagline: string }) {
  return (
    <div style={{ maxWidth: 320, flex: '1 1 280px' }}>
      <a
        href="#/"
        onClick={(e) => {
          e.preventDefault();
          window.location.hash = '#/';
        }}
        aria-label="Meetropolis"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 16,
          textDecoration: 'none',
          color: 'inherit',
        }}
      >
        <img src="/logo.png" alt="" width={36} height={36} style={{ display: 'block', objectFit: 'contain' }} />
        <span className="pub-wordmark" style={{ fontSize: 16 }}>
          Meetropolis
        </span>
      </a>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          lineHeight: 1.7,
          color: 'var(--pub-text-on-dark-secondary)',
          margin: 0,
          whiteSpace: 'pre-line',
        }}
      >
        {tagline}
      </p>
    </div>
  );
}

function actionToHref(action: FooterLinkAction): string {
  if (action.type === 'scroll') return `#${action.anchorId}`;
  if (action.type === 'navigate') return `#/${action.route}`;
  if (action.type === 'external') return action.href;
  return '#';
}

function FooterLinkItem({
  link,
  t,
  onClick,
}: {
  link: FooterLink;
  t: (k: string) => string;
  onClick: (e: React.MouseEvent<HTMLAnchorElement>, action: FooterLinkAction) => void;
}) {
  const isDisabled = link.action.type === 'disabled';
  const isExternal = link.action.type === 'external';
  return (
    <li>
      <a
        href={actionToHref(link.action)}
        onClick={(e) => onClick(e, link.action)}
        target={isExternal ? '_blank' : undefined}
        rel={isExternal ? 'noopener noreferrer' : undefined}
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 14,
          color: 'var(--pub-text-on-dark-secondary)',
          textDecoration: 'none',
          transition: 'color 0.15s ease',
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'default' : 'pointer',
          pointerEvents: isDisabled ? 'none' : 'auto',
        }}
        onMouseEnter={(e) => {
          if (!isDisabled) e.currentTarget.style.color = 'var(--pub-text-on-dark)';
        }}
        onMouseLeave={(e) => {
          if (!isDisabled) e.currentTarget.style.color = 'var(--pub-text-on-dark-secondary)';
        }}
      >
        {t(link.i18nKey)}
      </a>
    </li>
  );
}

function FooterColumns({
  t,
  columns,
  onLinkClick,
}: {
  t: (k: string) => string;
  columns: FooterColumn[];
  onLinkClick: (e: React.MouseEvent<HTMLAnchorElement>, action: FooterLinkAction) => void;
}) {
  return (
    <div
      className="pub-footer__columns"
      style={{ display: 'flex', gap: 64, flexWrap: 'wrap', flex: '1 1 auto', justifyContent: 'flex-end' }}
    >
      {columns.map((col) => (
        <div key={col.titleKey} style={{ minWidth: 140 }}>
          <h4
            style={{
              fontFamily: 'var(--pub-font-body)',
              fontSize: 13,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--pub-text-on-dark-secondary)',
              marginBottom: 16,
              marginTop: 0,
            }}
          >
            {t(col.titleKey)}
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {col.links.map((link) => (
              <FooterLinkItem key={link.i18nKey} link={link} t={t} onClick={onLinkClick} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LangToggle({
  t,
  currentLang,
  onChange,
}: {
  t: (k: string) => string;
  currentLang: 'de' | 'en';
  onChange: (lang: string) => void;
}) {
  const baseStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '4px 8px',
    fontFamily: 'var(--pub-font-body)',
    fontSize: 13,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--pub-font-body)', fontSize: 13 }}>
      <button
        onClick={() => onChange('de')}
        style={{
          ...baseStyle,
          fontWeight: currentLang === 'de' ? 600 : 400,
          color: currentLang === 'de' ? 'var(--pub-text-on-dark)' : 'var(--pub-text-on-dark-secondary)',
        }}
      >
        {t('footer.langDe')}
      </button>
      <span style={{ color: 'var(--pub-border-dark)' }}>|</span>
      <button
        onClick={() => onChange('en')}
        style={{
          ...baseStyle,
          fontWeight: currentLang === 'en' ? 600 : 400,
          color: currentLang === 'en' ? 'var(--pub-text-on-dark)' : 'var(--pub-text-on-dark-secondary)',
        }}
      >
        {t('footer.langEn')}
      </button>
    </div>
  );
}

export function PublicFooter({ navigate }: PublicFooterProps) {
  const { t, i18n } = useTranslation('public');
  const currentYear = new Date().getFullYear();
  const currentLang: 'de' | 'en' = i18n.language?.startsWith('de') ? 'de' : 'en';
  const brandRaw = t('header.brandName');
  const brandName = brandRaw && brandRaw !== 'header.brandName' ? brandRaw : 'Meetropolis';

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, action: FooterLinkAction) => {
    // External links keep their native behaviour so the browser opens the
    // target in a new tab; everything else is handled by the hash router.
    if (action.type === 'external') return;
    e.preventDefault();
    switch (action.type) {
      case 'scroll':
        scrollToSectionFromFooter(action.anchorId);
        break;
      case 'navigate':
        navigate(action.route);
        break;
      case 'disabled':
        break;
    }
  };
  const handleLanguageChange = (lang: string) => {
    void i18n.changeLanguage(lang);
  };

  return (
    <footer style={{ background: 'var(--pub-bg-dark)', color: 'var(--pub-text-on-dark)' }}>
      <div style={{ padding: 'var(--pub-footer-padding)', maxWidth: 'var(--pub-max-width)', margin: '0 auto' }}>
        <div
          className="pub-footer__upper"
          style={{ display: 'flex', justifyContent: 'space-between', gap: 64, flexWrap: 'wrap' }}
        >
          <FooterLogo tagline={t('footer.tagline')} />
          <FooterColumns t={t} columns={FOOTER_COLUMNS} onLinkClick={handleLinkClick} />
        </div>
        <div style={{ height: 1, background: 'var(--pub-border-dark)', margin: '40px 0 24px 0' }} />
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}
        >
          <span
            style={{ fontFamily: 'var(--pub-font-body)', fontSize: 13, color: 'var(--pub-text-on-dark-secondary)' }}
          >
            {t('footer.copyright', { year: currentYear, brandName })}
          </span>
          <LangToggle t={t} currentLang={currentLang} onChange={handleLanguageChange} />
        </div>
      </div>
      <style>{FOOTER_RESPONSIVE_STYLES}</style>
    </footer>
  );
}
