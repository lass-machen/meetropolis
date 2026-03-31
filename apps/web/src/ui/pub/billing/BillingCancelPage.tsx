import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { PubButton } from '../components/PubButton';

interface BillingCancelPageProps {
  onNavigate: () => void;
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

export function BillingCancelPage({ onNavigate }: BillingCancelPageProps) {
  const { t } = useTranslation('public');

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
          <XCircleIcon />
          <h2 className="pub-text-h4" style={{ margin: 0 }}>
            {t('billing.cancelTitle')}
          </h2>
          <p
            className="pub-text-body"
            style={{ color: 'var(--pub-text-secondary)', margin: 0 }}
          >
            {t('billing.cancelText')}
          </p>
          <PubButton variant="primary" onClick={onNavigate} style={{ marginTop: 8 }}>
            {t('billing.cancelButton')}
          </PubButton>
        </PubCard>
      </div>
    </PublicLayout>
  );
}
