import { useTranslation } from 'react-i18next';
import { useHasBrandModule } from '../../../lib/brandLoader';
import { GITHUB_REPO_LABEL, GITHUB_REPO_URL } from '../links';

function CheckIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

interface AuthLayoutProps {
  children: React.ReactNode;
}

const TRUST_KEYS = ['auth.trustTrial', 'auth.trustNoCreditCard', 'auth.trustCancelAnytime'] as const;

const AUTH_LAYOUT_STYLES = `
  .pub-auth-layout {
    display: flex;
    flex-direction: row;
    min-height: 100vh;
  }
  .pub-auth-layout__branding {
    width: 560px;
    flex-shrink: 0;
    background: var(--pub-gradient-auth-panel);
    padding: 48px 56px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .pub-auth-layout__form {
    flex: 1;
    background: var(--pub-bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 64px 80px;
  }
  .pub-auth-layout__form-inner {
    width: 100%;
    max-width: 480px;
  }
  @media (max-width: 1024px) {
    .pub-auth-layout__branding { width: 440px; padding: 40px 40px; }
    .pub-auth-layout__form { padding: 48px 40px; }
  }
  @media (max-width: 768px) {
    .pub-auth-layout { flex-direction: column; }
    .pub-auth-layout__branding {
      width: 100%; height: 200px; overflow: hidden; padding: 24px 24px;
      flex-direction: row; align-items: center; gap: 24px;
    }
    .pub-auth-layout__branding > div:nth-child(2) { display: none; }
    .pub-auth-layout__branding > div:last-child { display: none; }
    .pub-auth-layout__form { padding: 32px 24px; }
  }
`;

function AuthLogo() {
  return (
    <a
      href="#/"
      onClick={(e) => {
        e.preventDefault();
        window.location.hash = '#/';
      }}
      aria-label="Meetropolis"
      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}
    >
      <img src="/logo.png" alt="" width={36} height={36} style={{ display: 'block', objectFit: 'contain' }} />
      <span className="pub-wordmark pub-wordmark--white" style={{ fontSize: 16 }}>
        Meetropolis
      </span>
    </a>
  );
}

function AuthBrandingCenter({ t }: { t: (k: string) => string }) {
  // The auth hero image comes from the brand submodule. In the OSS build the path
  // is empty and the <img> element renders without an image (alt-text is preserved).
  const heroSrcRaw = t('auth.heroImageSrc');
  const heroSrc = heroSrcRaw && heroSrcRaw !== 'auth.heroImageSrc' ? heroSrcRaw : '';
  const brandRaw = t('header.brandName');
  const brandName = brandRaw && brandRaw !== 'header.brandName' ? brandRaw : 'Meetropolis';
  const heroAltRaw = t('auth.heroImageAlt');
  const heroAlt = heroAltRaw && heroAltRaw !== 'auth.heroImageAlt' ? heroAltRaw : brandName;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
      <h1
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 800,
          fontSize: 32,
          lineHeight: 1.2,
          color: '#FFFFFF',
          margin: 0,
        }}
      >
        {t('auth.brandingHeadline')}
      </h1>
      <p
        style={{
          fontFamily: 'var(--pub-font-body)',
          fontSize: 16,
          lineHeight: 1.6,
          color: 'rgba(255, 255, 255, 0.75)',
          margin: 0,
        }}
      >
        {t('auth.brandingSubline')}
      </p>
      {heroSrc && (
        <img
          src={heroSrc}
          alt={heroAlt}
          style={{
            width: '100%',
            maxWidth: 440,
            height: 'auto',
            borderRadius: 'var(--pub-radius-image)',
            objectFit: 'cover',
          }}
        />
      )}
    </div>
  );
}

function AuthTrustChecks({ t }: { t: (k: string) => string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {TRUST_KEYS.map((key) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              background: 'rgba(20, 184, 166, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <CheckIcon size={12} color="#14B8A6" />
          </div>
          <span style={{ fontFamily: 'var(--pub-font-body)', fontSize: 14, color: 'rgba(255, 255, 255, 0.85)' }}>
            {t(key)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ExternalLinkIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function OssProjectLinks() {
  const ITEMS: ReadonlyArray<{ href: string; label: string }> = [
    { href: 'https://meetropolis.me', label: 'meetropolis.me' },
    { href: GITHUB_REPO_URL, label: GITHUB_REPO_LABEL },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {ITEMS.map((item) => (
        <a
          key={item.href}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontFamily: 'var(--pub-font-body)',
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.85)',
            textDecoration: 'none',
          }}
        >
          <ExternalLinkIcon size={16} color="rgba(255, 255, 255, 0.6)" />
          <span>{item.label}</span>
        </a>
      ))}
    </div>
  );
}

function AuthBrandingFooter({ t }: { t: (k: string) => string }) {
  const { loading, hasBrand } = useHasBrandModule();
  if (loading) return null;
  if (hasBrand) return <AuthTrustChecks t={t} />;
  return <OssProjectLinks />;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { t } = useTranslation('public');
  return (
    <div className="pub-auth-layout">
      <div className="pub-auth-layout__branding">
        <AuthLogo />
        <AuthBrandingCenter t={t} />
        <AuthBrandingFooter t={t} />
      </div>
      <div className="pub-auth-layout__form">
        <div className="pub-auth-layout__form-inner">{children}</div>
      </div>
      <style>{AUTH_LAYOUT_STYLES}</style>
    </div>
  );
}
