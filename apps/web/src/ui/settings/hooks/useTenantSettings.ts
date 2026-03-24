import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import type { TenantInfo, Member, Guest } from '../tenant/types';
import { translateApiError } from '../../../lib/apiErrors';

interface UseTenantSettingsReturn {
  tenant: TenantInfo | null;
  members: Member[];
  guests: Guest[];
  isEnterprise: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  setError: (error: string | null) => void;
  setSuccess: (success: string | null) => void;
  setSaving: (saving: boolean) => void;
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  fetchData: () => Promise<void>;
  handleChangeRole: (userId: string, newRole: 'admin' | 'member') => Promise<void>;
  handleRemoveMember: (userId: string) => Promise<void>;
  handleInvite: (email: string, role: 'admin' | 'member') => Promise<string | null>;
  handleCreateGuest: (email: string, name: string, expiresAt: string) => Promise<{ magicLink: string } | null>;
  handleRevokeGuest: (membershipId: string) => Promise<void>;
  handleResetPassword: (email: string) => Promise<string | null>;
  handleEditMember: (userId: string, data: { email?: string; name?: string }) => Promise<boolean>;
  handleUpdateTenant: (data: { name?: string; defaultMapName?: string }) => Promise<boolean>;
}

export function useTenantSettings(): UseTenantSettingsReturn {
  const { t } = useTranslation();
  const [tenant, setTenant] = React.useState<TenantInfo | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [guests, setGuests] = React.useState<Guest[]>([]);
  const [isEnterprise, setIsEnterprise] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const apiBase = getApiBaseFromWindow();

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tenantRes, membersRes, statusRes] = await Promise.all([
        fetch(`${apiBase}/tenant`, { credentials: 'include' }),
        fetch(`${apiBase}/users`, { credentials: 'include' }),
        fetch(`${apiBase}/billing/status`, { credentials: 'include' }),
      ]);

      // Tenant info from GET /tenant
      if (tenantRes.ok) {
        const data = await tenantRes.json();
        setTenant({
          id: data.id,
          slug: data.slug,
          name: data.name,
          concurrentLimit: data.concurrentLimit,
          freeSeats: data.freeSeats,
          bypassLimits: data.bypassLimits,
          isInternal: data.isInternal,
          createdAt: data.createdAt,
          defaultMapName: data.defaultMapName ?? undefined,
          publicRegistrationEnabled: data.publicRegistrationEnabled ?? undefined,
          memberCount: data.memberCount ?? undefined,
        });
      }

      // Enterprise check (billing status available = enterprise)
      if (statusRes.ok) {
        setIsEnterprise(true);
        // If tenant wasn't loaded from /tenant, fallback to billing/status
        if (!tenantRes.ok) {
          const data = await statusRes.json();
          setTenant({
            id: data.tenant.id,
            slug: data.tenant.slug,
            name: data.tenant.name,
            concurrentLimit: data.usage.paidSeats || 0,
            freeSeats: data.usage.freeSeats || 0,
            bypassLimits: data.tenant.bypassLimits,
            isInternal: data.tenant.isInternal,
            createdAt: data.tenant.createdAt || '',
          });
        }
      }

      if (membersRes.ok) {
        setMembers(await membersRes.json() || []);
      }

      // Fetch guests for enterprise
      if (statusRes.ok) {
        try {
          const guestsRes = await fetch(`${apiBase}/guests`, { credentials: 'include' });
          if (guestsRes.ok) setGuests(await guestsRes.json() || []);
        } catch { /* */ }
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('tenant.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

  const handleChangeRole = React.useCallback(async (userId: string, newRole: 'admin' | 'member') => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/${userId}/role`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m));
        setSuccess(t('tenant.roleUpdated'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.roleUpdateFailed'));
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleRemoveMember = React.useCallback(async (userId: string) => {
    if (!confirm(t('tenant.confirmRemoveMember'))) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== userId));
        setSuccess(t('tenant.memberRemoved'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.removeFailed'));
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleInvite = React.useCallback(async (email: string, role: 'admin' | 'member'): Promise<string | null> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/auth/invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email || undefined, role }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccess(t('tenant.inviteCreated'));
        return data.code;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.inviteFailed'));
        return null;
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleCreateGuest = React.useCallback(async (
    email: string,
    guestName: string,
    expiresAt: string,
  ): Promise<{ magicLink: string } | null> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/guests`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: guestName || undefined, expiresAt }),
      });

      if (res.ok) {
        const data = await res.json();
        // Refetch guests list
        try {
          const guestsRes = await fetch(`${apiBase}/guests`, { credentials: 'include' });
          if (guestsRes.ok) {
            setGuests(await guestsRes.json());
          }
        } catch { /* ignore */ }
        return { magicLink: data.magicLink };
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.guestCreateFailed'));
        return null;
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleRevokeGuest = React.useCallback(async (membershipId: string): Promise<void> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/guests/${membershipId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setGuests(prev => prev.filter(g => g.id !== membershipId));
        setSuccess(t('tenant.guestRevoked'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.guestRemoveFailed'));
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleResetPassword = React.useCallback(async (email: string): Promise<string | null> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/auth/forgot`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (res.ok) {
        const data = await res.json();
        setSuccess(t('tenant.resetSuccess'));
        return data.token ?? data.resetToken ?? null;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.resetFailed'));
        return null;
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
      return null;
    } finally {
      setSaving(false);
    }
  }, [apiBase, t]);

  const handleEditMember = React.useCallback(async (userId: string, data: { email?: string; name?: string }): Promise<boolean> => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        await fetchData();
        setSuccess(t('tenant.editSuccess'));
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.editFailed'));
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [apiBase, t, fetchData]);

  const handleUpdateTenant = React.useCallback(async (data: { name?: string; defaultMapName?: string }): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/tenant`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setSuccess(t('tenant.updateSuccess'));
        return true;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.updateFailed'));
        return false;
      }
    } catch (e: unknown) {
      setError((e as Error).message || t('common.networkError'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [apiBase, t, fetchData]);

  return {
    tenant,
    members,
    guests,
    isEnterprise,
    loading,
    saving,
    error,
    success,
    setError,
    setSuccess,
    setSaving,
    setMembers,
    fetchData,
    handleChangeRole,
    handleRemoveMember,
    handleInvite,
    handleCreateGuest,
    handleRevokeGuest,
    handleResetPassword,
    handleEditMember,
    handleUpdateTenant,
  };
}
