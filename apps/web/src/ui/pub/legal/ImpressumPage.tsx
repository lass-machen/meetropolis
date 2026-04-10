import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface ImpressumPageProps {
  onBack: () => void;
  registrationEnabled?: boolean;
}

export function ImpressumPage({ onBack, registrationEnabled }: ImpressumPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  const sections = [
    {
      id: 'angaben',
      title: 'Angaben gem\u00e4\u00df \u00a7 5 TMG',
      content: (
        <div>
          <p>
            Tiamat UG (haftungsbeschr\u00e4nkt)<br />
            An der Strusbek 12<br />
            22926 Ahrensburg
          </p>
          <p>
            Handelsregister: HRB 25322 HL<br />
            Registergericht: Amtsgericht L\u00fcbeck
          </p>
          <p>
            <strong>Vertreten durch:</strong><br />
            Ansgar Holtmann
          </p>
        </div>
      ),
    },
    {
      id: 'kontakt',
      title: 'Kontakt',
      content: (
        <div>
          <p>
            Telefon: [Telefonnummer]<br />
            E-Mail:{' '}
            <a href="mailto:mail@tiamat-labs.com">
              mail@tiamat-labs.com
            </a>
          </p>
        </div>
      ),
    },
    {
      id: 'streitbeilegung',
      title: 'Verbraucherstreitbeilegung/Universalschlichtungsstelle',
      content: (
        <div>
          <p>
            Wir sind nicht bereit oder verpflichtet, an
            Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
        </div>
      ),
    },
    {
      id: 'open-source',
      title: 'Open Source Hinweis',
      content: (
        <div>
          <p>
            Meetropolis ist ein Open-Source-Projekt, lizenziert unter der
            Apache License 2.0. Der Quellcode ist verf\u00fcgbar unter:{' '}
            <a
              href="https://github.com/lass-machen/meetropolis"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://github.com/lass-machen/meetropolis
            </a>
          </p>
        </div>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('legal.imprintTitle')}
      subtitle={t('legal.imprintSubtitle')}
      breadcrumbLabel={t('legal.imprintTitle')}
      lastUpdated="10. April 2026"
      sections={sections}
      onBack={onBack}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    />
  );
}
