import React from 'react';
import { Card, Input, Button } from '../../ui/system';
import { ThemeToggleButton } from '../../ui/theme';

export function AuthScreen(props: { baseUrl: string; onDone: () => void }) {
  const { baseUrl, onDone } = props;
  const [view, setView] = React.useState<'login'|'register'|'forgot'|'reset'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [invite, setInvite] = React.useState('');
  const [token, setToken] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);

  async function post(path: string, body: any) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json())?.error || 'Fehler');
    return await res.json().catch(() => ({}));
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/auth/login', { email, password });
      onDone();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/auth/register', { code: invite, name, email, password });
      onDone();
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      const r = await post('/auth/forgot', { email });
      setMsg(`Reset-Token (Debug): ${r.token || 'per Mail'}`);
      setView('reset');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await post('/auth/reset', { token, password });
      setView('login');
      setMsg('Passwort aktualisiert');
    } catch (e: any) {
      setMsg(e.message);
    }
  }

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 16, width: '100%' };

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
          <div style={{ fontSize: 16, color: 'var(--muted)' }}>Dein virtueller Arbeitsplatz</div>
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
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--fg)' }}>Willkommen zurück</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label htmlFor="login-email" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  id="login-email"
                  name="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="login-password" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Passwort</label>
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
              Einloggen
            </Button>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize: 13, color:'var(--muted)' }}>
              <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none' }} onClick={()=>setView('forgot')}>Passwort vergessen?</a>
              <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none' }} onClick={()=>setView('register')}>Einladung einlösen</a>
            </div>
          </form>
        )}
        {view === 'register' && (
          <form onSubmit={handleRegisterSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--fg)' }}>Registrierung</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <label htmlFor="reg-code" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Einladungscode</label>
                <Input 
                  id="reg-code"
                  name="code"
                  placeholder="Code eingeben" 
                  value={invite} 
                  onChange={e=>setInvite(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-name" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Name (optional)</label>
                <Input 
                  id="reg-name"
                  name="name"
                  placeholder="Max Mustermann" 
                  value={name} 
                  onChange={e=>setName(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-email" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  id="reg-email"
                  name="email"
                  inputMode="email"
                  autoComplete="username"
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ fontSize: 14 }}
                />
              </div>
              <div>
                <label htmlFor="reg-password" style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Passwort</label>
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
              Registrieren
            </Button>
            <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none', fontSize: 13, textAlign: 'center' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </form>
        )}
        {view === 'forgot' && (
          <form onSubmit={handleForgotSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h3 style={{ margin: 0 }}>Passwort vergessen</h3>
            <Input id="forgot-email" name="email" inputMode="email" autoComplete="email" placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <Button type="submit" variant="primary">Zurücksetzen anfordern</Button>
            <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </form>
        )}
        {view === 'reset' && (
          <form onSubmit={handleResetSubmit} autoComplete="on" style={{ display: 'contents' }}>
            <h3 style={{ margin: 0 }}>Passwort zurücksetzen</h3>
            <Input id="reset-token" name="token" placeholder="Reset-Token" value={token} onChange={e=>setToken(e.target.value)} />
            <Input id="reset-password" name="password" placeholder="Neues Passwort" type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button type="submit" variant="primary">Passwort speichern</Button>
            <a style={{ cursor:'pointer', color: 'var(--brand-primary)', textDecoration: 'none' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </form>
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


