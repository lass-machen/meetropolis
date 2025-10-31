import React from 'react';
import { Card, Input, Button } from '../../ui/components';
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

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 16, width: '100%' };

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'grid', 
      placeItems: 'center',
      background: 'linear-gradient(135deg, rgba(17,17,20,0.98) 0%, rgba(30,30,35,0.98) 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 20% 50%, rgba(59,130,246,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(147,51,234,0.08) 0%, transparent 50%), radial-gradient(circle at 40% 20%, rgba(16,185,129,0.08) 0%, transparent 50%)',
      }} />
      
      <div style={{ 
        position: 'relative',
        width: '100%',
        maxWidth: 440,
        padding: '0 20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ 
            fontSize: 48, 
            fontWeight: 900, 
            background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #34d399 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent' as any,
            marginBottom: 8,
            letterSpacing: '-0.02em'
          }}>
            Meetropolis
          </div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>Dein virtueller Arbeitsplatz</div>
        </div>
        
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: 32,
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          position: 'relative'
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <ThemeToggleButton />
          </div>
          <div style={commonStyle}>
        {view === 'login' && (
          <>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#fff' }}>Willkommen zurück</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Passwort</label>
                <Input 
                  placeholder="••••••••" 
                  type="password" 
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
            </div>
            <Button 
              variant="primary" 
              onClick={async()=>{ try{ await post('/auth/login',{email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}
              style={{ 
                width: '100%', 
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: 8
              }}
            >
              Einloggen
            </Button>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize: 13 }}>
              <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none' }} onClick={()=>setView('forgot')}>Passwort vergessen?</a>
              <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none' }} onClick={()=>setView('register')}>Einladung einlösen</a>
            </div>
          </>
        )}
        {view === 'register' && (
          <>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#fff' }}>Registrierung</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Einladungscode</label>
                <Input 
                  placeholder="Code eingeben" 
                  value={invite} 
                  onChange={e=>setInvite(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Name (optional)</label>
                <Input 
                  placeholder="Max Mustermann" 
                  value={name} 
                  onChange={e=>setName(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Passwort</label>
                <Input 
                  placeholder="••••••••" 
                  type="password" 
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
            </div>
            <Button 
              variant="primary" 
              onClick={async()=>{ try{ await post('/auth/register',{code:invite,name,email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}
              style={{ 
                width: '100%', 
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
                borderRadius: 8
              }}
            >
              Registrieren
            </Button>
            <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none', fontSize: 13, textAlign: 'center' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'forgot' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort vergessen</h3>
            <Input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ const r=await post('/auth/forgot',{email}); setMsg(`Reset-Token (Debug): ${r.token||'per Mail'}`); setView('reset'); } catch(e:any){ setMsg(e.message); } }}>Zurücksetzen anfordern</Button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'reset' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort zurücksetzen</h3>
            <Input placeholder="Reset-Token" value={token} onChange={e=>setToken(e.target.value)} />
            <Input placeholder="Neues Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ await post('/auth/reset',{token,password}); setView('login'); setMsg('Passwort aktualisiert'); } catch(e:any){ setMsg(e.message); } }}>Passwort speichern</Button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
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


