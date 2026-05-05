import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';
import { PRIVACY_POLICY_SECTIONS } from './data/privacyPolicySections';

interface PrivacyPolicyPageProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

export function PrivacyPolicyPage({ onBack, registrationEnabled }: PrivacyPolicyPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => { window.location.hash = `#/${route}`; };

  return (
    <LegalLayout
      title={t('legal.privacyTitle')}
      subtitle={t('legal.privacySubtitle')}
      breadcrumbLabel={t('legal.privacyTitle')}
      lastUpdated="10. April 2026"
      sections={PRIVACY_POLICY_SECTIONS}
      onBack={onBack}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    />
  );
}
