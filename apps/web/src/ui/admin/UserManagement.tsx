import React from 'react';
import { Toolbar, Button, Card, Input, Modal } from '../../ui/system';
import { useTranslation } from 'react-i18next';

export function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const { t } = useTranslation();
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
      if (!res.ok) throw new Error(t('common.error'));
      const list = await res.json();
      setUsers(list);
    } catch (e: any) {
      setError(e.message || t('common.error'));
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
    if (!confirm(t('admin.users.confirmDelete'))) return;
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json())?.error || t('common.error'));
      await load();
    } catch (e: any) {
      setError(e.message || t('common.error'));
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
          <Button onClick={onBack}>← {t('admin.users.back')}</Button>
          <div style={{ padding: '6px 12px', borderRadius: 20, background: 'var(--glass)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg)', fontWeight: 600 }}>
            {t('admin.users.adminBadge')}
          </div>
        </>}
        right={<>
          <Button 
            variant="brand" 
            onClick={() => { setInviteCode(null); setNewEmail(''); setNewName(''); setCreateOpen(true); }}
          >
            + {t('admin.users.newUser')}
          </Button>
        </>}
        style={{ background: 'transparent', border: 'none', padding: 0 }}
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
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'rgba(255,255,255,0.6)' }}>{t('admin.users.loading')}</div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gap: 0 }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
              gap: 16, 
              padding: '16px 24px', 
              background: 'var(--glass)',
              borderBottom: '1px solid var(--border)',
              fontWeight: 600, 
              color: 'var(--fg-subtle)',
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              <div>{t('admin.users.email')}</div>
              <div>{t('admin.users.name')}</div>
              <div>{t('admin.users.actions')}</div>
            </div>
            {users.map(u => (
              <div key={u.id} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
                gap: 16, 
                padding: '16px 24px',
                borderBottom: '1px solid var(--border)',
                transition: 'background 0.2s',
                background: edit?.id === u.id ? 'rgba(59,130,246,0.1)' : 'transparent'
              }}>
                {edit?.id === u.id ? (
                  <>
                    <Input 
                      value={edit.email} 
                      onChange={e => setEdit({ ...(edit as any), email: e.target.value })}
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    />
                    <Input 
                      value={edit.name ?? ''} 
                      onChange={e => setEdit({ ...(edit as any), name: e.target.value })}
                      style={{ padding: '8px 12px', fontSize: 14 }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        variant="brand" 
                        onClick={() => save(edit!)}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        ✓
                      </Button>
                      <Button 
                        onClick={() => setEdit(null)}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        ✕
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', color: 'var(--fg)', fontSize: 14 }}>{u.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', color: u.name ? 'var(--fg)' : 'var(--fg-subtle)', fontSize: 14 }}>{u.name ?? '—'}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '' })}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        {t('admin.users.edit')}
                      </Button>
                      <Button 
                        variant="danger" 
                        onClick={() => remove(u.id)}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        {t('admin.users.delete')}
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
                {t('admin.users.none')}
              </div>
            )}
          </div>
        </Card>
      )}

      <Modal zIndexBase={1100} open={createOpen} onOpenChange={(o)=> setCreateOpen(o)} title={t('admin.users.inviteTitle')} maxWidth={520} footer={<> 
        <Button onClick={() => setCreateOpen(false)}>{t('admin.users.cancel')}</Button>
        <Button variant="brand" onClick={async () => {
          setError(null);
          try {
            const res = await fetch(`${baseUrl}/auth/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: newEmail, name: newName || undefined }) });
            if (!res.ok) throw new Error((await res.json())?.error || t('common.error'));
            const data = await res.json();
            setInviteCode(data.code || null);
            try { await (document as any).__userManagementLoad?.(); } catch {}
          } catch (e: any) {
            setError(e.message || t('common.error'));
          }
        }}>{t('admin.users.createInvite')}</Button>
      </>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Input placeholder={t('admin.users.emailAddress')} value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <Input placeholder={t('admin.users.nameOptional')} value={newName} onChange={e => setNewName(e.target.value)} />
          {inviteCode && (
            <div className="glass-surface" style={{ padding: 12, borderRadius: 'var(--radius-sm)', display:'grid', gap: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteCode')}</div>
              <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
                <div style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, letterSpacing: '0.06em' }}>
                  {inviteCode}
                </div>
                <Button onClick={() => { navigator.clipboard?.writeText(inviteCode); }}>{t('admin.users.copy')}</Button>
              </div>
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteHint')}</div>
        </div>
      </Modal>
    </div>
  );
}


