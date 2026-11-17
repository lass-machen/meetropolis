import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';

interface PublicHeaderProps {
  onLogin: () => void;
  onSignup: () => void;
  registrationEnabled?: boolean;
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

// Display and flex rules that media queries toggle live in this stylesheet,
// not in inline style props — an inline display would otherwise force
// !important on every breakpoint override.
const HEADER_RESPONSIVE_STYLES = `
  .pub-header__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--pub-header-padding);
    max-width: var(--pub-max-width);
    margin: 0 auto;
  }
  .pub-header__nav-desktop {
    display: flex;
    align-items: center;
    gap: 32px;
  }
  .pub-header__actions-desktop {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .pub-header__hamburger {
    display: none;
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px;
    color: var(--pub-text-primary);
  }
  .pub-header__mobile-overlay {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--pub-bg-primary);
    border-bottom: 1px solid var(--pub-border-light);
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.08);
  }
  @media (min-width: 769px) {
    .pub-header__hamburger { display: none; }
    .pub-header__mobile-overlay { display: none; }
  }
  /* Between the mobile breakpoint and tablet width the full nav plus actions
     is wider than the viewport; a tighter nav gap keeps the bar inside it. */
  @media (min-width: 769px) and (max-width: 1024px) {
    .pub-header__nav-desktop { gap: 16px; }
  }
  @media (max-width: 768px) {
    .pub-header__nav-desktop { display: none; }
    .pub-header__actions-desktop { display: none; }
    .pub-header__hamburger { display: flex; }
  }
`;

function scrollToSection(anchorId: string) {
  history.pushState(null, '', `#${anchorId}`);
  document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
}

function MenuIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function HeaderLogo() {
  return (
    <a
      href="#/"
      onClick={(e) => {
        e.preventDefault();
        window.location.hash = '#/';
      }}
      aria-label="Meetropolis"
      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
    >
      <img src="/logo.png" alt="" width={36} height={36} style={{ display: 'block', objectFit: 'contain' }} />
      <span className="pub-wordmark" style={{ fontSize: 16 }}>
        Meetropolis
      </span>
    </a>
  );
}

function DesktopNav({ t }: { t: (k: string) => string }) {
  return (
    <nav className="pub-header__nav-desktop">
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
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--pub-text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--pub-text-secondary)')}
        >
          {t(item.i18nKey)}
        </a>
      ))}
    </nav>
  );
}

function DesktopActions({
  t,
  onLogin,
  onSignup,
  registrationEnabled,
}: {
  t: (k: string) => string;
  onLogin: () => void;
  onSignup: () => void;
  registrationEnabled: boolean;
}) {
  return (
    <div className="pub-header__actions-desktop">
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
      {registrationEnabled && (
        <PubButton variant="primary" size="sm" onClick={onSignup}>
          {t('header.trialCta')}
        </PubButton>
      )}
    </div>
  );
}

function MobileOverlay({
  t,
  onLogin,
  onSignup,
  registrationEnabled,
  onClose,
}: {
  t: (k: string) => string;
  onLogin: () => void;
  onSignup: () => void;
  registrationEnabled: boolean;
  onClose: () => void;
}) {
  return (
    <div className="pub-header__mobile-overlay">
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
            onClose();
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
            onClose();
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
        {registrationEnabled && (
          <PubButton
            variant="primary"
            onClick={() => {
              onClose();
              onSignup();
            }}
            style={{ width: '100%' }}
          >
            {t('header.trialCta')}
          </PubButton>
        )}
      </div>
    </div>
  );
}

export function PublicHeader({ onLogin, onSignup, registrationEnabled = true }: PublicHeaderProps) {
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
      <div className="pub-header__bar">
        <HeaderLogo />
        <DesktopNav t={t} />
        <DesktopActions t={t} onLogin={onLogin} onSignup={onSignup} registrationEnabled={registrationEnabled} />
        <button
          className="pub-header__hamburger"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>
      {menuOpen && (
        <MobileOverlay
          t={t}
          onLogin={onLogin}
          onSignup={onSignup}
          registrationEnabled={registrationEnabled}
          onClose={() => setMenuOpen(false)}
        />
      )}
      <style>{HEADER_RESPONSIVE_STYLES}</style>
    </header>
  );
}
