import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';
import { TERMS_OF_SERVICE_SECTIONS } from './data/termsOfServiceSections';

interface TermsOfServicePageProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

export function TermsOfServicePage({ onBack, registrationEnabled }: TermsOfServicePageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => { window.location.hash = `#/${route}`; };

  return (
    <LegalLayout
      title={t('legal.termsTitle')}
      subtitle={t('legal.termsSubtitle')}
      breadcrumbLabel={t('legal.termsTitle')}
      lastUpdated="31. März 2026"
      sections={TERMS_OF_SERVICE_SECTIONS}
      onBack={onBack}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    />
  );
}
