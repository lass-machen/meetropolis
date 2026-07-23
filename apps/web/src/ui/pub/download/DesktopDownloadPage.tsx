import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubButton } from '../components/PubButton';

/**
 * Public desktop-download page.
 *
 * Fetches the enterprise `/desktop/latest` endpoint (which proxies the private
 * release repo so anonymous visitors never touch GitHub) and renders one card
 * per platform. The response is consumed generically: any installer format the
 * release CI starts producing (Linux, Windows ARM64, …) shows up automatically
 * without a frontend change. When the endpoint is absent (pure OSS build →
 * 503) the page degrades to a neutral "not available" state.
 */

type DesktopPlatform = 'macos' | 'windows' | 'linux' | 'unknown';
type DesktopArch = 'aarch64' | 'x64';
type DesktopPackageKind = 'dmg' | 'msi' | 'exe' | 'appimage' | 'deb' | 'rpm';

interface LatestAsset {
  platform: DesktopPlatform;
  arch: DesktopArch;
  kind: DesktopPackageKind;
  filename: string;
  url: string;
  size: number;
}

interface LatestResponse {
  version: string;
  date: string;
  notes: string;
  assets: LatestAsset[];
}

interface DesktopDownloadPageProps {
  apiBase: string;
  onLogin: () => void;
  onSignup: (tierKey?: string) => void;
  registrationEnabled: boolean;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'ready'; data: LatestResponse }
  | { status: 'unavailable' }
  | { status: 'error' };

// Cards are always shown in this order so the layout is stable; the detected
// platform is additionally highlighted and floated to the front.
const PLATFORM_ORDER: readonly Exclude<DesktopPlatform, 'unknown'>[] = ['macos', 'windows', 'linux'];

const KIND_WEIGHT: Record<DesktopPackageKind, number> = {
  exe: 0,
  dmg: 0,
  appimage: 0,
  deb: 1,
  rpm: 2,
  msi: 3,
};

function detectPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(ua)) return 'macos';
  if (/win/.test(ua)) return 'windows';
  if (/linux|x11|cros/.test(ua)) return 'linux';
  return 'unknown';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDate(iso: string, lang: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

function assetLabel(asset: LatestAsset, t: TFunction<'public'>): string {
  const archLabel =
    asset.arch === 'aarch64'
      ? asset.platform === 'macos'
        ? t('download.appleSilicon')
        : t('download.arm64')
      : asset.platform === 'macos'
        ? t('download.intel')
        : t('download.x64');
  if (asset.platform === 'macos') return archLabel;
  const kindLabels: Record<DesktopPackageKind, string> = {
    msi: 'MSI',
    exe: t('download.installer'),
    appimage: 'AppImage',
    deb: '.deb',
    rpm: '.rpm',
    dmg: 'DMG',
  };
  // Fall back gracefully if an older server omits the `kind` field.
  const kindLabel = kindLabels[asset.kind] ?? (asset.kind ? String(asset.kind).toUpperCase() : 'Download');
  return `${kindLabel} · ${archLabel}`;
}

function sortAssets(a: LatestAsset, b: LatestAsset): number {
  if (a.arch !== b.arch) {
    // macOS: every current Mac is Apple Silicon, so surface aarch64 as the
    // primary button (JS cannot reliably read the CPU arch, especially in
    // Safari). Windows/Linux keep x64 first as the common default.
    if (a.platform === 'macos') return a.arch === 'aarch64' ? -1 : 1;
    return a.arch === 'x64' ? -1 : 1;
  }
  return (KIND_WEIGHT[a.kind] ?? 0) - (KIND_WEIGHT[b.kind] ?? 0);
}

/** Minimal monochrome glyph per platform — deliberately generic (no vendor logos). */
function PlatformGlyph({ platform }: { platform: DesktopPlatform }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (platform === 'windows') {
    return (
      <svg {...common}>
        <path d="M3 5.5 10.5 4.3v7.2H3zM10.5 4.1 21 2.5v9H10.5zM3 12.5h7.5v7.2L3 18.5zM10.5 12.5H21v9l-10.5-1.6z" />
      </svg>
    );
  }
  if (platform === 'linux') {
    return (
      <svg {...common}>
        <path d="M9 3.5c-1.2 1-1.4 3-1 5 .3 1.4-.6 2.6-1.6 3.8C4.8 14 4 15.5 5 17c.8 1.2 2.3.6 3 1.6.5.8 0 1.9 1 2.4 1.3.6 3 .6 4.3 0 1-.5.5-1.6 1-2.4.7-1 2.2-.4 3-1.6 1-1.5.2-3-1.4-4.7-1-1.2-1.9-2.4-1.6-3.8.4-2 .2-4-1-5-.9-.7-2.9-.7-3.8 0Z" />
        <path d="M10 9h.01M14 9h.01" />
      </svg>
    );
  }
  // macOS / default: laptop glyph
  return (
    <svg {...common}>
      <rect x="4" y="4" width="16" height="11" rx="1.5" />
      <path d="M2 19h20M9 19l.5-2h5l.5 2" />
    </svg>
  );
}

function PlatformCard({
  platform,
  assets,
  apiBase,
  recommended,
  t,
}: {
  platform: Exclude<DesktopPlatform, 'unknown'>;
  assets: LatestAsset[];
  apiBase: string;
  recommended: boolean;
  t: TFunction<'public'>;
}) {
  const sorted = [...assets].sort(sortAssets);
  const hasAssets = sorted.length > 0;
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        padding: '32px 28px',
        borderRadius: 'var(--pub-radius-card)',
        background: 'var(--pub-bg-primary)',
        border: recommended ? '2px solid var(--pub-accent-purple)' : '1px solid var(--pub-border-light)',
        boxShadow: recommended ? '0 20px 60px rgba(139, 92, 246, 0.4)' : '0 10px 30px rgba(0, 0, 0, 0.35)',
        flex: '1 1 280px',
        minWidth: 260,
        maxWidth: 380,
      }}
    >
      {recommended && (
        <span
          style={{
            position: 'absolute',
            top: -12,
            left: 24,
            background: 'var(--pub-accent-purple)',
            color: '#fff',
            fontFamily: 'var(--pub-font-body)',
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 'var(--pub-radius-pill)',
          }}
        >
          {t('download.recommendedBadge')}
        </span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--pub-text-primary)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 48,
            height: 48,
            borderRadius: 'var(--pub-radius-icon)',
            background: 'var(--pub-bg-surface)',
          }}
        >
          <PlatformGlyph platform={platform} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 20, color: 'var(--pub-text-primary)' }}>{t(`download.${platform}`)}</h3>
          <p
            style={{ margin: 0, fontSize: 13, color: 'var(--pub-text-secondary)', fontFamily: 'var(--pub-font-body)' }}
          >
            {t(`download.${platform}Sub`)}
          </p>
        </div>
      </div>

      {hasAssets ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((asset, idx) => (
            <PubButton
              key={asset.filename}
              as="a"
              href={`${apiBase}${asset.url}`}
              // primary = filled purple; ghost = light-gray fill with dark text.
              // (NOT 'secondary', which is white-on-transparent for the dark hero
              // and would be invisible inside these white cards.)
              variant={idx === 0 ? 'primary' : 'ghost'}
              size="md"
              // Native anchor download; the proxy sets Content-Disposition.
            >
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  width: '100%',
                }}
              >
                <span>{assetLabel(asset, t)}</span>
                <span style={{ fontSize: 12, opacity: 0.75, fontFamily: 'var(--pub-font-body)' }}>
                  {formatBytes(asset.size)}
                </span>
              </span>
            </PubButton>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '16px 0',
            color: 'var(--pub-text-tertiary)',
            fontFamily: 'var(--pub-font-body)',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--pub-text-secondary)' }}>
            {t('download.comingSoon')}
          </span>
          <span style={{ fontSize: 13 }}>{t('download.comingSoonNote')}</span>
        </div>
      )}
    </div>
  );
}

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 520,
        margin: '0 auto',
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--pub-text-on-dark-secondary)',
        fontFamily: 'var(--pub-font-body)',
        fontSize: 16,
      }}
    >
      {children}
    </div>
  );
}

/** Centered hero header: title, subtitle and (once loaded) the version line. */
function DownloadHero({ t, language, state }: { t: TFunction; language: string; state: FetchState }) {
  return (
    <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 12px' }}>
      <h1
        style={{
          fontSize: 'clamp(32px, 5vw, 52px)',
          lineHeight: 1.15,
          margin: '0 0 16px',
          color: 'var(--pub-text-on-dark)',
        }}
      >
        {t('download.heroTitle')}
      </h1>
      <p
        style={{
          fontSize: 18,
          lineHeight: 1.6,
          color: 'var(--pub-text-on-dark-secondary)',
          fontFamily: 'var(--pub-font-body)',
          margin: 0,
        }}
      >
        {t('download.heroSubtitle')}
      </p>
      {state.status === 'ready' && (
        <p
          style={{
            marginTop: 16,
            fontSize: 14,
            color: 'rgba(255, 255, 255, 0.45)',
            fontFamily: 'var(--pub-font-body)',
          }}
        >
          {t('download.version', { version: state.data.version })}
          {formatDate(state.data.date, language) &&
            ` · ${t('download.released', { date: formatDate(state.data.date, language) })}`}
        </p>
      )}
    </div>
  );
}

export function DesktopDownloadPage({ apiBase, onLogin, onSignup, registrationEnabled }: DesktopDownloadPageProps) {
  const { t, i18n } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };
  const [state, setState] = React.useState<FetchState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = React.useState(0);
  const detected = React.useMemo(detectPlatform, []);

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetch(`${apiBase}/desktop/latest`, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 503 || res.status === 404) {
          setState({ status: 'unavailable' });
          return;
        }
        if (!res.ok) {
          setState({ status: 'error' });
          return;
        }
        const data = (await res.json()) as LatestResponse;
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, reloadKey]);

  const orderedPlatforms = React.useMemo(() => {
    const base = [...PLATFORM_ORDER];
    if (detected !== 'unknown') {
      const i = base.indexOf(detected);
      if (i > 0) {
        base.splice(i, 1);
        base.unshift(detected);
      }
    }
    return base;
  }, [detected]);

  return (
    <PublicLayout onLogin={onLogin} onSignup={onSignup} navigate={navigate} registrationEnabled={registrationEnabled}>
      <section
        style={{
          background: 'var(--pub-gradient-hero)',
          padding: 'var(--pub-section-padding)',
          minHeight: 'calc(100vh - 72px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 'var(--pub-content-width)', margin: '0 auto', width: '100%' }}>
          <DownloadHero t={t} language={i18n.language} state={state} />

          {state.status === 'loading' && <StatusMessage>{t('download.loading')}</StatusMessage>}
          {state.status === 'unavailable' && <StatusMessage>{t('download.unavailable')}</StatusMessage>}
          {state.status === 'error' && (
            <StatusMessage>
              <div style={{ marginBottom: 16 }}>{t('download.error')}</div>
              <PubButton variant="secondary" onClick={() => setReloadKey((k) => k + 1)}>
                {t('download.retry')}
              </PubButton>
            </StatusMessage>
          )}

          {state.status === 'ready' && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 24,
                  justifyContent: 'center',
                  alignItems: 'stretch',
                  marginTop: 40,
                }}
              >
                {orderedPlatforms.map((platform) => {
                  const platformAssets = state.data.assets.filter((a) => a.platform === platform);
                  return (
                    <PlatformCard
                      key={platform}
                      platform={platform}
                      assets={platformAssets}
                      apiBase={apiBase}
                      // Only highlight the detected platform when it actually has
                      // a build — otherwise the "recommended" ring would sit on a
                      // "coming soon" card.
                      recommended={platform === detected && platformAssets.length > 0}
                      t={t}
                    />
                  );
                })}
              </div>
              <p
                style={{
                  textAlign: 'center',
                  marginTop: 40,
                  fontSize: 13,
                  color: 'var(--pub-text-on-dark-secondary)',
                  fontFamily: 'var(--pub-font-body)',
                }}
              >
                {t('download.footnote')}
              </p>
            </>
          )}
        </div>
      </section>
    </PublicLayout>
  );
}
