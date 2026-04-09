import React from 'react';
import {
  Section,
  Button,
  Input,
  Select,
  Table,
  THead,
  TBody,
  Tr,
  Th,
  Td,
  TableContainer,
  Alert,
} from '../system';
import { logger } from '../../lib/logger';

type AdminRole = 'owner' | 'admin' | 'member';

type TenantUser = {
  userId: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  role: AdminRole;
  createdAt: string;
  emailVerifiedAt: string | null;
  memberSince: string;
};

type AddRole = 'admin' | 'member';

interface TenantUsersPanelProps {
  apiBase: string;
  tenantId: string;
}

const ROLE_OPTIONS: Array<{ value: AdminRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

const ADD_ROLE_OPTIONS: Array<{ value: AddRole; label: string }> = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

interface UsersHookState {
  users: TenantUser[];
  loading: boolean;
  error: string | null;
  removingId: string | null;
  savingRoleId: string | null;
  setError: (error: string | null) => void;
  setRemovingId: (id: string | null) => void;
  load: () => Promise<void>;
  changeRole: (userId: string, role: AdminRole) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  addUser: (email: string, role: AddRole) => Promise<boolean>;
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetchUsers(apiBase: string, tenantId: string): Promise<ApiResult<TenantUser[]>> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/users`, {
      credentials: 'include',
    });
    if (!res.ok) return { ok: false, error: `Fehler beim Laden (HTTP ${res.status})` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    logger.warn('[TenantUsersPanel] Failed to load users', err);
    return { ok: false, error: 'Verbindung fehlgeschlagen' };
  }
}

async function patchUserRole(
  apiBase: string,
  tenantId: string,
  userId: string,
  role: AdminRole,
): Promise<ApiResult<void>> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/users/${userId}/role`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) return { ok: false, error: `Rolle konnte nicht aktualisiert werden (HTTP ${res.status})` };
    return { ok: true, data: undefined };
  } catch (err) {
    logger.warn('[TenantUsersPanel] Failed to update role', err);
    return { ok: false, error: 'Rolle konnte nicht aktualisiert werden' };
  }
}

async function deleteUser(
  apiBase: string,
  tenantId: string,
  userId: string,
): Promise<ApiResult<void>> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/users/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: false, error: data?.error || `Fehler beim Entfernen (HTTP ${res.status})` };
    }
    return { ok: true, data: undefined };
  } catch (err) {
    logger.warn('[TenantUsersPanel] Failed to remove user', err);
    return { ok: false, error: 'Benutzer konnte nicht entfernt werden' };
  }
}

async function postUser(
  apiBase: string,
  tenantId: string,
  email: string,
  role: AddRole,
): Promise<ApiResult<void>> {
  try {
    const res = await fetch(`${apiBase}/admin/tenants/${tenantId}/users`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return { ok: false, error: data?.error || `Hinzufügen fehlgeschlagen (HTTP ${res.status})` };
    }
    return { ok: true, data: undefined };
  } catch (err) {
    logger.warn('[TenantUsersPanel] Failed to add user', err);
    return { ok: false, error: 'Benutzer konnte nicht hinzugefügt werden' };
  }
}

function useTenantUsers(apiBase: string, tenantId: string): UsersHookState {
  const [users, setUsers] = React.useState<TenantUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removingId, setRemovingId] = React.useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchUsers(apiBase, tenantId);
    if (res.ok) setUsers(res.data);
    else {
      setError(res.error);
      setUsers([]);
    }
    setLoading(false);
  }, [apiBase, tenantId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!removingId) return;
    const timer = setTimeout(() => setRemovingId(null), 3000);
    return () => clearTimeout(timer);
  }, [removingId]);

  const changeRole = React.useCallback(
    async (userId: string, role: AdminRole) => {
      setSavingRoleId(userId);
      const res = await patchUserRole(apiBase, tenantId, userId, role);
      if (res.ok) setUsers((prev) => prev.map((u) => (u.userId === userId ? { ...u, role } : u)));
      else setError(res.error);
      setSavingRoleId(null);
    },
    [apiBase, tenantId],
  );

  const removeUser = React.useCallback(
    async (userId: string) => {
      const res = await deleteUser(apiBase, tenantId, userId);
      if (res.ok) setUsers((prev) => prev.filter((u) => u.userId !== userId));
      else setError(res.error);
      setRemovingId(null);
    },
    [apiBase, tenantId],
  );

  const addUser = React.useCallback(
    async (email: string, role: AddRole): Promise<boolean> => {
      const cleanEmail = email.trim();
      if (!cleanEmail) return false;
      setError(null);
      const res = await postUser(apiBase, tenantId, cleanEmail, role);
      if (res.ok) {
        await load();
        return true;
      }
      setError(res.error);
      return false;
    },
    [apiBase, tenantId, load],
  );

  return {
    users,
    loading,
    error,
    removingId,
    savingRoleId,
    setError,
    setRemovingId,
    load,
    changeRole,
    removeUser,
    addUser,
  };
}

export function TenantUsersPanel({ apiBase, tenantId }: TenantUsersPanelProps) {
  const state = useTenantUsers(apiBase, tenantId);
  const [addEmail, setAddEmail] = React.useState('');
  const [addRole, setAddRole] = React.useState<AddRole>('member');
  const [adding, setAdding] = React.useState(false);

  const handleAdd = async () => {
    setAdding(true);
    const ok = await state.addUser(addEmail, addRole);
    if (ok) {
      setAddEmail('');
      setAddRole('member');
    }
    setAdding(false);
  };

  return (
    <Section
      title="Benutzer"
      description="Verwalte Mitglieder dieses Tenants und ihre Rollen."
      actions={
        <Button size="sm" onClick={() => void state.load()}>
          {state.loading ? 'Lade…' : 'Neu laden'}
        </Button>
      }
    >
      {state.error && (
        <Alert
          intent="error"
          onDismiss={() => state.setError(null)}
          style={{ marginBottom: 12 }}
        >
          {state.error}
        </Alert>
      )}
      <AddUserBar
        addEmail={addEmail}
        addRole={addRole}
        adding={adding}
        onChangeEmail={setAddEmail}
        onChangeRole={setAddRole}
        onSubmit={() => void handleAdd()}
      />
      <UsersTable
        users={state.users}
        loading={state.loading}
        removingId={state.removingId}
        savingRoleId={state.savingRoleId}
        onChangeRole={(id, role) => void state.changeRole(id, role)}
        onArmRemove={state.setRemovingId}
        onConfirmRemove={(id) => void state.removeUser(id)}
      />
    </Section>
  );
}

interface AddUserBarProps {
  addEmail: string;
  addRole: AddRole;
  adding: boolean;
  onChangeEmail: (value: string) => void;
  onChangeRole: (role: AddRole) => void;
  onSubmit: () => void;
}

function AddUserBar({
  addEmail,
  addRole,
  adding,
  onChangeEmail,
  onChangeRole,
  onSubmit,
}: AddUserBarProps) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <Input
        value={addEmail}
        onChange={(e) => onChangeEmail(e.target.value)}
        placeholder="email@example.com"
        style={{ flex: 1, maxWidth: 320 }}
        type="email"
      />
      <Select
        value={addRole}
        onChange={(val) => onChangeRole(val as AddRole)}
        options={ADD_ROLE_OPTIONS}
        style={{ width: 140 }}
      />
      <Button variant="primary" onClick={onSubmit} disabled={adding || !addEmail.trim()}>
        {adding ? 'Lade…' : 'Hinzufügen'}
      </Button>
    </div>
  );
}

interface UsersTableProps {
  users: TenantUser[];
  loading: boolean;
  removingId: string | null;
  savingRoleId: string | null;
  onChangeRole: (userId: string, role: AdminRole) => void;
  onArmRemove: (userId: string) => void;
  onConfirmRemove: (userId: string) => void;
}

function UsersTable({
  users,
  loading,
  removingId,
  savingRoleId,
  onChangeRole,
  onArmRemove,
  onConfirmRemove,
}: UsersTableProps) {
  return (
    <TableContainer style={{ maxHeight: '50vh' }}>
      <Table>
        <THead>
          <Tr>
            <Th style={{ paddingLeft: 0 }}>Benutzer</Th>
            <Th style={{ width: 160 }}>Rolle</Th>
            <Th style={{ paddingRight: 0, textAlign: 'right' }}>{null}</Th>
          </Tr>
        </THead>
        {loading && <UsersLoadingBody />}
        {!loading && users.length === 0 && <UsersEmptyBody />}
        {!loading && users.length > 0 && (
          <TBody>
            {users.map((u) => (
              <UserRow
                key={u.userId}
                user={u}
                isRemoveArmed={removingId === u.userId}
                isSavingRole={savingRoleId === u.userId}
                onChangeRole={onChangeRole}
                onArmRemove={onArmRemove}
                onConfirmRemove={onConfirmRemove}
              />
            ))}
          </TBody>
        )}
      </Table>
    </TableContainer>
  );
}

function UsersLoadingBody() {
  return (
    <TBody>
      {[1, 2, 3].map((i) => (
        <Tr key={i}>
          <Td colSpan={3} style={{ paddingLeft: 0 }}>
            <div
              style={{
                height: 16,
                borderRadius: 4,
                background: 'var(--glass-hover)',
                width: `${50 + i * 10}%`,
              }}
            />
          </Td>
        </Tr>
      ))}
    </TBody>
  );
}

function UsersEmptyBody() {
  return (
    <TBody>
      <Tr>
        <Td
          colSpan={3}
          style={{
            paddingLeft: 0,
            textAlign: 'center',
            color: 'var(--fg-subtle)',
            padding: '32px 0',
          }}
        >
          Keine Benutzer in diesem Tenant
        </Td>
      </Tr>
    </TBody>
  );
}

interface UserRowProps {
  user: TenantUser;
  isRemoveArmed: boolean;
  isSavingRole: boolean;
  onChangeRole: (userId: string, role: AdminRole) => void;
  onArmRemove: (userId: string) => void;
  onConfirmRemove: (userId: string) => void;
}

function UserRow({
  user,
  isRemoveArmed,
  isSavingRole,
  onChangeRole,
  onArmRemove,
  onConfirmRemove,
}: UserRowProps) {
  return (
    <Tr>
      <Td style={{ paddingLeft: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{user.name || user.email}</div>
        {user.name && (
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginTop: 4 }}>
            {user.email}
          </div>
        )}
      </Td>
      <Td style={{ width: 160 }}>
        <Select
          value={user.role}
          onChange={(val) => onChangeRole(user.userId, val as AdminRole)}
          disabled={isSavingRole}
          options={ROLE_OPTIONS}
        />
      </Td>
      <Td style={{ paddingRight: 0, textAlign: 'right' }}>
        <Button
          size="sm"
          variant="danger"
          onClick={() =>
            isRemoveArmed ? onConfirmRemove(user.userId) : onArmRemove(user.userId)
          }
        >
          {isRemoveArmed ? 'Wirklich entfernen?' : 'Entfernen'}
        </Button>
      </Td>
    </Tr>
  );
}
