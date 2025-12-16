import React from 'react';

export function Impressum({ onBack }: { onBack?: () => void }) {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {onBack && (
          <button onClick={onBack} style={styles.backBtn}>
            &larr; Back
          </button>
        )}

        <h1 style={styles.title}>Impressum</h1>
        <p style={styles.subtitle}>Legal Notice / Imprint</p>

        <section style={styles.section}>
          <h2 style={styles.heading}>Angaben gemass 5 TMG</h2>
          <p style={styles.text}>
            [Firmenname / Your Company Name]<br />
            [Rechtsform, z.B. GmbH / Legal Form]<br />
            [Strasse und Hausnummer / Street Address]<br />
            [PLZ und Ort / Postal Code and City]<br />
            Deutschland / Germany
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Vertreten durch / Represented by</h2>
          <p style={styles.text}>
            [Name des Geschaftsfuhrers / Managing Director]
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Kontakt / Contact</h2>
          <p style={styles.text}>
            Telefon / Phone: [+49 XXX XXXXXXX]<br />
            E-Mail: <a href="mailto:kontakt@meetropolis.de" style={styles.link}>kontakt@meetropolis.de</a>
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Registereintrag / Register Entry</h2>
          <p style={styles.text}>
            Eintragung im Handelsregister<br />
            Registergericht: [Amtsgericht / District Court]<br />
            Registernummer: [HRB XXXXX]
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Umsatzsteuer-ID / VAT ID</h2>
          <p style={styles.text}>
            Umsatzsteuer-Identifikationsnummer gemass 27 a Umsatzsteuergesetz:<br />
            [DE XXXXXXXXX]
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Verantwortlich fur den Inhalt nach 55 Abs. 2 RStV</h2>
          <p style={styles.text}>
            [Name der verantwortlichen Person]<br />
            [Anschrift]
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>EU-Streitschlichtung / EU Dispute Resolution</h2>
          <p style={styles.text}>
            Die Europaische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:<br />
            <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" style={styles.link}>
              https://ec.europa.eu/consumers/odr/
            </a>
          </p>
          <p style={styles.text}>
            Unsere E-Mail-Adresse finden Sie oben im Impressum.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Verbraucherstreitbeilegung / Consumer Dispute Resolution</h2>
          <p style={styles.text}>
            Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer
            Verbraucherschlichtungsstelle teilzunehmen.
          </p>
          <p style={styles.text}>
            <em>
              We are not willing or obligated to participate in dispute resolution proceedings
              before a consumer arbitration board.
            </em>
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Haftungsausschluss / Disclaimer</h2>

          <h3 style={styles.subheading}>Haftung fur Inhalte</h3>
          <p style={styles.text}>
            Als Diensteanbieter sind wir gemass 7 Abs.1 TMG fur eigene Inhalte auf diesen Seiten
            nach den allgemeinen Gesetzen verantwortlich. Nach 8 bis 10 TMG sind wir als
            Diensteanbieter jedoch nicht verpflichtet, ubermittelte oder gespeicherte fremde
            Informationen zu uberwachen oder nach Umstanden zu forschen, die auf eine rechtswidrige
            Tatigkeit hinweisen.
          </p>

          <h3 style={styles.subheading}>Haftung fur Links</h3>
          <p style={styles.text}>
            Unser Angebot enthalt Links zu externen Websites Dritter, auf deren Inhalte wir keinen
            Einfluss haben. Deshalb konnen wir fur diese fremden Inhalte auch keine Gewahr ubernehmen.
            Fur die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber
            der Seiten verantwortlich.
          </p>

          <h3 style={styles.subheading}>Urheberrecht</h3>
          <p style={styles.text}>
            Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen
            dem deutschen Urheberrecht. Die Vervielfaltigung, Bearbeitung, Verbreitung und jede Art
            der Verwertung ausserhalb der Grenzen des Urheberrechtes bedurfen der schriftlichen
            Zustimmung des jeweiligen Autors bzw. Erstellers.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>Open Source Hinweis / Open Source Notice</h2>
          <p style={styles.text}>
            Meetropolis ist ein Open-Source-Projekt, lizenziert unter der Apache License 2.0.
            Der Quellcode ist verfugbar unter:<br />
            <a href="https://github.com/lass-machen/meetropolis" target="_blank" rel="noopener noreferrer" style={styles.link}>
              https://github.com/lass-machen/meetropolis
            </a>
          </p>
        </section>

        <div style={styles.note}>
          <strong>Hinweis / Note:</strong> Bitte ersetzen Sie die Platzhalter [in eckigen Klammern]
          mit Ihren tatsachlichen Unternehmensdaten. / Please replace placeholders [in brackets]
          with your actual company information.
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'var(--bg, #0a0a0a)',
    color: 'var(--fg, #fff)',
    padding: '40px 20px',
  },
  content: {
    maxWidth: 800,
    margin: '0 auto',
  },
  backBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent, #3b82f6)',
    fontSize: 14,
    cursor: 'pointer',
    marginBottom: 24,
    padding: 0,
  },
  title: {
    fontSize: 32,
    fontWeight: 700,
    marginBottom: 8,
    color: 'var(--fg, #fff)',
  },
  subtitle: {
    fontSize: 16,
    color: 'var(--fg-subtle, #888)',
    marginBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  heading: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 12,
    color: 'var(--fg, #fff)',
  },
  subheading: {
    fontSize: 16,
    fontWeight: 600,
    marginTop: 16,
    marginBottom: 8,
    color: 'var(--fg, #fff)',
  },
  text: {
    fontSize: 15,
    lineHeight: 1.7,
    color: 'var(--fg-subtle, #ccc)',
    marginBottom: 12,
  },
  link: {
    color: 'var(--accent, #3b82f6)',
    textDecoration: 'none',
  },
  note: {
    marginTop: 40,
    padding: 16,
    background: 'rgba(234,179,8,0.1)',
    border: '1px solid rgba(234,179,8,0.3)',
    borderRadius: 8,
    fontSize: 13,
    color: '#eab308',
  },
};

export default Impressum;
