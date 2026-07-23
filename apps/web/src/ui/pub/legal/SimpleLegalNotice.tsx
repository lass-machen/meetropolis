import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { PubButton } from '../components/PubButton';

interface SimpleLegalNoticeProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

/**
 * OSS-Fallback fuer rechtliche Seiten (/privacy, /terms, /impressum).
 *
 * Wird im OSS-Build gerendert, wenn das Brand-Submodul nicht installiert ist
 * und folglich keine vom Betreiber gepflegten Rechts-Komponenten existieren.
 * Self-Hoster sind dafuer verantwortlich, eigene rechtliche Dokumente
 * bereitzustellen — diese Seite weist nur darauf hin.
 */
export function SimpleLegalNotice({ onBack }: SimpleLegalNoticeProps) {
  const { t, i18n } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };
  const isDe = i18n.language?.startsWith('de');
  const heading = isDe ? 'Rechtliche Hinweise' : 'Legal notice';
  const message = isDe
    ? 'Diese selbst-gehostete Instanz hat keinen rechtlichen Hinweis veroeffentlicht. Bitte wende dich an den Betreiber dieser Instanz, um Informationen zu Impressum, Datenschutz oder Nutzungsbedingungen zu erhalten.'
    : 'This self-hosted instance has not published a legal notice. Please contact the operator of this instance for information about imprint, privacy or terms of service.';
  const backLabel = t('legal.breadcrumbHome');

  return (
    <PublicLayout onLogin={() => navigate('app')} onSignup={() => navigate('register')} navigate={navigate}>
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
            maxWidth: 560,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            padding: '40px 32px',
          }}
        >
          <h2 className="pub-text-h4" style={{ margin: 0 }}>
            {heading}
          </h2>
          <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
            {message}
          </p>
          <PubButton variant="primary" onClick={onBack} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
            {backLabel}
          </PubButton>
        </PubCard>
      </div>
    </PublicLayout>
  );
}
