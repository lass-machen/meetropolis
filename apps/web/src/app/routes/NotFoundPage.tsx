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
      <div className="pub-not-found">
        <PubCard variant="surface" className="pub-not-found__card">
          <h2 className="pub-text-h4 pub-not-found__title">{t('notFound.title')}</h2>
          <p className="pub-text-body pub-not-found__body">{t('notFound.body')}</p>
          <PubButton as="a" href="#/" variant="primary" className="pub-not-found__action">
            {t('notFound.backHome')}
          </PubButton>
        </PubCard>
      </div>
    </PublicLayout>
  );
}
