import React from 'react';
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
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
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
      <circle
        cx="24"
        cy="24"
        r="20"
        stroke="var(--pub-border-light)"
        strokeWidth="4"
      />
      <path
        d="M44 24C44 12.954 35.046 4 24 4"
        stroke="var(--pub-accent-purple)"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function EmailVerifyPage({
  token,
  apiBase,
  onSuccess,
  onBack,
}: EmailVerifyPageProps) {
  const { t } = useTranslation('public');
  const [status, setStatus] = React.useState<'verifying' | 'success' | 'error'>(
    'verifying',
  );
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage(t('verify.noToken'));
      return;
    }

    const verify = async () => {
      try {
        const res = await fetch(`${apiBase}/auth/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ token }),
        });

        if (res.ok) {
          setStatus('success');
          setMessage(t('verify.successText'));
          setTimeout(onSuccess, 2000);
        } else {
          const data = await res.json().catch(() => ({}));
          setStatus('error');
          setMessage(data.error || t('verify.errorTitle'));
        }
      } catch (e: unknown) {
        setStatus('error');
        setMessage((e as Error)?.message || t('verify.errorTitle'));
      }
    };

    verify();
  }, [token, apiBase, onSuccess, t]);

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout
      onLogin={() => navigate('app')}
      onSignup={() => navigate('register')}
      navigate={navigate}
    >
      <style>{`
        @keyframes pub-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        style={{
          minHeight: 'calc(100vh - 160px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--pub-section-padding)',
        }}
      >
        <PubCard
          variant="surface"
          style={{
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '48px 40px',
          }}
        >
          {status === 'verifying' && (
            <>
              <Spinner />
              <h2 className="pub-text-h4" style={{ margin: 0 }}>
                {t('verify.verifyingTitle')}
              </h2>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircleIcon />
              <h2 className="pub-text-h4" style={{ margin: 0 }}>
                {t('verify.successTitle')}
              </h2>
              <p
                className="pub-text-body"
                style={{ color: 'var(--pub-text-secondary)', margin: 0 }}
              >
                {t('verify.successText')}
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircleIcon />
              <h2 className="pub-text-h4" style={{ margin: 0 }}>
                {t('verify.errorTitle')}
              </h2>
              <p
                className="pub-text-body"
                style={{ color: 'var(--pub-text-secondary)', margin: 0 }}
              >
                {message}
              </p>
              <PubButton variant="primary" onClick={onBack} style={{ marginTop: 8 }}>
                {t('verify.backButton')}
              </PubButton>
            </>
          )}
        </PubCard>
      </div>
    </PublicLayout>
  );
}
