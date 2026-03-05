import React from 'react';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import type { TenantInfo, Member, Guest } from '../tenant/types';

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
}

export function useTenantSettings(): UseTenantSettingsReturn {
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
      const [statusRes, membersRes] = await Promise.all([
        fetch(`${apiBase}/billing/status`, { credentials: 'include' }),
        fetch(`${apiBase}/users`, { credentials: 'include' }),
      ]);

      let enterprise = false;
      if (statusRes.ok) {
        enterprise = true;
        setIsEnterprise(true);
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

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data || []);
      }

      // Fetch guests only for enterprise tenants
      if (enterprise) {
        try {
          const guestsRes = await fetch(`${apiBase}/guests`, { credentials: 'include' });
          if (guestsRes.ok) {
            const guestsData = await guestsRes.json();
            setGuests(guestsData || []);
          }
        } catch { /* guests endpoint may not exist yet */ }
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

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
        setSuccess('Role updated');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to update role');
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Network error');
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

  const handleRemoveMember = React.useCallback(async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setMembers(prev => prev.filter(m => m.id !== userId));
        setSuccess('Member removed');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to remove member');
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Network error');
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

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
        setSuccess('Invitation created');
        return data.code;
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to create invitation');
        return null;
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Network error');
      return null;
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

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
        setError(err.error || 'Gast konnte nicht erstellt werden');
        return null;
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Netzwerkfehler');
      return null;
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

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
        setSuccess('Gast-Zugang widerrufen');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Gast konnte nicht entfernt werden');
      }
    } catch (e: unknown) {
      setError((e as Error).message || 'Netzwerkfehler');
    } finally {
      setSaving(false);
    }
  }, [apiBase]);

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
  };
}
