import React from 'react';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { PubButton } from '../components/PubButton';

interface BillingSuccessPageProps {
  onNavigate: () => void;
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

export function BillingSuccessPage({ onNavigate }: BillingSuccessPageProps) {
  const { t } = useTranslation('public');

  React.useEffect(() => {
    const timer = setTimeout(onNavigate, 4000);
    return () => clearTimeout(timer);
  }, [onNavigate]);

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout
      onLogin={() => navigate('app')}
      onSignup={() => navigate('signup')}
      navigate={navigate}
    >
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
          <CheckCircleIcon />
          <h2 className="pub-text-h4" style={{ margin: 0 }}>
            {t('billing.successTitle')}
          </h2>
          <p
            className="pub-text-body"
            style={{ color: 'var(--pub-text-secondary)', margin: 0 }}
          >
            {t('billing.successText')}
          </p>
          <PubButton variant="primary" onClick={onNavigate} style={{ marginTop: 8 }}>
            {t('billing.successButton')}
          </PubButton>
        </PubCard>
      </div>
    </PublicLayout>
  );
}
