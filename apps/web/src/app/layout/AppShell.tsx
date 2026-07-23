import React from 'react';
import { getBrandModule } from '../../lib/brandLoader';

type BrandLogoProps = { size?: number; className?: string; alt?: string; src?: string };
type BrandWordmarkProps = { height?: number; src?: string; renderFallback?: () => React.ReactNode };

/**
 * OSS builds carry the Meetropolis brand too — self-hosting doesn't mean an
 * unbranded app. Both fallbacks render the real mark: the pixel-figure icon
 * (`/logo.png`, a real OSS public asset) and the "MEETROPOLIS" wordmark in
 * Press Start 2P (`.pub-wordmark`). The Tiamat build swaps in the loader's
 * BrandLogo/BrandWordmark, which render the identical assets.
 */
const OssBrandLogoFallback: React.ComponentType<BrandLogoProps> = ({ size = 32, alt = 'Meetropolis' }) => (
  <img src="/logo.png" alt={alt} width={size} height={size} style={{ display: 'inline-block', objectFit: 'contain' }} />
);

const OssBrandWordmarkFallback: React.ComponentType<BrandWordmarkProps> = ({ height = 18 }) => (
  <span className="pub-wordmark" style={{ fontSize: Math.round(height * 0.9), display: 'inline-block' }}>
    Meetropolis
  </span>
);

const BrandLogoLazy = React.lazy<React.ComponentType<BrandLogoProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: OssBrandLogoFallback };
  return { default: mod.BrandLogo };
});

const BrandWordmarkLazy = React.lazy<React.ComponentType<BrandWordmarkProps>>(async () => {
  const mod = await getBrandModule();
  if (!mod) return { default: OssBrandWordmarkFallback };
  return { default: mod.BrandWordmark };
});

export function AppShell(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header
        style={{
          minHeight: 56,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.06), transparent 70%)',
          backdropFilter: 'saturate(1.1) blur(2px)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            maxWidth: 1200,
            margin: '0 auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <React.Suspense fallback={<OssBrandLogoFallback size={32} />}>
              <BrandLogoLazy size={32} />
            </React.Suspense>
            <React.Suspense fallback={<OssBrandWordmarkFallback height={18} />}>
              <BrandWordmarkLazy height={18} />
            </React.Suspense>
            {props.title && (
              <div
                style={{
                  marginLeft: 8,
                  padding: '4px 8px',
                  borderRadius: '999px',
                  background: 'var(--glass)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  color: 'var(--fg-subtle)',
                }}
              >
                {props.title}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{props.right}</div>
        </div>
      </header>
      <main style={{ padding: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>{props.children}</div>
      </main>
    </div>
  );
}
