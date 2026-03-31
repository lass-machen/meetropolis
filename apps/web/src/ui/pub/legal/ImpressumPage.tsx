import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface ImpressumPageProps {
  onBack: () => void;
}

export function ImpressumPage({ onBack }: ImpressumPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  const sections = [
    {
      id: 'anbieter',
      title: 'Anbieter',
      content: (
        <div>
          <p>
            [Firmenname / Your Company Name]<br />
            [Rechtsform, z.B. GmbH / Legal Form]<br />
            [Straße und Hausnummer / Street Address]<br />
            [PLZ und Ort / Postal Code and City]<br />
            Deutschland / Germany
          </p>
          <p>
            <strong>Vertreten durch / Represented by:</strong><br />
            [Name des Geschäftsführers / Managing Director]
          </p>
          <p>
            <strong>Registereintrag / Register Entry:</strong><br />
            Eintragung im Handelsregister<br />
            Registergericht: [Amtsgericht / District Court]<br />
            Registernummer: [HRB XXXXX]
          </p>
          <p>
            <strong>Umsatzsteuer-ID / VAT ID:</strong><br />
            Umsatzsteuer-Identifikationsnummer gemäß §27 a Umsatzsteuergesetz:<br />
            [DE XXXXXXXXX]
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
            Telefon / Phone: [+49 XXX XXXXXXX]<br />
            E-Mail:{' '}
            <a href="mailto:kontakt@meetropolis.de">
              kontakt@meetropolis.de
            </a>
          </p>
        </div>
      ),
    },
    {
      id: 'verantwortlich',
      title: 'Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV',
      content: (
        <div>
          <p>
            [Name der verantwortlichen Person]<br />
            [Anschrift]
          </p>
        </div>
      ),
    },
    {
      id: 'eu-streitschlichtung',
      title: 'EU-Streitschlichtung',
      content: (
        <div>
          <p>
            Die Europäische Kommission stellt eine Plattform zur
            Online-Streitbeilegung (OS) bereit:{' '}
            <a
              href="https://ec.europa.eu/consumers/odr/"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://ec.europa.eu/consumers/odr/
            </a>
          </p>
          <p>
            Unsere E-Mail-Adresse finden Sie oben im Impressum.
          </p>
          <p>
            Wir sind nicht bereit oder verpflichtet, an
            Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
          <p>
            <em>
              We are not willing or obligated to participate in dispute
              resolution proceedings before a consumer arbitration board.
            </em>
          </p>
        </div>
      ),
    },
    {
      id: 'haftungsausschluss',
      title: 'Haftungsausschluss',
      content: (
        <div>
          <h3>Haftung für Inhalte</h3>
          <p>
            Als Diensteanbieter sind wir gemäß §7 Abs.1 TMG für eigene
            Inhalte auf diesen Seiten nach den allgemeinen Gesetzen
            verantwortlich. Nach §§8 bis 10 TMG sind wir als Diensteanbieter
            jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
            Informationen zu überwachen oder nach Umständen zu forschen, die
            auf eine rechtswidrige Tätigkeit hinweisen.
          </p>

          <h3>Haftung für Links</h3>
          <p>
            Unser Angebot enthält Links zu externen Websites Dritter, auf
            deren Inhalte wir keinen Einfluss haben. Deshalb können wir für
            diese fremden Inhalte auch keine Gewähr übernehmen. Für die
            Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter
            oder Betreiber der Seiten verantwortlich.
          </p>

          <h3>Urheberrecht</h3>
          <p>
            Die durch die Seitenbetreiber erstellten Inhalte und Werke auf
            diesen Seiten unterliegen dem deutschen Urheberrecht. Die
            Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
            Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen
            der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.
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
            Apache License 2.0. Der Quellcode ist verfügbar unter:{' '}
            <a
              href="https://github.com/lass-machen/meetropolis"
              target="_blank"
              rel="noopener noreferrer"
            >
              https://github.com/lass-machen/meetropolis
            </a>
          </p>
          <p
            style={{
              marginTop: 16,
              padding: 16,
              background: 'rgba(234,179,8,0.1)',
              border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: 8,
              fontSize: 13,
              color: '#92700c',
            }}
          >
            <strong>Hinweis / Note:</strong> Bitte ersetzen Sie die
            Platzhalter [in eckigen Klammern] mit Ihren tatsächlichen
            Unternehmensdaten. / Please replace placeholders [in brackets]
            with your actual company information.
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
      lastUpdated="31. März 2026"
      sections={sections}
      onBack={onBack}
      navigate={navigate}
    />
  );
}
