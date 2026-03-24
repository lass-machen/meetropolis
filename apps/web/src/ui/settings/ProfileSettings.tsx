import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { AvatarSettings } from './AvatarSettings';
import { gameBridge } from '../../game/bridge';
import { translateApiError } from '../../lib/apiErrors';

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export function ProfileSettings({ onClose: _onClose, colyseusRef }: { onClose: () => void; colyseusRef?: React.RefObject<any> | undefined }) {
  const { t } = useTranslation();
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

  // Avatar
  const [avatarId, setAvatarId] = React.useState(localStorage.getItem('avatarId') || 'default-characters:businessman1');

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
          // Sync avatar from server response
          const serverAvatarId = data.user?.avatarId || data.avatarId;
          if (serverAvatarId) {
            setAvatarId(serverAvatarId);
            localStorage.setItem('avatarId', serverAvatarId);
          }
        } else {
          setError(t('profile.loadFailed'));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : t('common.networkError'));
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
        setSuccess(t('profile.updateSuccess'));
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('profile.updateFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.networkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t('profile.passwordMismatch'));
      return;
    }
    if (newPassword.length < 8) {
      setError(t('profile.passwordTooShort'));
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
        setSuccess(t('profile.passwordChangeSuccess'));
        setShowPasswordChange(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        const err = await res.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('profile.passwordChangeFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.networkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') {
      setError(t('profile.typeDeleteConfirm'));
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
        setError(translateApiError(err.error) || t('profile.deleteFailed'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.networkError'));
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = async (newAvatarId: string) => {
    try {
      const res = await fetch(`${apiBase}/me/avatar`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarId: newAvatarId }),
      });
      if (res.ok) {
        setAvatarId(newAvatarId);
        localStorage.setItem('avatarId', newAvatarId);
        gameBridge.changeHeroAvatar(newAvatarId);
        // Notify other clients via Colyseus so their UI updates in real-time
        try {
          (colyseusRef as any)?.current?.send?.('avatar_change', { avatarId: newAvatarId });
        } catch {}
        setSuccess(t('profile.avatarUpdated'));
      } else {
        setError(t('profile.avatarFailed'));
      }
    } catch {
      setError(t('profile.avatarFailed'));
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
    return <div style={styles.loading}>{t('profile.loading')}</div>;
  }

  return (
    <div style={styles.content}>
      {error && <div style={styles.error}>{error}</div>}
      {success && <div style={styles.success}>{success}</div>}

      {/* Profile Form */}
      <form onSubmit={handleSaveProfile} style={styles.section}>
        <h3 style={styles.sectionTitle}>{t('profile.personalInfo')}</h3>

        <div style={styles.field}>
          <label style={styles.label}>{t('profile.displayName')}</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={styles.input}
            placeholder={t('profile.namePlaceholder')}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>{t('profile.emailAddress')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
            placeholder="your@email.com"
          />
          {profile?.emailVerifiedAt ? (
            <div style={styles.verified}>{t('profile.verifiedOn', { date: formatDate(profile.emailVerifiedAt) })}</div>
          ) : (
            <div style={styles.unverified}>{t('profile.notVerified')}</div>
          )}
        </div>

        <div style={styles.info}>
          <span style={styles.infoLabel}>{t('profile.memberSince')}:</span>
          <span>{formatDate(profile?.createdAt || null)}</span>
        </div>

        <button type="submit" disabled={saving} style={styles.primaryBtn}>
          {saving ? t('profile.saving') : t('profile.saveChanges')}
        </button>
      </form>

      {/* Avatar */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t('profile.avatar')}</h3>
        <AvatarSettings currentAvatarId={avatarId} onAvatarChange={handleAvatarChange} />
      </div>

      {/* Password Change */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t('profile.security')}</h3>

        {!showPasswordChange ? (
          <button onClick={() => setShowPasswordChange(true)} style={styles.secondaryBtn}>
            {t('profile.changePassword')}
          </button>
        ) : (
          <form onSubmit={handleChangePassword} style={styles.passwordForm}>
            <div style={styles.field}>
              <label style={styles.label}>{t('profile.currentPassword')}</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                style={styles.input}
                required
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>{t('profile.newPassword')}</label>
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
              <label style={styles.label}>{t('profile.confirmNewPassword')}</label>
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
                {t('profile.cancel')}
              </button>
              <button type="submit" disabled={saving} style={styles.primaryBtn}>
                {saving ? t('profile.changing') : t('profile.changePassword')}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Data Export (GDPR) */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>{t('profile.gdprTitle')}</h3>
        <p style={styles.infoText}>
          {t('profile.gdprDesc')}
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
                setSuccess(t('profile.exportSuccess'));
              } else {
                setError(t('profile.exportDataFailed'));
              }
            } catch (e) {
              setError(t('profile.exportFailed'));
            }
          }}
          style={styles.secondaryBtn}
        >
          {t('profile.exportData')}
        </button>
      </div>

      {/* Danger Zone */}
      <div style={styles.dangerSection}>
        <h3 style={styles.sectionTitle}>{t('profile.dangerZone')}</h3>
        <p style={styles.dangerText}>
          {t('profile.deleteWarning')}
        </p>

        {!showDeleteConfirm ? (
          <button onClick={() => setShowDeleteConfirm(true)} style={styles.dangerBtn}>
            {t('profile.deleteAccount')}
          </button>
        ) : (
          <div style={styles.deleteConfirm}>
            <p style={styles.deleteWarning}>
              {t('profile.typeDeletePrompt')}
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              style={styles.input}
              placeholder={t('profile.typeDeletePlaceholder')}
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
                {t('profile.cancel')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={saving || deleteConfirmText !== 'DELETE'}
                style={styles.dangerBtn}
              >
                {saving ? t('profile.deleting') : t('profile.permanentlyDelete')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  content: {
    padding: 20,
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
