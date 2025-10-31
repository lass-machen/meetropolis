import React from 'react';
import { Toolbar, Button, Card, Input, Modal } from '../../ui/components';

export function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<{ id: string; email: string; name?: string; createdAt?: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      const list = await res.json();
      setUsers(list);
    } catch (e: any) {
      setError(e.message || 'Fehler');
    } finally {
      setLoading(false);
    }
  }

  async function save(u: { id: string; email: string; name?: string }) {
    try {
      const res = await fetch(`${baseUrl}/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: u.email, name: u.name }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Update fehlgeschlagen');
      await load();
      setEdit(null);
    } catch (e: any) {
      setError(e.message || 'Fehler');
    }
  }

  async function remove(id: string) {
    if (!confirm('Benutzer wirklich löschen?')) return;
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json())?.error || 'Löschen fehlgeschlagen');
      await load();
    } catch (e: any) {
      setError(e.message || 'Fehler');
    }
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => {
    (document as any).__userManagementLoad = load;
    return () => { delete (document as any).__userManagementLoad; };
  }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 20, padding: '20px' }}>
      <Toolbar
        left={<>
          <Button onClick={onBack} style={{ 
            background: 'rgba(255,255,255,0.05)', 
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '8px 16px',
            borderRadius: 8
          }}>
            ← Zurück
          </Button>
          <div style={{ 
            padding: '6px 12px', 
            borderRadius: 20, 
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', 
            fontSize: 12, 
            color: '#fff',
            fontWeight: 600
          }}>
            Admin
          </div>
        </>}
        right={<>
          <Button 
            variant="primary" 
            onClick={() => { setInviteCode(null); setNewEmail(''); setNewName(''); setCreateOpen(true); }}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontWeight: 600
            }}
          >
            + Neuer Benutzer
          </Button>
        </>}
        style={{ 
          background: 'transparent',
          border: 'none',
          padding: 0
        }}
      />

      {error && (
        <Card style={{ 
          background: 'rgba(239,68,68,0.1)', 
          border: '1px solid rgba(239,68,68,0.3)'
        }}>
          <div style={{ color: '#fca5a5' }}>{error}</div>
        </Card>
      )}
      {loading ? (
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center',
          padding: 40
        }}>
          <div style={{ color: 'rgba(255,255,255,0.6)' }}>Lade Benutzerdaten...</div>
        </Card>
      ) : (
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: 0,
          overflow: 'hidden'
        }}>
          <div style={{ display: 'grid', gap: 0 }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
              gap: 16, 
              padding: '16px 24px', 
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontWeight: 600, 
              color: 'rgba(255,255,255,0.7)',
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              <div>E-Mail</div>
              <div>Name</div>
              <div>Aktionen</div>
            </div>
            {users.map(u => (
              <div key={u.id} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
                gap: 16, 
                padding: '16px 24px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                transition: 'background 0.2s',
                background: edit?.id === u.id ? 'rgba(59,130,246,0.1)' : 'transparent'
              }}>
                {edit?.id === u.id ? (
                  <>
                    <Input 
                      value={edit.email} 
                      onChange={e => setEdit({ ...(edit as any), email: e.target.value })}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        padding: '8px 12px',
                        fontSize: 14
                      }}
                    />
                    <Input 
                      value={edit.name ?? ''} 
                      onChange={e => setEdit({ ...(edit as any), name: e.target.value })}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        padding: '8px 12px',
                        fontSize: 14
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        variant="primary" 
                        onClick={() => save(edit!)}
                        style={{
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          border: 'none',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        ✓
                      </Button>
                      <Button 
                        onClick={() => setEdit(null)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', color: '#fff', fontSize: 14 }}>{u.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', color: u.name ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 14 }}>{u.name ?? '—'}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '' })}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        Bearbeiten
                      </Button>
                      <Button 
                        variant="danger" 
                        onClick={() => remove(u.id)}
                        style={{
                          background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.3)',
                          color: '#f87171',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        Löschen
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                color: 'rgba(255,255,255,0.4)' 
              }}>
                Keine Benutzer vorhanden
              </div>
            )}
          </div>
        </Card>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neuen Benutzer einladen" maxWidth={520} footer={<>
        <Button onClick={() => setCreateOpen(false)}>Abbrechen</Button>
        <Button variant="primary" onClick={async () => {
          setError(null);
          try {
            const res = await fetch(`${baseUrl}/auth/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: newEmail, name: newName || undefined }) });
            if (!res.ok) throw new Error((await res.json())?.error || 'Fehler beim Einladen');
            const data = await res.json();
            setInviteCode(data.code || null);
            try { await (document as any).__userManagementLoad?.(); } catch {}
          } catch (e: any) {
            setError(e.message || 'Fehler');
          }
        }}>Einladung erstellen</Button>
      </>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Input placeholder="E-Mail-Adresse" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <Input placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
          {inviteCode && <div className="glass-surface" style={{ padding: 10, borderRadius: 10, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
            <div>Einladungscode: <b>{inviteCode}</b></div>
            <Button onClick={() => { navigator.clipboard?.writeText(inviteCode); }}>Kopieren</Button>
          </div>}
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Der eingeladene Nutzer erhält einen Code. Mit diesem kann er sich selbst registrieren.</div>
        </div>
      </Modal>
    </div>
  );
}


