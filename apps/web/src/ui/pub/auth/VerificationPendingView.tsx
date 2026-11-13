import { readAccountError } from '../../../lib/accountActionResponses';
import { clearPendingInvite } from '../../../lib/pendingInvite';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components';
import { useVerificationRequest } from '../../billing/hooks/useVerificationRequest';

export function VerificationPendingView({ apiBase }: { apiBase: string }) {
  const { t } = useTranslation('public');
  const request = useVerificationRequest(apiBase, true);
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
    <h1 className="pub-text-h3">{t('auth.emailProof.title')}</h1>
    <p className="pub-text-body">{t('auth.emailProof.description')}</p>
    <p role="status">
      {request.errorMessage ?? t(`auth.emailProof.${request.state}`, { seconds: request.retryAfter })}
    </p>
    <PubButton
      variant="primary"
      disabled={request.state === 'sending' || request.state === 'cooldown'}
      onClick={() => { void request.resend(); }}
    >
      {t('auth.emailProof.resend')}
    </PubButton>
    <PubButton
      variant="secondary"
      onClick={() => {
        void fetch(`${apiBase}/auth/me`, { credentials: 'include' }).then(async (response) => {
          if (response.ok) {
            clearPendingInvite();
            window.location.hash = '#/app';
          } else if (readAccountError(await response.json().catch(() => null)).code === 'ACCOUNT_LOGIN_REQUIRED')
            window.location.hash = '#/login';
        }).catch(() => {});
      }}
    >
      {t('auth.emailProof.check')}
    </PubButton>
    <PubButton
      variant="secondary"
      onClick={() => {
        void fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => {
          window.location.hash = '#/login';
        }).catch(() => {});
      }}
    >
      {t('auth.emailProof.login')}
    </PubButton>
  </div>;
}
