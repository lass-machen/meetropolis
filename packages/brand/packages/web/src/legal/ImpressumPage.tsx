import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface ImpressumPageProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

const IMPRESSUM_SECTIONS = [
  {
    id: 'angaben',
    title: 'Angaben gemäß § 5 TMG',
    content: (
      <div>
        <p>Tiamat UG (haftungsbeschränkt)<br />An der Strusbek 12<br />22926 Ahrensburg</p>
        <p>Handelsregister: HRB 25322 HL<br />Registergericht: Amtsgericht Lübeck</p>
        <p><strong>Vertreten durch:</strong><br />Ansgar Holtmann</p>
      </div>
    ),
  },
  {
    id: 'kontakt',
    title: 'Kontakt',
    content: (
      <div>
        <p>Telefon: [Telefonnummer]<br />E-Mail: <a href="mailto:mail@tiamat-labs.com">mail@tiamat-labs.com</a></p>
      </div>
    ),
  },
  {
    id: 'streitbeilegung',
    title: 'Verbraucherstreitbeilegung/Universalschlichtungsstelle',
    content: (
      <div>
        <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </div>
    ),
  },
  {
    id: 'open-source',
    title: 'Open Source (Coming Soon)',
    content: (
      <div>
        <p>Meetropolis wird in Kürze als Open-Source-Projekt verfügbar sein. Volle Datensouveränität, DSGVO-konform, auf euren eigenen Servern.</p>
      </div>
    ),
  },
];

export function ImpressumPage({ onBack, registrationEnabled }: ImpressumPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => { window.location.hash = `#/${route}`; };

  return (
    <LegalLayout
      title={t('legal.imprintTitle')}
      subtitle={t('legal.imprintSubtitle')}
      breadcrumbLabel={t('legal.imprintTitle')}
      lastUpdated="10. April 2026"
      sections={IMPRESSUM_SECTIONS}
      onBack={onBack}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    />
  );
}
