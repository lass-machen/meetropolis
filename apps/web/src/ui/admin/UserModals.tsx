import React from 'react';
import { Button, Input, Modal, Select } from '../../ui/system';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';
import { translateApiError } from '../../lib/apiErrors';
import type { ApiErrorBody, InviteResponse, UserManagementWindow } from './userManagementTypes';

export function CreateUserModal({
  open,
  onOpenChange,
  baseUrl,
  isOwner,
  setError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  baseUrl: string;
  isOwner: boolean;
  setError: (e: string | null) => void;
}) {
  const { t } = useTranslation();
  const [newEmail, setNewEmail] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [newRole, setNewRole] = React.useState<'admin' | 'member'>('member');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setInviteCode(null);
      setNewEmail('');
      setNewName('');
    }
  }, [open]);

  const handleInvite = async () => {
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/auth/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newEmail, name: newName || undefined, role: newRole }),
      });
      if (!res.ok) throw new Error(translateApiError(((await res.json()) as ApiErrorBody)?.error) || t('common.error'));
      const data = (await res.json()) as InviteResponse;
      setInviteCode(data.code || null);
      try {
        await (document as unknown as UserManagementWindow).__userManagementLoad?.();
      } catch (err) {
        logger.warn('[UserManagement] Failed to reload after invite', err);
      }
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : String(e)) || t('common.error'));
    }
  };

  return (
    <Modal
      zIndexBase={1100}
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setNewRole('member');
      }}
      title={t('admin.users.inviteTitle')}
      maxWidth={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('admin.users.cancel')}</Button>
          <Button
            variant="brand"
            onClick={() => {
              void handleInvite();
            }}
          >
            {t('admin.users.createInvite')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <Input
          placeholder={t('admin.users.emailAddress')}
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
        />
        <Input
          placeholder={t('admin.users.nameOptional')}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        {isOwner && (
          <div style={{ display: 'grid', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.role')}</label>
            <Select
              value={newRole}
              onChange={(val) => setNewRole(val as 'admin' | 'member')}
              options={[
                { value: 'member', label: t('admin.users.roleMember') },
                { value: 'admin', label: t('admin.users.roleAdmin') },
              ]}
            />
            <div style={{ fontSize: 11, color: 'var(--fg-subtle)' }}>{t('admin.users.adminInvitesHint')}</div>
          </div>
        )}
        {inviteCode && (
          <div
            className="glass-surface"
            style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
          >
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteCode')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                {inviteCode}
              </div>
              <Button
                onClick={() => {
                  void navigator.clipboard?.writeText(inviteCode);
                }}
              >
                {t('admin.users.copy')}
              </Button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.inviteHint')}</div>
      </div>
    </Modal>
  );
}

export function ResetModal({
  open,
  onOpenChange,
  resetFor,
  resetToken,
  resetUrl,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resetFor: { id: string; email: string } | null;
  resetToken: string | null;
  resetUrl: string | null;
}) {
  const { t } = useTranslation();
  const copyToken = () => {
    try {
      if (resetToken) void navigator.clipboard?.writeText(resetToken);
    } catch {}
  };
  const copyUrl = () => {
    try {
      if (resetUrl) void navigator.clipboard?.writeText(resetUrl);
    } catch {}
  };
  return (
    <Modal
      zIndexBase={1100}
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.users.resetTitle')}
      maxWidth={520}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t('admin.users.close')}</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div
          className="glass-surface"
          style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
        >
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.resetToken')}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--border)',
                background: 'var(--glass)',
                color: 'var(--fg)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontWeight: 700,
                letterSpacing: '0.06em',
                wordBreak: 'break-all',
              }}
            >
              {resetToken || '—'}
            </div>
            {resetToken && <Button onClick={copyToken}>{t('admin.users.copy')}</Button>}
          </div>
        </div>
        {resetUrl && (
          <div
            className="glass-surface"
            style={{ padding: 12, borderRadius: 'var(--radius-sm)', display: 'grid', gap: 8 }}
          >
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>{t('admin.users.resetLink')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--border)',
                  background: 'var(--glass)',
                  color: 'var(--fg)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                }}
              >
                {resetUrl}
              </div>
              <Button onClick={copyUrl}>{t('admin.users.copy')}</Button>
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>
          {t('admin.users.resetHint')}
          {resetFor?.email ? ` (${resetFor.email})` : ''}
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-subtle)', borderLeft: '2px solid var(--accent)', paddingLeft: 8 }}>
          {t('admin.users.resetWarning')}
        </div>
      </div>
    </Modal>
  );
}
