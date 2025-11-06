import React from 'react';
import { ButtonGroup } from './buttonGroup/ButtonGroup';
import { BGButton as Button } from './buttonGroup/Button';
import { useTranslation } from 'react-i18next';

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
    if (typeof window.matchMedia !== 'function') return;
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

  const tr = (key: string, fallback: string) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
  return (
    <ThemeContext.Provider value={{ override, setOverride, effective, cycle }}>
      <div style={{ background: 'var(--bg)', color: 'var(--fg)', minHeight: '100%', width: '100%' }}>
        {props.children}
      </div>
    </ThemeContext.Provider>
  );
}

// CSS-Variablen sind nun in apps/web/src/styles/theme.css definiert.

export function ThemeToggleButton() {
  const { override, setOverride, cycle, effective } = useTheme();
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) => {
    const v = t(key);
    return v && v !== key ? v : fallback;
  };
  return (
    <ButtonGroup size="sm">
      <Button
        icon="sun"
        iconPosition="only"
        active={override === 'light'}
        title={tr('theme.light', 'Helles Design')}
        onClick={() => setOverride('light')}
      />
      <Button
        icon="moon"
        iconPosition="only"
        active={override === 'dark'}
        title={tr('theme.dark', 'Dunkles Design')}
        onClick={() => setOverride('dark')}
      />
      <Button
        icon="desktop"
        iconPosition="only"
        active={override === 'system'}
        title={tr('theme.system', 'Systemeinstellung')}
        onClick={() => setOverride('system')}
      />
    </ButtonGroup>
  );
}


