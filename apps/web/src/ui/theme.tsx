import React from 'react';
import { ButtonGroup } from './buttonGroup/ButtonGroup';
import { BGButton as Button } from './buttonGroup/Button';

type ThemeMode = 'light' | 'dark';
type ThemeOverride = 'system' | ThemeMode;

type ThemeContextValue = {
  override: ThemeOverride;
  setOverride: (o: ThemeOverride) => void;
  effective: ThemeMode;
  cycle: () => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider(props: { children: React.ReactNode }) {
  const getSystem = () => (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  const [override, setOverride] = React.useState<ThemeOverride>(() => {
    if (typeof window === 'undefined') return 'system';
    const saved = localStorage.getItem('ui:theme:override') as ThemeOverride | null;
    return saved || 'system';
  });
  const [system, setSystem] = React.useState<ThemeMode>(getSystem());

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setSystem(mq.matches ? 'light' : 'dark');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const effective: ThemeMode = override === 'system' ? system : override;

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (override === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', override);
    }
    try { localStorage.setItem('ui:theme:override', override); } catch {}
  }, [override]);

  const cycle = React.useCallback(() => {
    setOverride((o: ThemeOverride) => o === 'system' ? 'light' : o === 'light' ? 'dark' : 'system');
  }, []);

  return (
    <ThemeContext.Provider value={{ override, setOverride, effective, cycle }}>
      <div style={{ background: 'var(--bg)', color: 'var(--fg)', minHeight: '100%', width: '100%' }}>
        {props.children}
      </div>
    </ThemeContext.Provider>
  );
}

// CSS-Variablen sind nun in apps/web/src/styles/theme.css definiert.

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
  const { override, setOverride, cycle, effective } = useTheme();
  return (
    <ButtonGroup size="sm">
      <Button
        icon="sun"
        iconPosition="only"
        active={override === 'light'}
        title="Helles Design"
        onClick={() => setOverride('light')}
      />
      <Button
        icon="moon"
        iconPosition="only"
        active={override === 'dark'}
        title="Dunkles Design"
        onClick={() => setOverride('dark')}
      />
      <Button
        icon="desktop"
        iconPosition="only"
        active={override === 'system'}
        title="Systemeinstellung"
        onClick={() => setOverride('system')}
      />
    </ButtonGroup>
  );
}


