import React from 'react';
import { getBrandModule } from '../../lib/brandLoader';

type BrandLogoProps = { size?: number; className?: string; alt?: string; src?: string };
type BrandWordmarkProps = { height?: number; src?: string; renderFallback?: () => React.ReactNode };

const OssBrandLogoFallback: React.ComponentType<BrandLogoProps> = ({ size = 32 }) => (
  <div
    aria-hidden
    style={{
      width: size,
      height: size,
      borderRadius: 6,
      background: 'var(--accent, #2dd4bf)',
      display: 'inline-block',
    }}
  />
);

const OssBrandWordmarkFallback: React.ComponentType<BrandWordmarkProps> = ({ renderFallback }) => (
  <>{renderFallback ? renderFallback() : <div style={{ fontWeight: 800, letterSpacing: 0.3 }}>Workspace</div>}</>
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
      <header style={{ minHeight: 56, padding: '10px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 40, background: 'linear-gradient(180deg, rgba(0,0,0,0.06), transparent 70%)', backdropFilter: 'saturate(1.1) blur(2px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <React.Suspense fallback={<OssBrandLogoFallback size={32} />}>
              <BrandLogoLazy size={32} />
            </React.Suspense>
            <React.Suspense fallback={<OssBrandWordmarkFallback />}>
              <BrandWordmarkLazy height={18} renderFallback={() => (
                <div style={{ fontWeight: 800, letterSpacing: 0.3 }}>Workspace</div>
              )} />
            </React.Suspense>
            {props.title && (
              <div style={{ marginLeft: 8, padding: '4px 8px', borderRadius: '999px', background: 'var(--glass)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-subtle)' }}>{props.title}</div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{props.right}</div>
        </div>
      </header>
      <main style={{ padding: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          {props.children}
        </div>
      </main>
    </div>
  );
}
