import React from 'react';

type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider(props: { mode?: ThemeMode; children: React.ReactNode }) {
  const preferred: ThemeMode = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  const initial = (typeof window !== 'undefined' ? (localStorage.getItem('ui:theme') as ThemeMode | null) : null) || props.mode || preferred;
  const [mode, setModeState] = React.useState<ThemeMode>(initial);
  const setMode = React.useCallback((m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem('ui:theme', m); } catch {}
  }, []);
  const toggle = React.useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  const themeVars = getCssVariables(mode);

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle }}>
      <div data-theme={mode} style={{ background: 'var(--bg)', color: 'var(--fg)', minHeight: '100%', width: '100%' }}>
        <style>{themeVars}</style>
        {props.children}
      </div>
    </ThemeContext.Provider>
  );
}

function getCssVariables(mode: ThemeMode): string {
  const isLight = mode === 'light';
  // Brandfarben
  const brandPrimary = '#450db3';
  const brandAccent = '#f3a814';
  // Paletten
  const bg = isLight ? '#f6f7fb' : '#0f1115';
  const fg = isLight ? '#0f1115' : '#e5e7eb';
  const subtle = isLight ? '#6b7280' : '#9ca3af';
  const border = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
  // Darkmode zurück auf bisherigen Look (dunkel, dezentes Glas)
  const glass = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.06)';
  const glassHover = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.10)';
  const shadow = isLight ? '0 12px 30px rgba(0,0,0,0.14)' : '0 12px 30px rgba(0,0,0,0.35)';
  const modalBg = isLight ? 'rgba(17,17,20,0.98)' : 'rgba(17,17,20,0.98)';
  const modalFg = isLight ? '#e5e7eb' : '#e5e7eb';
  const panelBg = isLight ? 'rgba(17,17,20,0.92)' : 'rgba(17,17,20,0.92)';
  const panelFg = isLight ? '#e5e7eb' : fg;
  const chipBg = isLight ? 'rgba(17,17,20,0.70)' : 'rgba(17,17,20,0.70)';
  const barBg = isLight ? 'rgba(17,17,20,0.92)' : 'rgba(17,17,20,0.85)';
  const barFg = '#e5e7eb';
  const barChipBg = isLight ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.06)';
  const barDivider = isLight ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.12)';
  const focus = isLight ? 'rgba(69,13,179,0.45)' : 'rgba(243,168,20,0.45)';

  return `
    [data-theme] {
      --brand-primary: ${brandPrimary};
      --brand-accent: ${brandAccent};
      --bg: ${bg};
      --fg: ${fg};
      --fg-subtle: ${subtle};
      --border: ${border};
      --glass: ${glass};
      --glass-hover: ${glassHover};
      --shadow: ${shadow};
      --focus: ${focus};
      --modal-bg: ${modalBg};
      --modal-fg: ${modalFg};
      --panel-bg: ${panelBg};
      --panel-fg: ${panelFg};
      --chip-bg: ${chipBg};
      --bar-bg: ${barBg};
      --bar-fg: ${barFg};
      --bar-chip-bg: ${barChipBg};
      --bar-divider: ${barDivider};
      --radius: 14px;
      --radius-sm: 10px;
      --radius-xs: 8px;
      --gradient: linear-gradient(135deg, ${brandPrimary} 0%, ${brandAccent} 100%);
    }

    .glass-surface {
      background: var(--glass);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      backdrop-filter: blur(10px);
      box-shadow: var(--shadow);
    }
    .brand-border {
      border-image: linear-gradient(135deg, ${brandPrimary}, ${brandAccent}) 1;
    }

    .btn-text-color { color:var(--fg); }
  `;
}

export function AppShell(props: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', minHeight: '100vh', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 40, background: 'linear-gradient(180deg, rgba(0,0,0,0.12), transparent 60%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
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
      <main style={{ padding: 16 }}>{props.children}</main>
    </div>
  );
}

export function ThemeToggleButton() {
  const { mode, toggle } = useTheme();
  return (
    <button onClick={toggle} title={mode === 'dark' ? 'Zu Hell wechseln' : 'Zu Dunkel wechseln'} style={{
      padding: '8px 10px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer'
    }}>
      {mode === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}


