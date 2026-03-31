import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';

interface PublicHeaderProps {
  onLogin: () => void;
  onSignup: () => void;
}

interface NavItem {
  i18nKey: string;
  anchorId: string;
}

const NAV_ITEMS: NavItem[] = [
  { i18nKey: 'header.product', anchorId: 'product' },
  { i18nKey: 'header.features', anchorId: 'features' },
  { i18nKey: 'header.pricing', anchorId: 'pricing' },
  { i18nKey: 'header.openSource', anchorId: 'open-source' },
];

function scrollToSection(anchorId: string) {
  history.pushState(null, '', `#${anchorId}`);
  document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
}

function MenuIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function PublicHeader({ onLogin, onSignup }: PublicHeaderProps) {
  const { t } = useTranslation('public');
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        background: '#FFFFFFEE',
        borderBottom: '1px solid var(--pub-border-light)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--pub-header-padding)',
          maxWidth: 'var(--pub-max-width)',
          margin: '0 auto',
        }}
      >
        {/* Logo */}
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = '#/';
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--pub-radius-logo)',
              background: 'var(--pub-gradient-purple)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontFamily: 'var(--pub-font-display)',
              fontWeight: 800,
              fontSize: 18,
            }}
          >
            M
          </div>
          <span
            style={{
              fontFamily: 'var(--pub-font-display)',
              fontWeight: 700,
              fontSize: 18,
              color: 'var(--pub-text-primary)',
            }}
          >
            Meetropolis
          </span>
        </a>

        {/* Desktop Navigation */}
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 32,
          }}
          className="pub-header__nav-desktop"
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.anchorId}
              href={`#${item.anchorId}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToSection(item.anchorId);
              }}
              style={{
                fontFamily: 'var(--pub-font-body)',
                fontSize: 15,
                fontWeight: 500,
                color: 'var(--pub-text-secondary)',
                textDecoration: 'none',
                transition: 'color 0.15s ease',
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color = 'var(--pub-text-primary)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = 'var(--pub-text-secondary)')
              }
            >
              {t(item.i18nKey)}
            </a>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div
          className="pub-header__actions-desktop"
          style={{ display: 'flex', alignItems: 'center', gap: 16 }}
        >
          <button
            onClick={onLogin}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'var(--pub-font-body)',
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--pub-accent-purple)',
              padding: '8px 12px',
            }}
          >
            {t('header.login')}
          </button>
          <PubButton variant="primary" size="sm" onClick={onSignup}>
            {t('header.trialCta')}
          </PubButton>
        </div>

        {/* Mobile Hamburger */}
        <button
          className="pub-header__hamburger"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
            color: 'var(--pub-text-primary)',
          }}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Mobile Overlay */}
      {menuOpen && (
        <div
          className="pub-header__mobile-overlay"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--pub-bg-primary)',
            borderBottom: '1px solid var(--pub-border-light)',
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
          }}
        >
          {NAV_ITEMS.map((item) => (
            <a
              key={item.anchorId}
              href={`#${item.anchorId}`}
              style={{
                fontFamily: 'var(--pub-font-body)',
                fontSize: 16,
                fontWeight: 500,
                color: 'var(--pub-text-primary)',
                textDecoration: 'none',
                padding: '8px 0',
              }}
              onClick={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                scrollToSection(item.anchorId);
              }}
            >
              {t(item.i18nKey)}
            </a>
          ))}
          <div
            style={{
              borderTop: '1px solid var(--pub-border-light)',
              paddingTop: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <button
              onClick={() => {
                setMenuOpen(false);
                onLogin();
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--pub-font-body)',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--pub-accent-purple)',
                padding: '8px 0',
                textAlign: 'left',
              }}
            >
              {t('header.login')}
            </button>
            <PubButton
              variant="primary"
              onClick={() => {
                setMenuOpen(false);
                onSignup();
              }}
              style={{ width: '100%' }}
            >
              {t('header.trialCta')}
            </PubButton>
          </div>
        </div>
      )}

      {/* Responsive CSS for hiding/showing desktop vs mobile */}
      <style>{`
        @media (min-width: 769px) {
          .pub-header__hamburger { display: none !important; }
          .pub-header__mobile-overlay { display: none !important; }
        }
        @media (max-width: 768px) {
          .pub-header__nav-desktop { display: none !important; }
          .pub-header__actions-desktop { display: none !important; }
          .pub-header__hamburger { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
