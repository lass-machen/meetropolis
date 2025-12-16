import React from 'react';

export function PrivacyPolicy({ onBack }: { onBack?: () => void }) {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {onBack && (
          <button onClick={onBack} style={styles.backBtn}>
            &larr; Back
          </button>
        )}

        <h1 style={styles.title}>Privacy Policy / Datenschutzerklarung</h1>
        <p style={styles.lastUpdated}>Last updated: December 2024</p>

        <section style={styles.section}>
          <h2 style={styles.heading}>1. Introduction / Einleitung</h2>
          <p style={styles.text}>
            Meetropolis ("we", "us", "our") respects your privacy and is committed to protecting your personal data.
            This privacy policy explains how we collect, use, and safeguard your information when you use our services.
          </p>
          <p style={styles.text}>
            Meetropolis ("wir", "uns", "unser") respektiert Ihre Privatsphare und verpflichtet sich zum Schutz Ihrer personenbezogenen Daten.
            Diese Datenschutzerklarung erlautert, wie wir Ihre Daten erfassen, verwenden und schutzen, wenn Sie unsere Dienste nutzen.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>2. Data We Collect / Erhobene Daten</h2>
          <h3 style={styles.subheading}>Account Information</h3>
          <ul style={styles.list}>
            <li>Email address (for authentication and communication)</li>
            <li>Display name (optional, for personalization)</li>
            <li>Password (stored securely using bcrypt hashing)</li>
          </ul>

          <h3 style={styles.subheading}>Usage Data</h3>
          <ul style={styles.list}>
            <li>Avatar position in the virtual world</li>
            <li>Last activity timestamp</li>
            <li>Organization membership and role</li>
          </ul>

          <h3 style={styles.subheading}>Technical Data</h3>
          <ul style={styles.list}>
            <li>IP address (for rate limiting and security)</li>
            <li>Browser type and version</li>
            <li>WebRTC connection metrics (for audio/video quality)</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>3. How We Use Your Data / Verwendung Ihrer Daten</h2>
          <ul style={styles.list}>
            <li><strong>Authentication:</strong> To verify your identity and secure your account</li>
            <li><strong>Service Delivery:</strong> To provide the virtual office experience</li>
            <li><strong>Communication:</strong> To send important service updates and notifications</li>
            <li><strong>Billing:</strong> To process payments and manage subscriptions (via Stripe)</li>
            <li><strong>Security:</strong> To protect against fraud and abuse</li>
            <li><strong>Improvement:</strong> To analyze usage patterns and improve our services</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>4. Data Sharing / Datenweitergabe</h2>
          <p style={styles.text}>We do not sell your personal data. We may share data with:</p>
          <ul style={styles.list}>
            <li><strong>Stripe:</strong> Payment processing (see Stripe's privacy policy)</li>
            <li><strong>LiveKit:</strong> Audio/video communication infrastructure</li>
            <li><strong>Hosting Providers:</strong> Infrastructure services (data processing agreements in place)</li>
            <li><strong>Legal Authorities:</strong> When required by law</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>5. Data Retention / Datenspeicherung</h2>
          <p style={styles.text}>
            We retain your personal data only as long as necessary to provide our services.
            Upon account deletion, all personal data is permanently removed within 30 days,
            except where retention is required by law (e.g., billing records).
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>6. Your Rights / Ihre Rechte (GDPR)</h2>
          <p style={styles.text}>Under GDPR, you have the right to:</p>
          <ul style={styles.list}>
            <li><strong>Access:</strong> Request a copy of your personal data</li>
            <li><strong>Rectification:</strong> Correct inaccurate data</li>
            <li><strong>Erasure:</strong> Delete your account and data ("right to be forgotten")</li>
            <li><strong>Portability:</strong> Export your data in a machine-readable format</li>
            <li><strong>Objection:</strong> Object to certain processing activities</li>
            <li><strong>Restriction:</strong> Request limited processing</li>
          </ul>
          <p style={styles.text}>
            To exercise these rights, please contact us at <a href="mailto:privacy@meetropolis.de" style={styles.link}>privacy@meetropolis.de</a>
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>7. Security / Sicherheit</h2>
          <p style={styles.text}>We implement industry-standard security measures including:</p>
          <ul style={styles.list}>
            <li>TLS/SSL encryption for all data in transit</li>
            <li>Bcrypt password hashing</li>
            <li>Rate limiting to prevent abuse</li>
            <li>Regular security audits</li>
            <li>Access controls and audit logging</li>
          </ul>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>8. Cookies / Cookies</h2>
          <p style={styles.text}>
            We use essential cookies for authentication (session tokens). These are strictly necessary
            for the service to function and cannot be disabled. We do not use tracking or advertising cookies.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>9. Children's Privacy / Datenschutz fur Kinder</h2>
          <p style={styles.text}>
            Our services are not intended for children under 16. We do not knowingly collect
            personal data from children. If you believe we have collected data from a child,
            please contact us immediately.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>10. Changes to This Policy / Anderungen</h2>
          <p style={styles.text}>
            We may update this privacy policy from time to time. We will notify you of significant
            changes via email or in-app notification. Continued use of the service after changes
            constitutes acceptance of the updated policy.
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>11. Contact / Kontakt</h2>
          <p style={styles.text}>
            For privacy-related inquiries:<br />
            Email: <a href="mailto:privacy@meetropolis.de" style={styles.link}>privacy@meetropolis.de</a>
          </p>
          <p style={styles.text}>
            Data Protection Officer (Datenschutzbeauftragter):<br />
            [Your DPO contact information if applicable]
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.heading}>12. Supervisory Authority / Aufsichtsbehorde</h2>
          <p style={styles.text}>
            You have the right to lodge a complaint with a supervisory authority if you believe
            your data protection rights have been violated. In Germany, you may contact your
            state's data protection authority (Landesdatenschutzbeauftragter).
          </p>
        </section>
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
  lastUpdated: {
    fontSize: 14,
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
  list: {
    fontSize: 15,
    lineHeight: 1.8,
    color: 'var(--fg-subtle, #ccc)',
    paddingLeft: 24,
    marginBottom: 12,
  },
  link: {
    color: 'var(--accent, #3b82f6)',
    textDecoration: 'none',
  },
};

export default PrivacyPolicy;
