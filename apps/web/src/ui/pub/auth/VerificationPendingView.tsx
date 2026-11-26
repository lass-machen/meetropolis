import { useCallback, useEffect, useRef } from 'react';
import { readAccountError } from '../../../lib/accountActionResponses';
import { clearPendingInvite } from '../../../lib/pendingInvite';
import { useTranslation } from 'react-i18next';
import { PubButton } from '../components';
import { useVerificationRequest } from '../../billing/hooks/useVerificationRequest';

export function VerificationPendingView({ apiBase }: { apiBase: string }) {
  const { t } = useTranslation('public');
  const request = useVerificationRequest(apiBase, true);
  /** In-flight /auth/me probe; null when idle. Abort on unmount or apiBase change. */
  const activeControllerRef = useRef<AbortController | null>(null);

  const checkStatus = useCallback(() => {
    if (activeControllerRef.current) return;
    const controller = new AbortController();
    activeControllerRef.current = controller;
    void fetch(`${apiBase}/auth/me`, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.ok) {
          const body = (await response.json().catch(() => null)) as { emailVerified?: unknown } | null;
          if (controller.signal.aborted) return;
          // Only a confirmed mailbox may leave the pending screen.
          if (body?.emailVerified === true) {
            clearPendingInvite();
            window.location.hash = '#/app';
          }
          return;
        }
        const errorBody: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (readAccountError(errorBody).code === 'ACCOUNT_LOGIN_REQUIRED') {
          window.location.hash = '#/login';
        }
      })
      .catch(() => {})
      .finally(() => {
        // Stale finally must not clear a newer probe's controller.
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      });
  }, [apiBase]);

  useEffect(() => {
    const onFocus = () => {
      checkStatus();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkStatus();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      const active = activeControllerRef.current;
      if (active) {
        active.abort();
        activeControllerRef.current = null;
      }
    };
  }, [checkStatus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h1 className="pub-text-h3">{t('auth.emailProof.title')}</h1>
      <p className="pub-text-body">{t('auth.emailProof.description')}</p>
      <p role="status">
        {request.errorMessage ?? t(`auth.emailProof.${request.state}`, { seconds: request.retryAfter })}
      </p>
      {request.state !== 'adminPending' && (
        <PubButton
          variant="primary"
          disabled={request.state === 'sending' || request.state === 'cooldown'}
          onClick={() => {
            void request.resend();
          }}
        >
          {t('auth.emailProof.resend')}
        </PubButton>
      )}
      <PubButton
        variant="secondary"
        onClick={() => {
          checkStatus();
        }}
      >
        {t('auth.emailProof.check')}
      </PubButton>
      <PubButton
        variant="secondary"
        onClick={() => {
          void fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' })
            .finally(() => {
              window.location.hash = '#/login';
            })
            .catch(() => {});
        }}
      >
        {t('auth.emailProof.login')}
      </PubButton>
    </div>
  );
}
