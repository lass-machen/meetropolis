import React from 'react';

export function AppShell(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header style={{ minHeight: 56, padding: '10px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 40, background: 'linear-gradient(180deg, rgba(0,0,0,0.06), transparent 70%)', backdropFilter: 'saturate(1.1) blur(2px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--gradient)' }} />
            <div style={{ fontWeight: 800, letterSpacing: 0.3 }}>Meetropolis</div>
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


