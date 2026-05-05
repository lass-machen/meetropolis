import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import type { TenantInfo, Member, Guest } from '../tenant/types';
import { translateApiError } from '../../../lib/apiErrors';
import { usePublicConfigStore } from '../../../state/publicConfigStore';

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

type TenantState = {
  tenant: TenantInfo | null;
  setTenant: React.Dispatch<React.SetStateAction<TenantInfo | null>>;
  members: Member[];
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  guests: Guest[];
  setGuests: React.Dispatch<React.SetStateAction<Guest[]>>;
  isEnterprise: boolean;
  setIsEnterprise: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  saving: boolean;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  success: string | null;
  setSuccess: React.Dispatch<React.SetStateAction<string | null>>;
};

function useTenantState(): TenantState {
  const [tenant, setTenant] = React.useState<TenantInfo | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [guests, setGuests] = React.useState<Guest[]>([]);
  const [isEnterprise, setIsEnterprise] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  return { tenant, setTenant, members, setMembers, guests, setGuests, isEnterprise, setIsEnterprise, loading, setLoading, saving, setSaving, error, setError, success, setSuccess };
}

function mapTenantInfo(data: any): TenantInfo {
  return {
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
  };
}

function useTenantFetch(state: TenantState, apiBase: string, t: (k: string) => string) {
  const { setTenant, setMembers, setGuests, setIsEnterprise, setLoading, setError } = state;
  return React.useCallback(async () => {
    setLoading(true);
    try {
      const billingEnabled = usePublicConfigStore.getState().billingEnabled;
      const [tenantRes, membersRes, statusRes] = await Promise.all([
        fetch(`${apiBase}/tenant`, { credentials: 'include' }),
        fetch(`${apiBase}/users`, { credentials: 'include' }),
        billingEnabled
          ? fetch(`${apiBase}/billing/status`, { credentials: 'include' })
          : Promise.resolve(new Response(null, { status: 404 })),
      ]);
      if (tenantRes.ok) {
        const data = await tenantRes.json();
        setTenant(mapTenantInfo(data));
      }
      if (statusRes.ok) {
        setIsEnterprise(true);
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
      if (membersRes.ok) setMembers(await membersRes.json() || []);
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
  }, [apiBase, t, setTenant, setMembers, setGuests, setIsEnterprise, setLoading, setError]);
}

function useMemberHandlers(state: TenantState, apiBase: string, t: (k: string) => string) {
  const { setSaving, setError, setSuccess, setMembers } = state;

  const handleChangeRole = React.useCallback(async (userId: string, newRole: 'admin' | 'member') => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/users/${userId}/role`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) });
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === userId ? { ...m, role: newRole } : m));
        setSuccess(t('tenant.roleUpdated'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.roleUpdateFailed'));
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setSuccess, setMembers]);

  const handleRemoveMember = React.useCallback(async (userId: string) => {
    if (!confirm(t('tenant.confirmRemoveMember'))) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/users/${userId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== userId));
        setSuccess(t('tenant.memberRemoved'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.removeFailed'));
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setSuccess, setMembers]);

  const handleInvite = React.useCallback(async (email: string, role: 'admin' | 'member'): Promise<string | null> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/invite`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email || undefined, role }) });
      if (res.ok) {
        const data = await res.json();
        setSuccess(t('tenant.inviteCreated'));
        return data.code;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.inviteFailed'));
        return null;
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); return null; }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setSuccess]);

  return { handleChangeRole, handleRemoveMember, handleInvite };
}

function useGuestHandlers(state: TenantState, apiBase: string, t: (k: string) => string) {
  const { setSaving, setError, setSuccess, setGuests } = state;

  const handleCreateGuest = React.useCallback(async (email: string, guestName: string, expiresAt: string): Promise<{ magicLink: string } | null> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/guests`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name: guestName || undefined, expiresAt }) });
      if (res.ok) {
        const data = await res.json();
        try {
          const guestsRes = await fetch(`${apiBase}/guests`, { credentials: 'include' });
          if (guestsRes.ok) setGuests(await guestsRes.json());
        } catch { /* ignore */ }
        return { magicLink: data.magicLink };
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.guestCreateFailed'));
        return null;
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); return null; }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setGuests]);

  const handleRevokeGuest = React.useCallback(async (membershipId: string): Promise<void> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/guests/${membershipId}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setGuests(prev => prev.filter(g => g.id !== membershipId));
        setSuccess(t('tenant.guestRevoked'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.guestRemoveFailed'));
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setSuccess, setGuests]);

  return { handleCreateGuest, handleRevokeGuest };
}

function useTenantMutations(state: TenantState, apiBase: string, t: (k: string) => string, fetchData: () => Promise<void>) {
  const { setSaving, setError, setSuccess } = state;

  const handleResetPassword = React.useCallback(async (email: string): Promise<string | null> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/auth/forgot`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (res.ok) {
        const data = await res.json();
        setSuccess(t('tenant.resetSuccess'));
        return data.token ?? data.resetToken ?? null;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('tenant.resetFailed'));
        return null;
      }
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); return null; }
    finally { setSaving(false); }
  }, [apiBase, t, setSaving, setError, setSuccess]);

  const handleEditMember = React.useCallback(async (userId: string, data: { email?: string; name?: string }): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/users/${userId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) { await fetchData(); setSuccess(t('tenant.editSuccess')); return true; }
      const err = await res.json().catch(() => ({}));
      setError(translateApiError(err.error) || t('tenant.editFailed'));
      return false;
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); return false; }
    finally { setSaving(false); }
  }, [apiBase, t, fetchData, setSaving, setError, setSuccess]);

  const handleUpdateTenant = React.useCallback(async (data: { name?: string; defaultMapName?: string }): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`${apiBase}/tenant`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) { await fetchData(); setSuccess(t('tenant.updateSuccess')); return true; }
      const err = await res.json().catch(() => ({}));
      setError(translateApiError(err.error) || t('tenant.updateFailed'));
      return false;
    } catch (e: unknown) { setError((e as Error).message || t('common.networkError')); return false; }
    finally { setSaving(false); }
  }, [apiBase, t, fetchData, setSaving, setError, setSuccess]);

  return { handleResetPassword, handleEditMember, handleUpdateTenant };
}

function useTenantHandlers(state: TenantState, apiBase: string, t: (k: string) => string, fetchData: () => Promise<void>) {
  const memberHandlers = useMemberHandlers(state, apiBase, t);
  const guestHandlers = useGuestHandlers(state, apiBase, t);
  const mutations = useTenantMutations(state, apiBase, t, fetchData);
  return { ...memberHandlers, ...guestHandlers, ...mutations };
}

export function useTenantSettings(): UseTenantSettingsReturn {
  const { t } = useTranslation();
  const apiBase = getApiBaseFromWindow();
  const state = useTenantState();
  const fetchData = useTenantFetch(state, apiBase, t);
  const handlers = useTenantHandlers(state, apiBase, t, fetchData);

  return {
    tenant: state.tenant,
    members: state.members,
    guests: state.guests,
    isEnterprise: state.isEnterprise,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    success: state.success,
    setError: state.setError,
    setSuccess: state.setSuccess,
    setSaving: state.setSaving,
    setMembers: state.setMembers,
    fetchData,
    ...handlers,
  };
}
