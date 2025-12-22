import React from 'react';
import { getApiBaseFromWindow } from '../../lib/apiBase';

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export function ProfileSettings({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');

  // Password change
  const [showPasswordChange, setShowPasswordChange] = React.useState(false);
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');

  // Delete account
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('');

  const apiBase = getApiBaseFromWindow();

  React.useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setProfile(data.user || data);
          setName(data.user?.name || data.name || '');
          setEmail(data.user?.email || data.email || '');
        } else {
          setError('Failed to load profile');
        }
      } catch (e: unknown) {
        setError(e.message || 'Network error');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [apiBase]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`${apiBase}/me`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      });

      if (res.ok) {
        const data = await res.json();
        setProfile(data.user || data);
        setSuccess('Profile updated successfully');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to update profile');
      }
    } catch (e: unknown) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`${apiBase}/auth/change`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (res.ok) {
        setSuccess('Password changed successfully');
        setShowPasswordChange(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to change password');
      }
    } catch (e: unknown) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError('Please type DELETE to confirm');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${apiBase}/users/me`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        // Logout and redirect
        await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' });
        window.location.href = '/#/';
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || 'Failed to delete account');
      }
    } catch (e: unknown) {
      setError(e.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('de-DE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.loading}>Loading profile...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Profile Settings</h2>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

        <div style={styles.content}>
          {error && <div style={styles.error}>{error}</div>}
          {success && <div style={styles.success}>{success}</div>}

          {/* Profile Form */}
          <form onSubmit={handleSaveProfile} style={styles.section}>
            <h3 style={styles.sectionTitle}>Personal Information</h3>

            <div style={styles.field}>
              <label style={styles.label}>Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.input}
                placeholder="Your name"
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={styles.input}
                placeholder="your@email.com"
              />
              {profile?.emailVerifiedAt ? (
                <div style={styles.verified}>Verified on {formatDate(profile.emailVerifiedAt)}</div>
              ) : (
                <div style={styles.unverified}>Not verified</div>
              )}
            </div>

            <div style={styles.info}>
              <span style={styles.infoLabel}>Member since:</span>
              <span>{formatDate(profile?.createdAt || null)}</span>
            </div>

            <button type="submit" disabled={saving} style={styles.primaryBtn}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>

          {/* Password Change */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Security</h3>

            {!showPasswordChange ? (
              <button onClick={() => setShowPasswordChange(true)} style={styles.secondaryBtn}>
                Change Password
              </button>
            ) : (
              <form onSubmit={handleChangePassword} style={styles.passwordForm}>
                <div style={styles.field}>
                  <label style={styles.label}>Current Password</label>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    style={styles.input}
                    minLength={8}
                    required
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    style={styles.input}
                    minLength={8}
                    required
                  />
                </div>
                <div style={styles.buttonRow}>
                  <button type="button" onClick={() => setShowPasswordChange(false)} style={styles.cancelBtn}>
                    Cancel
                  </button>
                  <button type="submit" disabled={saving} style={styles.primaryBtn}>
                    {saving ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Data Export (GDPR) */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>Your Data (GDPR)</h3>
            <p style={styles.infoText}>
              Download a copy of all your personal data stored in Meetropolis.
            </p>
            <button
              onClick={async () => {
                try {
                  const res = await fetch(`${apiBase}/users/me/export`, { credentials: 'include' });
                  if (res.ok) {
                    const blob = await res.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `meetropolis-data-export-${Date.now()}.json`;
                    a.click();
                    window.URL.revokeObjectURL(url);
                    setSuccess('Data exported successfully');
                  } else {
                    setError('Failed to export data');
                  }
                } catch (e) {
                  setError('Export failed');
                }
              }}
              style={styles.secondaryBtn}
            >
              Export My Data
            </button>
          </div>

          {/* Danger Zone */}
          <div style={styles.dangerSection}>
            <h3 style={styles.sectionTitle}>Danger Zone</h3>
            <p style={styles.dangerText}>
              Deleting your account is permanent and cannot be undone. All your data will be removed.
            </p>

            {!showDeleteConfirm ? (
              <button onClick={() => setShowDeleteConfirm(true)} style={styles.dangerBtn}>
                Delete Account
              </button>
            ) : (
              <div style={styles.deleteConfirm}>
                <p style={styles.deleteWarning}>
                  Type <strong>DELETE</strong> to confirm account deletion:
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  style={styles.input}
                  placeholder="Type DELETE"
                />
                <div style={styles.buttonRow}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                    style={styles.cancelBtn}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={saving || deleteConfirmText !== 'DELETE'}
                    style={styles.dangerBtn}
                  >
                    {saving ? 'Deleting...' : 'Permanently Delete'}
                  </button>
                </div>
              </div>
            )}
          </div>
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
    maxWidth: 500,
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
  sectionTitle: {
    margin: '0 0 16px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
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
  verified: {
    marginTop: 6,
    fontSize: 12,
    color: '#22c55e',
  },
  unverified: {
    marginTop: 6,
    fontSize: 12,
    color: '#f59e0b',
  },
  info: {
    display: 'flex',
    gap: 8,
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
    marginBottom: 16,
  },
  infoLabel: {
    fontWeight: 500,
  },
  infoText: {
    margin: '0 0 12px',
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
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
  passwordForm: {
    marginTop: 12,
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 12,
  },
  dangerSection: {
    marginTop: 24,
    padding: 16,
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 12,
  },
  dangerText: {
    margin: '0 0 16px',
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
  },
  dangerBtn: {
    padding: '10px 20px',
    background: 'transparent',
    border: '1px solid #ef4444',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  deleteConfirm: {
    marginTop: 12,
  },
  deleteWarning: {
    margin: '0 0 12px',
    fontSize: 13,
    color: '#ef4444',
  },
};

export default ProfileSettings;
