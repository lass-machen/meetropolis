import React from 'react';
import { translateApiError } from '../../lib/apiErrors';
import type { ApiErrorBody, EditUser, MeResponse, Role, User, UserManagementWindow } from './userManagementTypes';

export function useUsersLoader(baseUrl: string, t: (k: string) => string) {
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
      let meData: MeResponse | null = null;
      if (meRes.ok) {
        meData = (await meRes.json()) as MeResponse;
        if (meData?.id) setCurrentUserId(meData.id);
      }
      const res = await fetch(`${baseUrl}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error(t('common.error'));
      const list = (await res.json()) as User[];
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

export function useUserMutations(
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
      if (!res.ok) throw new Error(translateApiError(((await res.json()) as ApiErrorBody)?.error) || t('common.error'));
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
      if (!res.ok)
        throw new Error(
          translateApiError(((await res.json()) as ApiErrorBody)?.error) || t('admin.users.updateFailed'),
        );
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
      setError((e instanceof Error ? e.message : String(e)) || t('admin.users.genericError'));
      return false;
    }
  };

  const remove = async (id: string) => {
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error(translateApiError(((await res.json()) as ApiErrorBody)?.error) || t('common.error'));
      await load();
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  };

  return { changeRole, save, remove };
}

export function useUserManagement(baseUrl: string, t: (k: string) => string) {
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- intentional: run-once on mount; loader is a stable ref-based handle
  React.useEffect(() => {
    (document as unknown as UserManagementWindow).__userManagementLoad = loader.load;
    return () => {
      delete (document as unknown as UserManagementWindow).__userManagementLoad;
    };
  }, [loader.load]);

  return { ...loader, canChangeRoles, isOwner, ...mutations };
}
