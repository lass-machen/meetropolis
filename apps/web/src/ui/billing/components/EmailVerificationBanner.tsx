import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button } from '../../system';
import { logger } from '../../../lib/logger';

interface Props {
  /** From `GET /auth/me`. Undefined while unknown — the banner stays away. */
  emailVerified: boolean | undefined;
  apiBase: string;
}

type SendState = 'idle' | 'sending' | 'sent' | 'failed';

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
  const [state, setState] = useState<SendState>('idle');

  if (emailVerified !== false) return null;

  async function resend() {
    setState('sending');
    try {
      const res = await fetch(`${apiBase}/auth/verify/request`, { method: 'POST', credentials: 'include' });
      // A throttled resend (2-minute cooldown) is not a failure the user needs
      // to act on: the mail they already have is still valid, so it reads as
      // sent either way.
      setState(res.ok || res.status === 429 ? 'sent' : 'failed');
    } catch (e) {
      logger.debug('[EmailVerificationBanner] resend failed', e);
      setState('failed');
    }
  }

  return (
    // No position/z-index here on purpose: this banner renders in normal document
    // flow, above the game surface (see WorldMainView's BannerAndGameLayout), so it
    // never needs to fight the top header bar for stacking order (A15).
    <Alert intent="info" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{state === 'sent' ? t('verifyBanner.sent') : t('verifyBanner.message')}</span>
      {state !== 'sent' && (
        <Button
          variant="primary"
          disabled={state === 'sending'}
          onClick={() => {
            void resend();
          }}
          style={{ marginLeft: 'auto', whiteSpace: 'nowrap', padding: '6px 14px', fontSize: 13 }}
        >
          {state === 'sending' ? t('verifyBanner.sending') : t('verifyBanner.resend')}
        </Button>
      )}
      {state === 'failed' && <span>{t('verifyBanner.failed')}</span>}
    </Alert>
  );
}
