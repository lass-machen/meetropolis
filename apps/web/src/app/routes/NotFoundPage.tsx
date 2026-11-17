import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../../ui/pub/layout/PublicLayout';
import { PubCard } from '../../ui/pub/components/PubCard';
import { PubButton } from '../../ui/pub/components/PubButton';

export function NotFoundPage() {
  const { t } = useTranslation('common');

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout onLogin={() => navigate('login')} onSignup={() => navigate('register')} navigate={navigate}>
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
          <h2 className="pub-text-h4" style={{ margin: 0 }}>
            {t('notFound.title')}
          </h2>
          <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
            {t('notFound.body')}
          </p>
          <PubButton as="a" href="#/" variant="primary" style={{ marginTop: 8 }}>
            {t('notFound.backHome')}
          </PubButton>
        </PubCard>
      </div>
    </PublicLayout>
  );
}
