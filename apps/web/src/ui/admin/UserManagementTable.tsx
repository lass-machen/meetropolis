import { Button, Input, Select, TBody, Td, Tr } from '../../ui/system';
import { useTranslation } from 'react-i18next';
import { translateApiError } from '../../lib/apiErrors';
import { Icon } from '../Icon';
import type { ApiErrorBody, EditUser, ResetTokenResponse, Role, User } from './userManagementTypes';

export function RoleBadge({ userRole }: { userRole: 'owner' | 'admin' | 'member' | undefined }) {
  const { t } = useTranslation();
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
        {t('admin.users.roleOwner')}
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
      {userRole === 'admin' ? t('admin.users.roleAdmin') : t('admin.users.roleMember')}
    </span>
  );
}

export function RoleCell({
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
  const { t } = useTranslation();
  const role = edit && edit.id === user.id ? edit.role : user.role;
  if (role === 'owner') return <RoleBadge userRole="owner" />;
  if (canChangeRoles && user.id !== currentUserId) {
    return (
      <Select
        value={role || 'member'}
        onChange={(val) => onChange(user.id, val as 'admin' | 'member')}
        style={{ width: 'auto' }}
        options={[
          { value: 'admin', label: t('admin.users.roleAdmin') },
          { value: 'member', label: t('admin.users.roleMember') },
        ]}
      />
    );
  }
  return <RoleBadge userRole={role} />;
}

export function ResetTokenButton({
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
            const data = (await res.json()) as ResetTokenResponse & ApiErrorBody;
            if (!res.ok) throw new Error(translateApiError(data?.error) || t('admin.users.failed'));
            openReset({
              for: { id: user.id, email: user.email },
              token: data.token || null,
              resetUrl: data.resetUrl || null,
            });
          } catch (e: unknown) {
            setError((e instanceof Error ? e.message : String(e)) || t('admin.users.genericError'));
          }
        })();
      }}
    >
      {t('admin.users.generateReset')}
    </Button>
  );
}

export function DeleteCell({
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
        <Button size="sm" onClick={() => setConfirmDeleteId(null)} aria-label="Cancel">
          <Icon name="xmark" size="md" />
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

export function EditRow({
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
  const { t } = useTranslation();
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
              { value: 'admin', label: t('admin.users.roleAdmin') },
              { value: 'member', label: t('admin.users.roleMember') },
            ]}
          />
        ) : (
          <RoleBadge userRole={edit.role} />
        )}
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button size="sm" variant="brand" onClick={() => onSave(edit)} aria-label="Save">
          <Icon name="check" size="md" />
        </Button>
        <Button size="sm" onClick={() => setEdit(null)} aria-label="Cancel">
          <Icon name="xmark" size="md" />
        </Button>
      </Td>
    </>
  );
}

export function ViewRow({
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

export function UsersTableBody({
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
