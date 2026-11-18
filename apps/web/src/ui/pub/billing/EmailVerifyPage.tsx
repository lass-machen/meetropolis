import React from 'react';
import { readAccountError, readProofResult } from '../../../lib/accountActionResponses';
import { clearPendingInvite } from '../../../lib/pendingInvite';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { PubButton } from '../components/PubButton';

interface EmailVerifyPageProps {
  token?: string | undefined;
  apiBase: string;
  onSuccess: () => void;
  onBack: () => void;
}

function CheckCircleIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="var(--pub-icon-bg-teal)" />
      <path
        d="M16 24L22 30L32 18"
        stroke="var(--pub-accent-teal)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="var(--pub-icon-bg-red)" />
      <path
        d="M18 18L30 30M30 18L18 30"
        stroke="#EF4444"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: 'pub-spin 1s linear infinite' }}
    >
      <circle cx="24" cy="24" r="20" stroke="var(--pub-border-light)" strokeWidth="4" />
      <path
        d="M44 24C44 12.954 35.046 4 24 4"
        stroke="var(--pub-accent-purple)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

type VerifyStatus = 'verifying' | 'success' | 'error';

function useEmailVerify(token: string | undefined, apiBase: string) {
  const { t } = useTranslation('public');
  const [status, setStatus] = React.useState<VerifyStatus>('verifying');
  const [message, setMessage] = React.useState('');
  const [purpose, setPurpose] = React.useState<'invite' | 'verify' | 'email_change'>('verify');
  const inFlight = React.useRef<{ token: string; promise: Promise<{ ok: boolean; body: unknown }> } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus('error');
      setMessage(t('verify.noToken'));
      return;
    }
    // Run once per mount, including React effect replays. Do not retry a single-use proof.
    if (inFlight.current?.token !== token)
      inFlight.current = {
        token,
        promise: fetch(`${apiBase}/auth/verify`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
          .then(async (response) => ({ ok: response.ok, body: (await response.json().catch(() => null)) as unknown }))
          .finally(() => {
            if (inFlight.current?.token === token) window.history.replaceState(null, '', '#/verify');
          }),
      };
    const active = inFlight.current;
    if (!active) return;
    void active.promise
      .then(({ ok, body }) => {
        if (cancelled) return;
        const result = readProofResult(body);
        if (ok && result) {
          setPurpose(result.purpose);
          setStatus('success');
          if (result.purpose === 'invite') clearPendingInvite();
        } else {
          setStatus('error');
          const error = readAccountError(body);
          setMessage(
            error.code === 'EMAIL_PROOF_INVALID' ? t('verify.invalidLink') : (error.message ?? t('verify.errorTitle')),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          setMessage(t('verify.errorTitle'));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, apiBase, t]);
  return { status, message, purpose };
}

function VerifyingState() {
  const { t } = useTranslation('public');
  return (
    <>
      <Spinner />
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('verify.verifyingTitle')}
      </h2>
    </>
  );
}

function SuccessState({
  purpose,
  onContinue,
}: {
  purpose: 'invite' | 'verify' | 'email_change';
  onContinue: () => void;
}) {
  const { t } = useTranslation('public');
  return (
    <>
      <CheckCircleIcon />
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t(`verify.${purpose}.title`)}
      </h2>
      <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
        {t(`verify.${purpose}.text`)}
      </p>
      <PubButton variant="primary" onClick={onContinue}>
        {t('verify.continue')}
      </PubButton>
    </>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  const { t } = useTranslation('public');
  return (
    <>
      <XCircleIcon />
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('verify.errorTitle')}
      </h2>
      <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
        {message}
      </p>
      <PubButton variant="primary" onClick={onBack} style={{ marginTop: 8 }}>
        {t('verify.backButton')}
      </PubButton>
    </>
  );
}

const VERIFY_CARD_STYLE: React.CSSProperties = {
  maxWidth: 480,
  width: '100%',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  padding: '48px 40px',
};

const VERIFY_WRAPPER_STYLE: React.CSSProperties = {
  minHeight: 'calc(100vh - 160px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'var(--pub-section-padding)',
};

export function EmailVerifyPage({ token, apiBase, onSuccess, onBack }: EmailVerifyPageProps) {
  const { status, message, purpose } = useEmailVerify(token, apiBase);
  const continueAfterProof = async () => {
    try {
      const response = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (response.ok) {
        window.location.hash = '#/app';
        return;
      }
    } catch {
      /* Require sign-in unless usable access has been proven. */
    }
    onSuccess();
  };

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout onLogin={() => navigate('app')} onSignup={() => navigate('register')} navigate={navigate}>
      <style>{`
        @keyframes pub-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={VERIFY_WRAPPER_STYLE}>
        <PubCard variant="surface" style={VERIFY_CARD_STYLE}>
          {status === 'verifying' && <VerifyingState />}
          {status === 'success' && (
            <SuccessState
              purpose={purpose}
              onContinue={() => {
                void continueAfterProof();
              }}
            />
          )}
          {status === 'error' && <ErrorState message={message} onBack={onBack} />}
        </PubCard>
      </div>
    </PublicLayout>
  );
}
