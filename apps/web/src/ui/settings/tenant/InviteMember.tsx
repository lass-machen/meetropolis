import React from 'react';
import { useTranslation } from 'react-i18next';
import { translateApiError } from '../../../lib/apiErrors';
import { Button, Input, Select, Card } from '../../system';

interface InviteMemberProps {
  saving: boolean;
  onInvite: (
    email: string,
    role: 'admin' | 'member',
  ) => Promise<{ email: string; inviteUrl: string | null; emailSent: boolean; expiresAt: string | null } | null>;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function InviteMember({ saving, onInvite, onClose, onSuccess, onError }: InviteMemberProps) {
  const { t } = useTranslation();
  const [inviteEmail, setInviteEmail] = React.useState('');
  const [inviteRole, setInviteRole] = React.useState<'admin' | 'member'>('member');
  const [invite, setInvite] = React.useState<{
    email: string;
    inviteUrl: string | null;
    emailSent: boolean;
    expiresAt: string | null;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const createdInvite = await onInvite(inviteEmail, inviteRole);
    if (createdInvite) setInvite(createdInvite);
  };

  const copyInviteLink = async () => {
    if (!invite) return;
    if (!invite.inviteUrl) {
      onError(translateApiError('public_base_url_missing'));
      return;
    }
    try {
      await navigator.clipboard.writeText(invite.inviteUrl);
      onSuccess(t('tenant.linkCopied'));
    } catch {
      onError(t('tenant.linkCopyFailed'));
    }
  };

  const handleClose = () => {
    setInvite(null);
    setInviteEmail('');
    setInviteRole('member');
    onClose();
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600, color: 'var(--fg, #fff)' }}>
        {t('tenant.inviteNewMember')}
      </h4>
      {invite ? (
        <div style={{ textAlign: 'center' }}>
          <p>
            {invite.emailSent
              ? t('tenant.inviteSentTo', { email: invite.email })
              : t('tenant.inviteResendNotDelivered')}
          </p>
          <Card
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
              padding: '12px 16px',
              background: 'rgba(0,0,0,0.3)',
            }}
          >
            <code
              style={{
                flex: 1,
                fontFamily: 'monospace',
                fontSize: 14,
                color: 'var(--accent, #3b82f6)',
                wordBreak: 'break-all',
              }}
            >
              {invite.inviteUrl}
            </code>
            <Button
              variant="primary"
              onClick={() => {
                void copyInviteLink();
              }}
              style={{ fontSize: 12, padding: '6px 12px' }}
            >
              {t('tenant.copyLink')}
            </Button>
          </Card>
          <Button variant="secondary" onClick={handleClose}>
            {t('tenant.done')}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <label
              style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--fg, #fff)' }}
            >
              {t('tenant.inviteEmail')}
            </label>
            <Input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder={t('tenant.emailPlaceholder')}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label
              style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500, color: 'var(--fg, #fff)' }}
            >
              {t('tenant.role')}
            </label>
            <Select
              value={inviteRole}
              onChange={(val) => setInviteRole(val as 'admin' | 'member')}
              options={[
                { value: 'member', label: t('tenant.roleMember') },
                { value: 'admin', label: t('tenant.roleAdmin') },
              ]}
            />
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <Button variant="ghost" type="button" onClick={handleClose}>
              {t('tenant.cancel')}
            </Button>
            <Button variant="primary" type="submit" disabled={saving || inviteEmail.trim().length === 0}>
              {saving ? t('tenant.creating') : t('tenant.createInvite')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
