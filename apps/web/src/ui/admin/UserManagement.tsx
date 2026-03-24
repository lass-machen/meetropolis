import React from 'react';
import { Toolbar, Button, Card, Input, Modal, Tr, Td } from '../../ui/system';
import { AdminTable } from './AdminTable';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';
import { translateApiError } from '../../lib/apiErrors';

type Role = 'owner' | 'admin' | 'member';
type User = { id: string; email: string; name?: string; createdAt?: string; role?: Role };
type EditUser = { id: string; email: string; name?: string; role?: Role | undefined };

export function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const { t } = useTranslation();
  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<User[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<EditUser | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newRole, setNewRole] = React.useState<'admin' | 'member'>('member');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<{ id: string; email: string } | null>(null);
  const [resetToken, setResetToken] = React.useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = React.useState<Role | null>(null);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  // Prüfe ob aktueller User Owner oder Admin ist (kann Rollen ändern)
  const canChangeRoles = currentUserRole === 'owner' || currentUserRole === 'admin';
  // Nur Owner können beim Einladen die Rolle auswählen
  const isOwner = currentUserRole === 'owner';

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Lade aktuelle User-Info (für Rollenprüfung)
      const meRes = await fetch(`${baseUrl}/auth/me`, { credentials: 'include' });
      let meData: { id: string } | null = null;
      if (meRes.ok) {
        meData = await meRes.json();
        if (meData?.id) setCurrentUserId(meData.id);
      }
      
      const res = await fetch(`${baseUrl}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error(t('common.error'));
      const list = await res.json();
      setUsers(list);
      
      // Finde eigene Rolle aus der User-Liste
      const myId = meData?.id || currentUserId;
      if (myId) {
        const myUser = list.find((u: User) => u.id === myId);
        if (myUser?.role) setCurrentUserRole(myUser.role);
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(userId: string, newRole: 'admin' | 'member') {
    try {
      setError(null);
      const res = await fetch(`${baseUrl}/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole })
      });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  }

  async function save(u: EditUser) {
    try {
      // Speichere Email/Name
      const res = await fetch(`${baseUrl}/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: u.email, name: u.name }) });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || 'Update fehlgeschlagen');
      
      // Speichere Rolle separat (nur wenn Owner und Rolle geändert)
      if (canChangeRoles && u.role && u.id !== currentUserId) {
        const originalUser = users.find(user => user.id === u.id);
        if (originalUser && originalUser.role !== u.role && u.role !== 'owner') {
          await changeRole(u.id, u.role as 'admin' | 'member');
          return; // changeRole ruft bereits load() auf
        }
      }
      
      await load();
      setEdit(null);
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || 'Fehler');
    }
  }

  async function remove(id: string) {
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
      setConfirmDeleteId(null);
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => {
    (document as any).__userManagementLoad = load;
    return () => { delete (document as any).__userManagementLoad; };
  }, []);

  return (
    <div style={{ width: '100%', display: 'grid', gap: 10 }}>
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
          <AdminTable
            headers={[
              t('admin.users.email'),
              t('admin.users.name'),
              t('admin.users.role') || 'Rolle',
              <span key="actions" style={{ display: 'inline-block', width: 220 }}>{t('admin.users.actions')}</span>
            ]}
          >
            {users.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>{t('admin.users.none')}</td>
              </tr>
            )}
            {users.map(u => (
              <Tr key={u.id} style={{ borderBottom: '1px solid var(--border)', background: edit?.id === u.id ? 'rgba(59,130,246,0.1)' : 'transparent' }}>
                {edit?.id === u.id ? (
                  <>
                    <Td>
                      <Input 
                        value={edit.email} 
                        onChange={e => setEdit({ ...(edit as any), email: e.target.value })}
                        style={{ padding: '8px 12px', fontSize: 14 }}
                      />
                    </Td>
                    <Td>
                      <Input 
                        value={edit.name ?? ''} 
                        onChange={e => setEdit({ ...(edit as any), name: e.target.value })}
                        style={{ padding: '8px 12px', fontSize: 14 }}
                      />
                    </Td>
                    <Td>
                      {edit.role === 'owner' ? (
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: 12, 
                          background: 'rgba(234, 179, 8, 0.2)', 
                          color: '#fbbf24', 
                          fontSize: 12, 
                          fontWeight: 600 
                        }}>
                          Owner
                        </span>
                      ) : canChangeRoles && edit.id !== currentUserId ? (
                        <select
                          value={edit.role || 'member'}
                          onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--glass)',
                            color: 'var(--fg)',
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: 12, 
                          background: edit.role === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)', 
                          color: edit.role === 'admin' ? '#60a5fa' : '#9ca3af', 
                          fontSize: 12, 
                          fontWeight: 600 
                        }}>
                          {edit.role === 'admin' ? 'Admin' : 'Member'}
                        </span>
                      )}
                    </Td>
                    <Td style={{ display: 'flex', gap: 8 }}>
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
                    </Td>
                  </>
                ) : (
                  <>
                    <Td><div style={{ display: 'flex', alignItems: 'center', color: 'var(--fg)', fontSize: 14 }}>{u.email}</div></Td>
                    <Td><div style={{ display: 'flex', alignItems: 'center', color: u.name ? 'var(--fg)' : 'var(--fg-subtle)', fontSize: 14 }}>{u.name ?? '—'}</div></Td>
                    <Td>
                      {u.role === 'owner' ? (
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: 12, 
                          background: 'rgba(234, 179, 8, 0.2)', 
                          color: '#fbbf24', 
                          fontSize: 12, 
                          fontWeight: 600 
                        }}>
                          Owner
                        </span>
                      ) : canChangeRoles && u.id !== currentUserId ? (
                        <select
                          value={u.role || 'member'}
                          onChange={(e) => changeRole(u.id, e.target.value as 'admin' | 'member')}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border)',
                            background: 'var(--glass)',
                            color: 'var(--fg)',
                            fontSize: 12,
                            cursor: 'pointer'
                          }}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <span style={{ 
                          padding: '4px 10px', 
                          borderRadius: 12, 
                          background: u.role === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)', 
                          color: u.role === 'admin' ? '#60a5fa' : '#9ca3af', 
                          fontSize: 12, 
                          fontWeight: 600 
                        }}>
                          {u.role === 'admin' ? 'Admin' : 'Member'}
                        </span>
                      )}
                    </Td>
                    <Td style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '', role: u.role })}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        {t('admin.users.edit')}
                      </Button>
                      <Button
                        onClick={async () => {
                          try {
                            setError(null);
                            setResetFor({ id: u.id, email: u.email });
                            setResetToken(null);
                            const res = await fetch(`${baseUrl}/auth/forgot`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: u.email }) });
                            const data = await res.json();
                            if (!res.ok) throw new Error(translateApiError(data?.error) || 'Failed');
                            setResetToken(data.token || null);
                            setResetOpen(true);
                          } catch (e: unknown) {
                            setError((e instanceof Error ? e.message : String(e)) || 'Fehler');
                          }
                        }}
                        style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                      >
                        {t('admin.users.generateReset')}
                      </Button>
                      {confirmDeleteId === u.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <Button variant="danger" onClick={() => remove(u.id)} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>
                            {t('admin.users.confirmDelete')}
                          </Button>
                          <Button onClick={() => setConfirmDeleteId(null)} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}>
                            &#x2715;
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="danger"
                          onClick={() => setConfirmDeleteId(u.id)}
                          style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13 }}
                        >
                          {t('admin.users.delete')}
                        </Button>
                      )}
                    </Td>
                  </>
                )}
              </Tr>
            ))}
          </AdminTable>
        </Card>
      )}

      <Modal zIndexBase={1100} open={createOpen} onOpenChange={(o)=> { setCreateOpen(o); if (!o) { setNewRole('member'); } }} title={t('admin.users.inviteTitle')} maxWidth={520} footer={<> 
        <Button onClick={() => setCreateOpen(false)}>{t('admin.users.cancel')}</Button>
        <Button variant="brand" onClick={async () => {
          setError(null);
          try {
            const res = await fetch(`${baseUrl}/auth/invite`, { 
              method: 'POST', 
              headers: { 'Content-Type': 'application/json' }, 
              credentials: 'include', 
              body: JSON.stringify({ email: newEmail, name: newName || undefined, role: newRole }) 
            });
            if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
            const data = await res.json();
            setInviteCode(data.code || null);
            try { await (document as any).__userManagementLoad?.(); } catch (err) { logger.warn('[UserManagement] Failed to reload after invite', err); }
          } catch (e: unknown) {
            setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
          }
        }}>{t('admin.users.createInvite')}</Button>
      </>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Input placeholder={t('admin.users.emailAddress')} value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <Input placeholder={t('admin.users.nameOptional')} value={newName} onChange={e => setNewName(e.target.value)} />
          {isOwner && (
            <div style={{ display: 'grid', gap: 4 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.role') || 'Rolle'}</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  fontSize: 14,
                  cursor: 'pointer'
                }}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
                Admins können weitere Member einladen und User verwalten.
              </div>
            </div>
          )}
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

      <Modal zIndexBase={1100} open={resetOpen} onOpenChange={(o)=> setResetOpen(o)} title={t('admin.users.resetTitle')} maxWidth={520} footer={<>
        <Button onClick={() => setResetOpen(false)}>{t('admin.users.close')}</Button>
        {resetToken && (
          <Button onClick={() => { try { navigator.clipboard?.writeText(resetToken); } catch {} }}>{t('admin.users.copy')}</Button>
        )}
      </>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="glass-surface" style={{ padding: 12, borderRadius: 'var(--radius-sm)', display:'grid', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.resetToken')}</div>
            <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
              <div style={{ flex: 1, padding: '10px 12px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, letterSpacing: '0.06em' }}>
                {resetToken || '—'}
              </div>
              {resetToken && (
                <Button onClick={() => { try { navigator.clipboard?.writeText(resetToken); } catch {} }}>{t('admin.users.copy')}</Button>
              )}
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
            {t('admin.users.resetHint')}
            {resetFor?.email ? ` (${resetFor.email})` : ''}
          </div>
        </div>
      </Modal>
    </div>
  );
}


