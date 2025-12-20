import React from 'react';
import { getApiBaseFromWindow } from '../../lib/apiBase';

interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  concurrentLimit: number;
  freeSeats: number;
  bypassLimits: boolean;
  isInternal: boolean;
  createdAt: string;
}

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: 'owner' | 'admin' | 'member';
}

export function TenantSettings({ onClose }: { onClose: () => void }) {
  const [tenant, setTenant] = React.useState<TenantInfo | null>(null);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [_tenantName, setTenantName] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'general' | 'members'>('general');

  // Invite
  const [showInvite, setShowInvite] = React.useState(false);
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<'admin' | 'member'>('member');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  const apiBase = getApiBaseFromWindow();

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, membersRes] = await Promise.all([
        fetch(`${apiBase}/billing/status`, { credentials: 'include' }),
        fetch(`${apiBase}/users`, { credentials: 'include' }),
      ]);

      if (statusRes.ok) {
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
        setTenantName(data.tenant.name);
      }

      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data || []);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Note: handleSaveTenant would need a PATCH /tenant endpoint - for now disabled

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/auth/invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail || undefined, role: inviteRole }),
      });

      if (res.ok) {
        const data = await res.json();
        setInviteCode(data.code);
        setSuccess('Invitation created');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to create invitation');
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: 'admin' | 'member') => {
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
        setMembers(members.map(m => m.id === userId ? { ...m, role: newRole } : m));
        setSuccess('Role updated');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to update role');
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setMembers(members.filter(m => m.id !== userId));
        setSuccess('Member removed');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to remove member');
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const copyInviteLink = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/#/?invite=${inviteCode}`;
    navigator.clipboard.writeText(link);
    setSuccess('Invite link copied to clipboard');
  };

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.loading}>Loading organization settings...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Organization Settings</h2>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab('general')}
            style={{ ...styles.tab, ...(activeTab === 'general' ? styles.tabActive : {}) }}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab('members')}
            style={{ ...styles.tab, ...(activeTab === 'members' ? styles.tabActive : {}) }}
          >
            Members ({members.length})
          </button>
        </div>

        <div style={styles.content}>
          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>{success}</div>}

          {activeTab === 'general' && tenant && (
            <>
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Organization Info</h3>

                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <span style={styles.infoLabel}>Subdomain</span>
                    <span style={styles.infoValue}>{tenant.slug}</span>
                  </div>
                  <div style={styles.infoItem}>
                    <span style={styles.infoLabel}>Name</span>
                    <span style={styles.infoValue}>{tenant.name}</span>
                  </div>
                  <div style={styles.infoItem}>
                    <span style={styles.infoLabel}>Seat Limit</span>
                    <span style={styles.infoValue}>
                      {tenant.bypassLimits ? 'Unlimited' : `${tenant.freeSeats + tenant.concurrentLimit} users`}
                    </span>
                  </div>
                </div>
              </div>

              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>Quick Actions</h3>
                <div style={styles.actionButtons}>
                  <button onClick={() => setActiveTab('members')} style={styles.secondaryBtn}>
                    Manage Members
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'members' && (
            <>
              <div style={styles.section}>
                <div style={styles.sectionHeader}>
                  <h3 style={styles.sectionTitle}>Team Members</h3>
                  <button onClick={() => setShowInvite(true)} style={styles.primaryBtn}>
                    Invite Member
                  </button>
                </div>

                <div style={styles.memberList}>
                  {members.map((member) => (
                    <div key={member.id} style={styles.memberItem}>
                      <div style={styles.memberInfo}>
                        <div style={styles.memberName}>{member.name || member.email}</div>
                        <div style={styles.memberEmail}>{member.email}</div>
                      </div>
                      <div style={styles.memberActions}>
                        <select
                          value={member.role}
                          onChange={(e) => handleChangeRole(member.id, e.target.value as 'admin' | 'member')}
                          disabled={member.role === 'owner' || saving}
                          style={styles.roleSelect}
                        >
                          <option value="owner" disabled>Owner</option>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                        {member.role !== 'owner' && (
                          <button
                            onClick={() => handleRemoveMember(member.id)}
                            disabled={saving}
                            style={styles.removeBtn}
                            title="Remove member"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Invite Modal */}
              {showInvite && (
                <div style={styles.inviteSection}>
                  <h4 style={styles.inviteTitle}>Invite New Member</h4>
                  {inviteCode ? (
                    <div style={styles.inviteSuccess}>
                      <p>Share this invite code:</p>
                      <div style={styles.inviteCodeBox}>
                        <code style={styles.inviteCode}>{inviteCode}</code>
                        <button onClick={copyInviteLink} style={styles.copyBtn}>Copy Link</button>
                      </div>
                      <button
                        onClick={() => {
                          setShowInvite(false);
                          setInviteCode(null);
                          setInviteEmail('');
                        }}
                        style={styles.secondaryBtn}
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleInvite}>
                      <div style={styles.field}>
                        <label style={styles.label}>Email (optional)</label>
                        <input
                          type="email"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          style={styles.input}
                          placeholder="user@example.com"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Role</label>
                        <select
                          value={inviteRole}
                          onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                          style={styles.input}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                      <div style={styles.buttonRow}>
                        <button
                          type="button"
                          onClick={() => setShowInvite(false)}
                          style={styles.cancelBtn}
                        >
                          Cancel
                        </button>
                        <button type="submit" disabled={saving} style={styles.primaryBtn}>
                          {saving ? 'Creating...' : 'Create Invite'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: 'var(--glass, rgba(30,30,30,0.95))',
    borderRadius: 16,
    border: '1px solid var(--border, rgba(255,255,255,0.1))',
    width: '90%',
    maxWidth: 600,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 24,
    cursor: 'pointer',
    color: 'var(--fg-subtle, #888)',
    padding: 0,
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    gap: 4,
    padding: '8px 16px',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  tab: {
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    fontWeight: 500,
  },
  tabActive: {
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
  },
  content: {
    padding: 20,
    overflowY: 'auto',
    flex: 1,
  },
  loading: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  error: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
    marginBottom: 16,
  },
  success: {
    padding: '10px 14px',
    background: 'rgba(34,197,94,0.15)',
    border: '1px solid rgba(34,197,94,0.3)',
    borderRadius: 8,
    color: '#22c55e',
    fontSize: 14,
    marginBottom: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  infoGrid: {
    display: 'grid',
    gap: 12,
  },
  infoItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  infoLabel: {
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
  },
  infoValue: {
    color: 'var(--fg, #fff)',
    fontSize: 14,
    fontWeight: 500,
  },
  actionButtons: {
    display: 'flex',
    gap: 12,
  },
  primaryBtn: {
    padding: '10px 20px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 8,
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    cursor: 'pointer',
  },
  memberList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  memberItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
    fontSize: 14,
  },
  memberEmail: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
  },
  memberActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  roleSelect: {
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid var(--border, rgba(255,255,255,0.2))',
    borderRadius: 6,
    color: 'var(--fg, #fff)',
    fontSize: 13,
    cursor: 'pointer',
  },
  removeBtn: {
    width: 28,
    height: 28,
    background: 'rgba(239,68,68,0.2)',
    border: 'none',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteSection: {
    marginTop: 16,
    padding: 16,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  inviteTitle: {
    margin: '0 0 16px',
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  inviteSuccess: {
    textAlign: 'center',
  },
  inviteCodeBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
    padding: '12px 16px',
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 8,
  },
  inviteCode: {
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 14,
    color: 'var(--accent, #3b82f6)',
    wordBreak: 'break-all',
  },
  copyBtn: {
    padding: '6px 12px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--fg, #fff)',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border, rgba(255,255,255,0.1))',
    borderRadius: 8,
    color: 'var(--fg, #fff)',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 12,
  },
};

export default TenantSettings;
