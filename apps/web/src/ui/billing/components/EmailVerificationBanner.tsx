import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../system';
import { useVerificationRequest } from '../hooks/useVerificationRequest';

interface Props {
  /** From `GET /auth/me`. Undefined while unknown — the banner stays away. */
  emailVerified: boolean | undefined;
  apiBase: string;
}

/**
 * Soft reminder for an unverified address.
 *
 * Deliberately a nudge, not a gate: unverified users keep full access (the
 * server returns a plain 200 for them). Someone who just paid must not be
 * locked out over an unread mail, so this asks and gets out of the way.
 *
 * Renders nothing until `/auth/me` has actually reported the status, so a
 * verified user never sees a flash of it while the request is in flight.
 */
export function EmailVerificationBanner({ emailVerified, apiBase }: Props) {
  const { t } = useTranslation();
  const { state, retryAfter, resend } = useVerificationRequest(apiBase);

  if (emailVerified !== false) return null;

  return (
    // No position/z-index here on purpose: this banner renders in normal document
    // flow, above the game surface (see WorldMainView's BannerAndGameLayout), so it
    // never needs to fight the top header bar for stacking order (A15).
    <Alert intent="info" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{state === 'sent' ? t('verifyBanner.sent') : t('verifyBanner.message')}</span>
      {state !== 'sent' && (
        <Button
          variant="primary"
          disabled={state === 'sending' || state === 'cooldown'}
          onClick={() => {
            void resend();
          }}
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap', padding: '6px 14px', fontSize: 13 }}
        >
          {state === 'sending' ? t('verifyBanner.sending') : t('verifyBanner.resend')}
        </Button>
      )}
      {(state === 'failed' || state === 'loginRequired') && <span>{t('verifyBanner.failed')}</span>}
      {state === 'cooldown' && <span role="status">{t('verifyBanner.cooldown', { seconds: retryAfter })}</span>}
    </Alert>
  );
}
