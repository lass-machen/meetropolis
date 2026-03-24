import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Input, Button } from '../../ui/system';
import { ThemeToggleButton } from '../../ui/theme';
import { getDesktopModule } from '../../lib/desktopLoader';
import { logger } from '../../lib/logger';
import { translateApiError } from '../../lib/apiErrors';

/** Store auth token for desktop clients (Tauri can't use cookies) */
async function storeDesktopAuthToken(token: string) {
  try {
    const desktop = await getDesktopModule();
    if (desktop) desktop.setDesktopAuthToken(token);
  } catch {}
}

export function AuthScreen(props: { baseUrl: string; onDone: () => void }) {
  const { baseUrl, onDone } = props;
  const { t } = useTranslation();
  const [view, setView] = React.useState<'login'|'register'|'reset'|'guest'>('login');
  const [guestLoading, setGuestLoading] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [invite, setInvite] = React.useState('');
  const [token, setToken] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);

  async function post(path: string, body: any) {
    const url = `${baseUrl}${path}`;
    logger.debug('[AuthScreen] POST to:', url);
    // Desktop-Clients (Tauri): x-tenant Header aus web_base extrahieren
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const webBase = (window as any).__MEETROPOLIS_WEB_BASE__ || '';
      if (webBase) {
        const hostname = new URL(webBase).hostname;
        const parts = hostname.split('.');
        if (parts.length >= 3) {
          headers['x-tenant'] = parts[0];
          logger.debug('[AuthScreen] Setting x-tenant header:', parts[0]);
        }
      }
    } catch {}
    let lastErr: any = null;
    const attempts = [200, 500, 1000];
    for (let i = 0; i < attempts.length; i++) {
      try {
        const res = await fetch(url, { method: 'POST', headers, credentials: 'include', body: JSON.stringify(body) });
        if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
        return await res.json().catch(() => ({}));
      } catch (e: unknown) {
        logger.warn('[AuthScreen] Fetch error:', (e as Error)?.message || String(e), 'URL:', url);
        lastErr = e;
        // Netzwerk-/Verbindungsfehler: kurzer Retry mit Backoff
        if (i < attempts.length - 1) {
          await new Promise((r) => setTimeout(r, attempts[i]));
          continue;
        }
        break;
      }
    }
    throw lastErr || new Error(t('common.networkError'));
  }
 
  // Debug-Auto-Login via Env-Flag
  React.useEffect(() => {
    try {
      const env: any = (import.meta as any).env || {};
      const enabled = String(env.VITE_DEBUG_AUTOLOGIN || '').toLowerCase() === 'true';
      const isProd = Boolean((import.meta as any).env?.PROD);
      if (!enabled) return;
      // Nur auf localhost erlauben, nicht im LAN
      const host = window.location.hostname;
      if (host !== 'localhost' && host !== '127.0.0.1') return;
      // Sicherheit: in PROD nur wenn explizit erlaubt
      if (isProd && String(env.VITE_DEBUG_AUTOLOGIN_ALLOW_PROD || '').toLowerCase() !== 'true') {
        return;
      }
      const autoEmail = env.VITE_DEBUG_AUTOLOGIN_EMAIL || 'admin@meetropolis.local';
      const autoPassword = env.VITE_DEBUG_AUTOLOGIN_PASSWORD || 'admin123';
      setEmail(autoEmail);
      setPassword(autoPassword);
      (async () => {
        try {
          await post('/auth/login', { email: autoEmail, password: autoPassword });
          onDone();
        } catch (e: unknown) {
          setMsg((e as Error)?.message || t('auth.autoLoginFailed'));
        }
      })();
    } catch {}
  }, []);
 
  // Detect guest magic-link token in URL hash
  React.useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith('#/guest?')) return;
    const params = new URLSearchParams(hash.slice('#/guest?'.length));
    const guestToken = params.get('token');
    if (!guestToken) return;
    setView('guest');
    setGuestLoading(true);
    (async () => {
      try {
        const result = await post('/auth/guest', { token: guestToken });
        if (result.token) {
          storeDesktopAuthToken(result.token);
        }
        // Clear hash to avoid re-triggering
        window.location.hash = '';
        onDone();
      } catch (e: unknown) {
        setGuestLoading(false);
        const errMsg = (e as Error)?.message || '';
        if (errMsg === 'guest_expired') {
          setMsg(t('auth.guestExpired'));
        } else if (errMsg === 'invalid_token') {
          setMsg(t('auth.guestInvalid'));
        } else {
          setMsg(errMsg || t('auth.guestFailed'));
        }
      }
    })();
  }, []);

  // Detect invite code in URL hash (e.g. /#/?invite=CODE)
  React.useEffect(() => {
    const hash = window.location.hash;
    // Parse query params from hash: could be #/?invite=CODE or #/app?invite=CODE etc.
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return;
    const params = new URLSearchParams(hash.slice(qIdx));
    const inviteCode = params.get('invite');
    if (!inviteCode) return;
    setView('register');
    setInvite(inviteCode);
    // Clean up URL - remove the invite param without triggering hashchange
    const hashPath = hash.slice(0, qIdx) || '#/';
    history.replaceState(null, '', hashPath);
  }, []);

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const result = await post('/auth/login', { email, password });
      // Store token for Tauri (returned by server for tauri:// origin)
      if (result.token) {
        storeDesktopAuthToken(result.token);
      }
      onDone();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const result = await post('/auth/register', { code: invite, name, email, password });
      // Store token for Tauri (returned by server for tauri:// origin)
      if (result.token) {
        storeDesktopAuthToken(result.token);
      }
      onDone();
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/auth/reset', { email, token, password });
      setView('login');
      setMsg(t('auth.passwordUpdated'));
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 16, width: '100%' };
  const linkStyle: React.CSSProperties = { cursor: 'pointer', color: 'color-mix(in oklab, var(--brand-primary), #ffffff 65%)', textDecoration: 'none' };

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'grid', 
      placeItems: 'center',
      background: 'linear-gradient(135deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 20% 50%, rgba(59,130,246,0.07) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(147,51,234,0.06) 0%, transparent 50%), radial-gradient(circle at 40% 20%, rgba(16,185,129,0.06) 0%, transparent 50%)',
      }} />
      
      <div style={{ 
        position: 'relative',
        width: '100%',
        maxWidth: 440,
        padding: '0 20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ 
            fontSize: 48, 
            fontWeight: 900,
            marginBottom: 8,
            letterSpacing: '-0.02em',
            lineHeight: 1.1
          }}>
            <span style={{
              display: 'inline-block',
              background: 'var(--gradient-hero)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent' as any
            }}>Meetropolis</span>
          </div>
          <div style={{ fontSize: 16, color: 'var(--muted)' }}>{t('auth.tagline')}</div>
        </div>
        
        <Card style={{ 
          padding: 24,
          position: 'relative'
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <ThemeToggleButton />
          </div>
          <div style={commonStyle}>
        {view === 'login' && (
          <form onSubmit={handleLoginSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--fg)' }}>{t('auth.login.title')}</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label htmlFor="login-email" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.email')}</label>
                <Input 
                  id="login-email"
                  name="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={t('auth.emailExample')} 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="login-password" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.password')}</label>
                <Input 
                  id="login-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••" 
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
            </div>
            <Button 
              type="submit"
              variant="brand" 
              style={{ 
                width: '100%', 
                padding: '12px 20px',
                fontSize: 15
              }}
            >
              {t('auth.login.submit')}
            </Button>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize: 13, color:'var(--muted)' }}>
              <a style={linkStyle} onClick={()=>setView('reset')}>{t('auth.forgotLink')}</a>
              <a style={linkStyle} onClick={()=>setView('register')}>{t('auth.inviteLink')}</a>
            </div>
          </form>
        )}
        {view === 'register' && (
          <form onSubmit={handleRegisterSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--fg)' }}>{t('auth.register.title')}</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label htmlFor="reg-code" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.inviteCode')}</label>
                <Input 
                  id="reg-code"
                  name="code"
                  placeholder={t('auth.invitePlaceholder')} 
                  value={invite} 
                  onChange={e=>setInvite(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-name" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.nameOptional')}</label>
                <Input 
                  id="reg-name"
                  name="name"
                  placeholder={t('auth.nameExample')} 
                  value={name} 
                  onChange={e=>setName(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-email" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.email')}</label>
                <Input 
                  id="reg-email"
                  name="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder={t('auth.emailExample')} 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-password" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>{t('auth.password')}</label>
                <Input 
                  id="reg-password"
                  name="password"
                  placeholder="••••••••" 
                  type="password" 
                  autoComplete="new-password"
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
            </div>
            <Button 
              type="submit"
              variant="brand" 
              style={{ 
                width: '100%', 
                padding: '12px 20px',
                fontSize: 15
              }}
            >
              {t('auth.register.submit')}
            </Button>
            <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none', fontSize: 13, textAlign: 'center' }} onClick={()=>setView('login')}>{t('auth.backToLogin')}</a>
          </form>
        )}
        {view === 'reset' && (
          <form onSubmit={handleResetSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h3 style={{ margin: 0 }}>{t('auth.reset.title')}</h3>
            <Input id="reset-email" name="email" inputMode="email" autoComplete="email" placeholder={t('auth.email')} value={email} onChange={e=>setEmail(e.target.value)} />
            <Input id="reset-token" name="token" placeholder={t('auth.reset.token')} value={token} onChange={e=>setToken(e.target.value)} />
            <Input id="reset-password" name="password" placeholder={t('auth.reset.newPassword')} type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button type="submit" variant="primary">{t('auth.reset.submit')}</Button>
            <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none' }} onClick={()=>setView('login')}>{t('auth.backToLogin')}</a>
          </form>
        )}
        {view === 'guest' && (
          <div style={{ display: 'contents' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--fg)' }}>{t('auth.guestTitle')}</h2>
            {guestLoading ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--muted)' }}>
                {t('auth.guestLoading')}
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <a
                  style={{ cursor: 'pointer', color: 'var(--brand-primary)', textDecoration: 'none', fontSize: 13 }}
                  onClick={() => { setView('login'); setMsg(null); }}
                >
                  {t('auth.backToLogin')}
                </a>
              </div>
            )}
          </div>
        )}
        {msg && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5',
            fontSize: 14,
            marginTop: 8
          }}>
            {msg}
          </div>
        )}
          </div>
        </Card>
      </div>
    </div>
  );
}

