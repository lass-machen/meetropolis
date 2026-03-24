import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../lib/apiBase';
import { AvatarSettings } from './AvatarSettings';
import { gameBridge } from '../../game/bridge';
import { translateApiError } from '../../lib/apiErrors';
import { Button, Input, Alert, Section, Badge, Card } from '../system';

interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  emailVerifiedAt: string | null;
  createdAt: string;
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--fg, #fff)',
};

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
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>{t('profile.loading')}</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      {error && <Alert intent="error" onDismiss={() => setError(null)} style={{ marginBottom: 16 }}>{error}</Alert>}
      {success && <Alert intent="success" onDismiss={() => setSuccess(null)} style={{ marginBottom: 16 }}>{success}</Alert>}

      {/* Profile Form */}
      <form onSubmit={handleSaveProfile}>
        <Section title={t('profile.personalInfo')}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('profile.displayName')}</label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('profile.namePlaceholder')}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{t('profile.emailAddress')}</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
            <div style={{ marginTop: 6 }}>
              {profile?.emailVerifiedAt ? (
                <Badge intent="success">{t('profile.verifiedOn', { date: formatDate(profile.emailVerifiedAt) })}</Badge>
              ) : (
                <Badge intent="warning">{t('profile.notVerified')}</Badge>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, fontSize: 13, color: 'var(--fg-subtle, #888)', marginBottom: 16 }}>
            <span style={{ fontWeight: 500 }}>{t('profile.memberSince')}:</span>
            <span>{formatDate(profile?.createdAt || null)}</span>
          </div>

          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? t('profile.saving') : t('profile.saveChanges')}
          </Button>
        </Section>
      </form>

      {/* Avatar */}
      <Section title={t('profile.avatar')}>
        <AvatarSettings currentAvatarId={avatarId} onAvatarChange={handleAvatarChange} />
      </Section>

      {/* Password Change */}
      <Section title={t('profile.security')}>
        {!showPasswordChange ? (
          <Button variant="secondary" onClick={() => setShowPasswordChange(true)}>
            {t('profile.changePassword')}
          </Button>
        ) : (
          <form onSubmit={handleChangePassword} style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{t('profile.currentPassword')}</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{t('profile.newPassword')}</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>{t('profile.confirmNewPassword')}</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <Button type="button" variant="ghost" onClick={() => setShowPasswordChange(false)}>
                {t('profile.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('profile.changing') : t('profile.changePassword')}
              </Button>
            </div>
          </form>
        )}
      </Section>

      {/* Data Export (GDPR) */}
      <Section title={t('profile.gdprTitle')}>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--fg-subtle, #888)' }}>
          {t('profile.gdprDesc')}
        </p>
        <Button
          variant="secondary"
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
        >
          {t('profile.exportData')}
        </Button>
      </Section>

      {/* Danger Zone */}
      <Card style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', marginTop: 24 }}>
        <Section title={t('profile.dangerZone')} style={{ marginBottom: 0 }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--fg-subtle, #888)' }}>
            {t('profile.deleteWarning')}
          </p>

          {!showDeleteConfirm ? (
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              {t('profile.deleteAccount')}
            </Button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#ef4444' }}>
                {t('profile.typeDeletePrompt')}
              </p>
              <Input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t('profile.typeDeletePlaceholder')}
              />
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteConfirmText('');
                  }}
                >
                  {t('profile.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDeleteAccount}
                  disabled={saving || deleteConfirmText !== 'DELETE'}
                >
                  {saving ? t('profile.deleting') : t('profile.permanentlyDelete')}
                </Button>
              </div>
            </div>
          )}
        </Section>
      </Card>
    </div>
  );
}

export default ProfileSettings;
