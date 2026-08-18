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

// Every rule the media queries need to override lives here, not in an inline
// `style` prop: an inline declaration wins over any stylesheet rule that is not
// `!important`, which is why the previous mobile block (`display: none` on the
// branding children) never took effect. `box-sizing` is set explicitly on the
// panels because this app has no global border-box reset — with the default
// content-box, `width: 100%` plus horizontal padding overflowed the viewport.
const AUTH_LAYOUT_STYLES = `
  .pub-auth-layout {
    display: flex;
    flex-direction: row;
    min-height: 100vh;
  }
  /* border-box means the width now covers the horizontal padding too, so the
     declared values carry it: 672 = 560 content + 2x56 padding (and 520 = 440
     + 2x40 in the tablet block below). The rendered panel is unchanged. */
  .pub-auth-layout__branding {
    box-sizing: border-box;
    width: 672px;
    flex-shrink: 0;
    background: var(--pub-gradient-auth-panel);
    padding: 48px 56px;
    display: flex;
    flex-direction: column;
    gap: 32px;
  }
  .pub-auth-layout__form {
    box-sizing: border-box;
    flex: 1;
    min-width: 0;
    background: var(--pub-bg-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 64px 80px;
  }
  .pub-auth-layout__form-inner {
    box-sizing: border-box;
    width: 100%;
    max-width: 480px;
    /* Counterpart to the branding side: a work e-mail echoed back on the reset
       screen is one unbroken run, and browsers only break at a hyphen, never at
       a dot or an at-sign. Without this a 43-character address already leaves
       the column. */
    overflow-wrap: anywhere;
    /* German compounds are long and the form column is the narrow one, so a
       word that does not fit would otherwise be cut wherever the line happens
       to end (Firmenangabe / n). Hyphenation gives the break a proper place and
       a visible hyphen, and unlike a wider minimum it costs no layout width at
       all. It follows the lang attribute of the document, which
       AppRoutes.useDocumentLang keeps in sync with i18next - without that the
       browser would hyphenate English text by German rules. -webkit-hyphens is
       not optional here: the desktop client renders in WKWebView. */
    -webkit-hyphens: auto;
    hyphens: auto;
  }
  .pub-auth-layout__logo {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: inherit;
  }
  .pub-auth-layout__logo-mark {
    display: block;
    object-fit: contain;
    flex-shrink: 0;
  }
  .pub-auth-layout__center {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 24px;
  }
  .pub-auth-layout__headline {
    font-family: var(--pub-font-display);
    font-weight: 800;
    font-size: 32px;
    line-height: 1.2;
    color: #ffffff;
    margin: 0;
    overflow-wrap: break-word;
  }
  .pub-auth-layout__subline {
    font-family: var(--pub-font-body);
    font-size: 16px;
    line-height: 1.6;
    color: rgba(255, 255, 255, 0.75);
    margin: 0;
    overflow-wrap: break-word;
  }
  .pub-auth-layout__hero {
    width: 100%;
    max-width: 440px;
    height: auto;
    border-radius: var(--pub-radius-image);
    object-fit: cover;
  }
  .pub-auth-layout__footer {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .pub-auth-layout__trust-item {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pub-auth-layout__trust-check {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: rgba(20, 184, 166, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .pub-auth-layout__trust-label,
  .pub-auth-layout__link {
    font-family: var(--pub-font-body);
    font-size: 14px;
    color: rgba(255, 255, 255, 0.85);
    /* The panel is no longer a fixed 520px in the tablet band - it gives way
       down to 369px - so the labels next to it need the same guard the links
       already had. Today's strings leave 82px of headroom; a longer one in a
       future brand catalogue would push the row out of its box without this. */
    overflow-wrap: anywhere;
  }
  .pub-auth-layout__link {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
  }
  .pub-auth-layout__link svg {
    flex-shrink: 0;
  }
  /* Both two-column branches: the branding panel is the one that gives way.
     A rigid panel next to a form column that may shrink to nothing pins the
     form to viewport minus panel, and its content then leaves the column: at
     769px the four-step registration indicator (a fixed 272px of circles and
     connectors) ran past the edge, and between 1025 and 1103px the wizard
     buttons broke letter by letter. Restoring the form's content floor is what
     a flex item does by default, so wherever the viewport is wide enough for
     both columns nothing moves; only where the panel used to force an overflow
     does it now shrink instead. The floor is scoped to the two-column range on
     purpose - in the single-column branch below, an intrinsic floor could push
     the page wider than the phone, and flex-shrink would act on the height. */
  @media (min-width: 769px) {
    .pub-auth-layout__branding { flex-shrink: 1; min-width: 0; }
    .pub-auth-layout__form { min-width: min-content; }
    /* A floor for the text column. The wrap rule above collapses the intrinsic
       minimum of every text to a single character, and hyphenation only saves
       what the language has a break point for: measured without this floor, the
       English labels Back and Create are cut into single letters at 1025px.
       220px is the widest single word across all ten views (the German login
       headline) and at the same time the width the desktop layout has always
       given the form at its narrowest healthy viewport, 1052px. */
    .pub-auth-layout__form-inner { min-width: 220px; }
  }
  @media (min-width: 769px) and (max-width: 1024px) {
    /* The tablet band can afford more than the bare word width: the panel has
       520px to give, and 320px is what keeps the form comfortable at 769px
       (where it was down to 169px before the floor existed). */
    .pub-auth-layout__form-inner { min-width: 320px; }
  }
  @media (max-width: 1024px) {
    .pub-auth-layout__branding { width: 520px; padding: 40px 40px; }
    .pub-auth-layout__form { padding: 48px 40px; }
  }
  @media (max-width: 768px) {
    .pub-auth-layout { flex-direction: column; }
    /* Compact brand band: logo plus headline, sized by its content. The panel
       used to be a fixed 200px with overflow:hidden, which is what cut the
       marketing copy off mid-sentence — an auto height cannot clip. */
    .pub-auth-layout__branding {
      width: 100%;
      padding: 20px 24px;
      gap: 12px;
    }
    .pub-auth-layout__center { flex: 0 0 auto; gap: 0; }
    .pub-auth-layout__headline { font-size: 22px; }
    .pub-auth-layout__subline,
    .pub-auth-layout__hero,
    .pub-auth-layout__footer--trust { display: none; }
    /* The trust checks are marketing and can go on a phone. The OSS variant of
       the same slot carries the only links to the project and its source on the
       whole auth screen — there is no other footer here — so it stays and just
       packs tighter: one row where the width allows, wrapped where it does not. */
    .pub-auth-layout__footer--links {
      flex-direction: row;
      flex-wrap: wrap;
      gap: 6px 16px;
    }
    .pub-auth-layout__footer--links .pub-auth-layout__link { font-size: 13px; gap: 6px; }
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
      className="pub-auth-layout__logo"
    >
      <img src="/logo.png" alt="" width={36} height={36} className="pub-auth-layout__logo-mark" />
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
    <div className="pub-auth-layout__center">
      <h1 className="pub-auth-layout__headline">{t('auth.brandingHeadline')}</h1>
      <p className="pub-auth-layout__subline">{t('auth.brandingSubline')}</p>
      {heroSrc && <img className="pub-auth-layout__hero" src={heroSrc} alt={heroAlt} />}
    </div>
  );
}

function AuthTrustChecks({ t }: { t: (k: string) => string }) {
  return (
    <div className="pub-auth-layout__footer pub-auth-layout__footer--trust">
      {TRUST_KEYS.map((key) => (
        <div key={key} className="pub-auth-layout__trust-item">
          <div className="pub-auth-layout__trust-check">
            <CheckIcon size={12} color="#14B8A6" />
          </div>
          <span className="pub-auth-layout__trust-label">{t(key)}</span>
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
    <div className="pub-auth-layout__footer pub-auth-layout__footer--links">
      {ITEMS.map((item) => (
        <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className="pub-auth-layout__link">
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
