import { useTranslation } from 'react-i18next';
import { PubBadge, PubButton } from '../components';
import { AuthMailIcon, AuthMessage } from './AuthFormPartials';
import { translateApiError } from '../../../lib/apiErrors';
import { useInviteAccept } from './hooks/useInviteAccept';

interface InviteAcceptViewProps {
  apiBase: string;
  code: string;
  onRegisterWithInvite: (code: string) => void;
}

export function InviteAcceptView({ apiBase, code, onRegisterWithInvite }: InviteAcceptViewProps) {
  const { t } = useTranslation('public');
  const { t: tCommon } = useTranslation('common');
  const invite = useInviteAccept({ apiBase, code, onRegisterWithInvite });

  if (invite.state === 'loading') {
    return (
      <p className="pub-text-body" style={{ margin: 0 }}>
        {t('auth.inviteAccept.loading')}
      </p>
    );
  }
  if (invite.state === 'not_found') {
    return <AuthMessage message={t('auth.inviteAccept.notFound')} messageType="error" />;
  }
  if (invite.state === 'error' || invite.preview === null) {
    return <AuthMessage message={invite.error ?? t('common.error')} messageType="error" />;
  }

  const preview = invite.preview;
  if (preview.status === 'expired') {
    return <AuthMessage message={translateApiError('invite_expired')} messageType="error" />;
  }
  if (preview.status === 'accepted') {
    return (
      <p className="pub-text-body" style={{ margin: 0 }}>
        {t('auth.inviteAccept.alreadyUsed')}
      </p>
    );
  }

  if (!invite.loggedIn) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <PubBadge variant="teal" icon={<AuthMailIcon />}>
          {t('auth.inviteBadge')}
        </PubBadge>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.inviteAccept.inviteTitle', { tenant: preview.tenantName })}
        </h1>
        <p className="pub-text-body" style={{ margin: 0 }}>
          {t('auth.inviteAccept.inviteForEmail', { email: preview.emailMasked })}
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <PubButton variant="primary" onClick={invite.goLogin} style={{ flex: 1 }}>
            {t('auth.inviteLoginLink')}
          </PubButton>
          <PubButton variant="secondary" onClick={invite.goRegister} style={{ flex: 1 }}>
            {t('auth.inviteRegisterLink')}
          </PubButton>
        </div>
      </div>
    );
  }

  const roleLabel = preview.role === 'admin' ? tCommon('tenant.roleAdmin') : tCommon('tenant.roleMember');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <PubBadge variant="teal" icon={<AuthMailIcon />}>
        {t('auth.inviteBadge')}
      </PubBadge>
      <h1 className="pub-text-h3" style={{ margin: 0 }}>
        {t('auth.inviteAccept.acceptTitle', { tenant: preview.tenantName })}
      </h1>
      <p className="pub-text-body" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
        {roleLabel}
      </p>
      <PubButton
        variant="primary"
        disabled={invite.accepting}
        onClick={() => {
          void invite.accept();
        }}
        style={{ width: '100%' }}
      >
        {t('auth.inviteAccept.acceptButton')}
      </PubButton>
      {invite.acceptError && <AuthMessage message={invite.acceptError} messageType="error" />}
    </div>
  );
}
