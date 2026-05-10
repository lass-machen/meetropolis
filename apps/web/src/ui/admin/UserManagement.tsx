import React from 'react';
import {
  Toolbar,
  Button,
  Card,
  Input,
  Modal,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  TableContainer,
  Select,
} from '../../ui/system';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';
import { translateApiError } from '../../lib/apiErrors';

type Role = 'owner' | 'admin' | 'member';
type User = { id: string; email: string; name?: string; createdAt?: string; role?: Role };
type EditUser = { id: string; email: string; name?: string; role?: Role | undefined };

function useUsersLoader(baseUrl: string, t: (k: string) => string) {
  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<User[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = React.useState<Role | null>(null);
  const [currentUserId, setCurrentUserId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
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
  }, [baseUrl, t, currentUserId]);

  return { loading, users, error, setError, currentUserRole, currentUserId, load };
}

function useUserMutations(
  baseUrl: string,
  t: (k: string) => string,
  ctx: {
    users: User[];
    canChangeRoles: boolean;
    currentUserId: string | null;
    load: () => Promise<void>;
    setError: (e: string | null) => void;
  },
) {
  const { setError, load, users, canChangeRoles, currentUserId } = ctx;

  const changeRole = async (userId: string, newRole: 'admin' | 'member') => {
    try {
      setError(null);
      const res = await fetch(`${baseUrl}/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  };

  const save = async (u: EditUser) => {
    try {
      const res = await fetch(`${baseUrl}/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: u.email, name: u.name }),
      });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || 'Update fehlgeschlagen');
      if (canChangeRoles && u.role && u.id !== currentUserId) {
        const originalUser = users.find((user) => user.id === u.id);
        if (originalUser && originalUser.role !== u.role && u.role !== 'owner') {
          await changeRole(u.id, u.role);
          return true;
        }
      }
      await load();
      return true;
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || 'Fehler');
      return false;
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  };

  return { changeRole, save, remove };
}

function useUserManagement(baseUrl: string, t: (k: string) => string) {
  const loader = useUsersLoader(baseUrl, t);
  const canChangeRoles = loader.currentUserRole === 'owner' || loader.currentUserRole === 'admin';
  const isOwner = loader.currentUserRole === 'owner';
  const mutations = useUserMutations(baseUrl, t, {
    users: loader.users,
    canChangeRoles,
    currentUserId: loader.currentUserId,
    load: loader.load,
    setError: loader.setError,
  });

  React.useEffect(() => {
    void loader.load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    (document as any).__userManagementLoad = loader.load;
    return () => {
      delete (document as any).__userManagementLoad;
    };
  }, [loader.load]);

  return { ...loader, canChangeRoles, isOwner, ...mutations };
}

function RoleBadge({ userRole }: { userRole: 'owner' | 'admin' | 'member' | undefined }) {
  if (userRole === 'owner') {
    return (
      <span
        style={{
          padding: '4px 10px',
          borderRadius: 12,
          background: 'rgba(234, 179, 8, 0.2)',
          color: '#fbbf24',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        Owner
      </span>
    );
  }
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 12,
        background: userRole === 'admin' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(107, 114, 128, 0.2)',
        color: userRole === 'admin' ? '#60a5fa' : '#9ca3af',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {userRole === 'admin' ? 'Admin' : 'Member'}
    </span>
  );
}

function RoleCell({
  user,
  edit,
  canChangeRoles,
  currentUserId,
  onChange,
}: {
  user: User;
  edit: EditUser | null;
  canChangeRoles: boolean;
  currentUserId: string | null;
  onChange: (id: string, role: 'admin' | 'member') => void;
}) {
  const role = edit && edit.id === user.id ? edit.role : user.role;
  if (role === 'owner') return <RoleBadge userRole="owner" />;
  if (canChangeRoles && user.id !== currentUserId) {
    return (
      <Select
        value={role || 'member'}
        onChange={(val) => onChange(user.id, val as 'admin' | 'member')}
        style={{ width: 'auto' }}
        options={[
          { value: 'admin', label: 'Admin' },
          { value: 'member', label: 'Member' },
        ]}
      />
    );
  }
  return <RoleBadge userRole={role} />;
}

function ResetTokenButton({
  user,
  baseUrl,
  setError,
  openReset,
}: {
  user: User;
  baseUrl: string;
  setError: (e: string | null) => void;
  openReset: (data: { for: { id: string; email: string }; token: string | null; resetUrl?: string | null }) => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      size="sm"
      onClick={() => {
        void (async () => {
          try {
            setError(null);
            const res = await fetch(`${baseUrl}/admin/users/${user.id}/reset-token`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            const data = await res.json();
            if (!res.ok) throw new Error(translateApiError(data?.error) || 'Failed');
            openReset({
              for: { id: user.id, email: user.email },
              token: data.token || null,
              resetUrl: data.resetUrl || null,
            });
          } catch (e: unknown) {
            setError((e instanceof Error ? e.message : String(e)) || 'Fehler');
          }
        })();
      }}
    >
      {t('admin.users.generateReset')}
    </Button>
  );
}

function DeleteCell({
  userId,
  confirmDeleteId,
  setConfirmDeleteId,
  onDelete,
}: {
  userId: string;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (s: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (confirmDeleteId === userId) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <Button size="sm" variant="danger" onClick={() => onDelete(userId)}>
          {t('admin.users.confirmDelete')}
        </Button>
        <Button size="sm" onClick={() => setConfirmDeleteId(null)}>
          &#x2715;
        </Button>
      </div>
    );
  }
  return (
    <Button size="sm" variant="danger" onClick={() => setConfirmDeleteId(userId)}>
      {t('admin.users.delete')}
    </Button>
  );
}

function EditRow({
  edit,
  setEdit,
  canChangeRoles,
  currentUserId,
  onSave,
}: {
  edit: EditUser;
  setEdit: (u: EditUser | null) => void;
  canChangeRoles: boolean;
  currentUserId: string | null;
  onSave: (u: EditUser) => void;
}) {
  return (
    <>
      <Td style={{ paddingLeft: 0 }}>
        <Input
          value={edit.email}
          onChange={(e) => setEdit({ ...edit, email: e.target.value })}
          style={{ padding: '8px 12px', fontSize: 14 }}
        />
      </Td>
      <Td>
        <Input
          value={edit.name ?? ''}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          style={{ padding: '8px 12px', fontSize: 14 }}
        />
      </Td>
      <Td>
        {edit.role === 'owner' ? (
          <RoleBadge userRole="owner" />
        ) : canChangeRoles && edit.id !== currentUserId ? (
          <Select
            value={edit.role || 'member'}
            onChange={(val) => setEdit({ ...edit, role: val as Role })}
            style={{ width: 'auto' }}
            options={[
              { value: 'admin', label: 'Admin' },
              { value: 'member', label: 'Member' },
            ]}
          />
        ) : (
          <RoleBadge userRole={edit.role} />
        )}
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="brand" onClick={() => onSave(edit)}>
          ✓
        </Button>
        <Button size="sm" onClick={() => setEdit(null)}>
          ✕
        </Button>
      </Td>
    </>
  );
}

function ViewRow({
  u,
  edit,
  setEdit,
  canChangeRoles,
  currentUserId,
  changeRole,
  baseUrl,
  setError,
  openReset,
  confirmDeleteId,
  setConfirmDeleteId,
  onDelete,
}: {
  u: User;
  edit: EditUser | null;
  setEdit: (e: EditUser | null) => void;
  canChangeRoles: boolean;
  currentUserId: string | null;
  changeRole: (id: string, role: 'admin' | 'member') => void;
  baseUrl: string;
  setError: (e: string | null) => void;
  openReset: (d: { for: { id: string; email: string }; token: string | null }) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (s: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Td style={{ paddingLeft: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', color: 'var(--fg)', fontSize: 14 }}>{u.email}</div>
      </Td>
      <Td>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            color: u.name ? 'var(--fg)' : 'var(--fg-subtle)',
            fontSize: 14,
          }}
        >
          {u.name ?? '—'}
        </div>
      </Td>
      <Td>
        <RoleCell
          user={u}
          edit={edit}
          canChangeRoles={canChangeRoles}
          currentUserId={currentUserId}
          onChange={changeRole}
        />
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '', role: u.role })}>
          {t('admin.users.edit')}
        </Button>
        <ResetTokenButton user={u} baseUrl={baseUrl} setError={setError} openReset={openReset} />
        <DeleteCell
          userId={u.id}
          confirmDeleteId={confirmDeleteId}
          setConfirmDeleteId={setConfirmDeleteId}
          onDelete={onDelete}
        />
      </Td>
    </>
  );
}

function UsersTableBody({
  loading,
  users,
  edit,
  setEdit,
  canChangeRoles,
  currentUserId,
  changeRole,
  save,
  baseUrl,
  setError,
  openReset,
  confirmDeleteId,
  setConfirmDeleteId,
  onDelete,
}: {
  loading: boolean;
  users: User[];
  edit: EditUser | null;
  setEdit: (e: EditUser | null) => void;
  canChangeRoles: boolean;
  currentUserId: string | null;
  changeRole: (id: string, r: 'admin' | 'member') => void;
  save: (u: EditUser) => Promise<boolean>;
  baseUrl: string;
  setError: (e: string | null) => void;
  openReset: (d: { for: { id: string; email: string }; token: string | null }) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (s: string | null) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handleSave = async (u: EditUser) => {
    const ok = await save(u);
    if (ok) setEdit(null);
  };
  if (loading) {
    return (
      <TBody>
        {[1, 2, 3].map((i) => (
          <Tr key={i}>
            <Td colSpan={4} style={{ paddingLeft: 0 }}>
              <div
                style={{
                  height: 16,
                  borderRadius: 4,
                  background: 'var(--glass-hover)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                  width: `${60 + i * 10}%`,
                }}
              />
            </Td>
          </Tr>
        ))}
      </TBody>
    );
  }
  if (users.length === 0) {
    return (
      <TBody>
        <Tr>
          <Td colSpan={4} style={{ paddingLeft: 0, textAlign: 'center', color: 'var(--fg-subtle)', padding: '32px 0' }}>
            {t('admin.users.none')}
          </Td>
        </Tr>
      </TBody>
    );
  }
  return (
    <TBody>
      {users.map((u) => (
        <Tr
          key={u.id}
          style={{
            borderBottom: '1px solid var(--border)',
            background: edit?.id === u.id ? 'rgba(59,130,246,0.1)' : 'transparent',
          }}
        >
          {edit?.id === u.id ? (
            <EditRow
              edit={edit}
              setEdit={setEdit}
              canChangeRoles={canChangeRoles}
              currentUserId={currentUserId}
              onSave={(eu) => {
                void handleSave(eu);
              }}
            />
          ) : (
            <ViewRow
              u={u}
              edit={edit}
              setEdit={setEdit}
              canChangeRoles={canChangeRoles}
              currentUserId={currentUserId}
              changeRole={changeRole}
              baseUrl={baseUrl}
              setError={setError}
              openReset={openReset}
              confirmDeleteId={confirmDeleteId}
              setConfirmDeleteId={setConfirmDeleteId}
              onDelete={onDelete}
            />
          )}
        </Tr>
      ))}
    </TBody>
  );
}

function CreateUserModal({
  open,
  onOpenChange,
  baseUrl,
  isOwner,
  setError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  baseUrl: string;
  isOwner: boolean;
  setError: (e: string | null) => void;
}) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newRole, setNewRole] = React.useState<'admin' | 'member'>('member');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setInviteCode(null);
      setNewEmail('');
      setNewName('');
    }
  }, [open]);

  const handleInvite = async () => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/auth/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newEmail, name: newName || undefined, role: newRole }),
      });
      if (!res.ok) throw new Error(translateApiError((await res.json())?.error) || t('common.error'));
      const data = await res.json();
      setInviteCode(data.code || null);
      try {
        await (document as any).__userManagementLoad?.();
      } catch (err) {
        logger.warn('[UserManagement] Failed to reload after invite', err);
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  };

  return (
    <Modal
      zIndexBase={1100}
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setNewRole('member');
      }}
      title={t('admin.users.inviteTitle')}
      maxWidth={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('admin.users.cancel')}</Button>
          <Button
            variant="brand"
            onClick={() => {
              void handleInvite();
            }}
          >
            {t('admin.users.createInvite')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Input
          placeholder={t('admin.users.emailAddress')}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <Input
          placeholder={t('admin.users.nameOptional')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        {isOwner && (
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.role') || 'Rolle'}</label>
            <Select
              value={newRole}
              onChange={(val) => setNewRole(val as 'admin' | 'member')}
              options={[
                { value: 'member', label: 'Member' },
                { value: 'admin', label: 'Admin' },
              ]}
            />
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>
              Admins können weitere Member einladen und User verwalten.
            </div>
          </div>
        )}
        {inviteCode && (
          <div
            className="glass-surface"
            style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
          >
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteCode')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                {inviteCode}
              </div>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteCode);
                }}
              >
                {t('admin.users.copy')}
              </Button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteHint')}</div>
      </div>
    </Modal>
  );
}

function ResetModal({
  open,
  onOpenChange,
  resetFor,
  resetToken,
  resetUrl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resetFor: { id: string; email: string } | null;
  resetToken: string | null;
  resetUrl: string | null;
}) {
  const { t } = useTranslation();
  const copyToken = () => {
    try {
      if (resetToken) void navigator.clipboard?.writeText(resetToken);
    } catch {}
  };
  const copyUrl = () => {
    try {
      if (resetUrl) void navigator.clipboard?.writeText(resetUrl);
    } catch {}
  };
  return (
    <Modal
      zIndexBase={1100}
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.resetTitle')}
      maxWidth={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('admin.users.close')}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div
          className="glass-surface"
          style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
        >
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.resetToken')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                color: 'var(--fg)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontWeight: 700,
                letterSpacing: '0.06em',
                wordBreak: 'break-all',
              }}
            >
              {resetToken || '—'}
            </div>
            {resetToken && <Button onClick={copyToken}>{t('admin.users.copy')}</Button>}
          </div>
        </div>
        {resetUrl && (
          <div
            className="glass-surface"
            style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
          >
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Reset-Link</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                }}
              >
                {resetUrl}
              </div>
              <Button onClick={copyUrl}>{t('admin.users.copy')}</Button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {t('admin.users.resetHint')}
          {resetFor?.email ? ` (${resetFor.email})` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', borderLeft: '2px solid var(--accent)', paddingLeft: 8 }}>
          Wird nicht erneut angezeigt — jetzt kopieren und out-of-band weitergeben (gültig 30 Min).
        </div>
      </div>
    </Modal>
  );
}

export function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const { t } = useTranslation();
  const { loading, users, error, setError, currentUserId, canChangeRoles, isOwner, changeRole, save, remove } =
    useUserManagement(baseUrl, t);
  const [edit, setEdit] = React.useState<EditUser | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<{ id: string; email: string } | null>(null);
  const [resetToken, setResetToken] = React.useState<string | null>(null);
  const [resetUrl, setResetUrl] = React.useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);

  const openReset = (data: { for: { id: string; email: string }; token: string | null; resetUrl?: string | null }) => {
    setResetFor(data.for);
    setResetToken(data.token);
    setResetUrl(data.resetUrl || null);
    setResetOpen(true);
  };
  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    await remove(id);
  };

  return (
    <div style={{ width: '100%', display: 'grid', gap: 10 }}>
      <Toolbar
        left={
          <>
            <Button onClick={onBack}>← {t('admin.users.back')}</Button>
            <div
              style={{
                padding: '6px 12px',
                borderRadius: 20,
                background: 'var(--glass)',
                border: '1px solid var(--border)',
                fontSize: 12,
                color: 'var(--fg)',
                fontWeight: 600,
              }}
            >
              {t('admin.users.adminBadge')}
            </div>
          </>
        }
        right={
          <>
            <Button variant="brand" onClick={() => setCreateOpen(true)}>
              + {t('admin.users.newUser')}
            </Button>
          </>
        }
        style={{ background: 'transparent', border: 'none', padding: 0 }}
      />

      {error && (
        <Card style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <div style={{ color: '#fca5a5' }}>{error}</div>
        </Card>
      )}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <TableContainer maxHeight="60vh">
          <Table>
            <THead sticky>
              <Tr>
                <Th style={{ paddingLeft: 0 }}>{t('admin.users.email')}</Th>
                <Th>{t('admin.users.name')}</Th>
                <Th>{t('admin.users.role') || 'Rolle'}</Th>
                <Th style={{ paddingRight: 0 }}>{null}</Th>
              </Tr>
            </THead>
            <UsersTableBody
              loading={loading}
              users={users}
              edit={edit}
              setEdit={setEdit}
              canChangeRoles={canChangeRoles}
              currentUserId={currentUserId}
              changeRole={(id, r) => {
                void changeRole(id, r);
              }}
              save={save}
              baseUrl={baseUrl}
              setError={setError}
              openReset={openReset}
              confirmDeleteId={confirmDeleteId}
              setConfirmDeleteId={setConfirmDeleteId}
              onDelete={(id) => {
                void handleDelete(id);
              }}
            />
          </Table>
        </TableContainer>
      </Card>

      <CreateUserModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        baseUrl={baseUrl}
        isOwner={isOwner}
        setError={setError}
      />
      <ResetModal
        open={resetOpen}
        onOpenChange={setResetOpen}
        resetFor={resetFor}
        resetToken={resetToken}
        resetUrl={resetUrl}
      />
    </div>
  );
}
