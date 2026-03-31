import { useTranslation } from 'react-i18next';
import { LegalLayout } from './LegalLayout';

interface PrivacyPolicyPageProps {
  onBack: () => void;
}

export function PrivacyPolicyPage({ onBack }: PrivacyPolicyPageProps) {
  const { t } = useTranslation('public');
  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  const sections = [
    {
      id: 'einleitung',
      title: 'Einleitung',
      content: (
        <div>
          <p>
            Meetropolis ("we", "us", "our") respects your privacy and is
            committed to protecting your personal data. This privacy policy
            explains how we collect, use, and safeguard your information when
            you use our services.
          </p>
          <p>
            Meetropolis ("wir", "uns", "unser") respektiert Ihre Privatsphäre
            und verpflichtet sich zum Schutz Ihrer personenbezogenen Daten.
            Diese Datenschutzerklärung erläutert, wie wir Ihre Daten
            erfassen, verwenden und schützen, wenn Sie unsere Dienste nutzen.
          </p>
        </div>
      ),
    },
    {
      id: 'erhobene-daten',
      title: 'Erhobene Daten',
      content: (
        <div>
          <h3>Account Information</h3>
          <ul>
            <li>Email address (for authentication and communication)</li>
            <li>Display name (optional, for personalization)</li>
            <li>Password (stored securely using bcrypt hashing)</li>
          </ul>

          <h3>Usage Data</h3>
          <ul>
            <li>Avatar position in the virtual world</li>
            <li>Last activity timestamp</li>
            <li>Organization membership and role</li>
          </ul>

          <h3>Technical Data</h3>
          <ul>
            <li>IP address (for rate limiting and security)</li>
            <li>Browser type and version</li>
            <li>WebRTC connection metrics (for audio/video quality)</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'verwendung',
      title: 'Verwendung Ihrer Daten',
      content: (
        <div>
          <ul>
            <li>
              <strong>Authentication:</strong> To verify your identity and
              secure your account
            </li>
            <li>
              <strong>Service Delivery:</strong> To provide the virtual office
              experience
            </li>
            <li>
              <strong>Communication:</strong> To send important service updates
              and notifications
            </li>
            <li>
              <strong>Billing:</strong> To process payments and manage
              subscriptions (via Stripe)
            </li>
            <li>
              <strong>Security:</strong> To protect against fraud and abuse
            </li>
            <li>
              <strong>Improvement:</strong> To analyze usage patterns and
              improve our services
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'datenweitergabe',
      title: 'Datenweitergabe',
      content: (
        <div>
          <p>We do not sell your personal data. We may share data with:</p>
          <ul>
            <li>
              <strong>Stripe:</strong> Payment processing (see Stripe's privacy
              policy)
            </li>
            <li>
              <strong>LiveKit:</strong> Audio/video communication infrastructure
            </li>
            <li>
              <strong>Hosting Providers:</strong> Infrastructure services (data
              processing agreements in place)
            </li>
            <li>
              <strong>Legal Authorities:</strong> When required by law
            </li>
          </ul>
        </div>
      ),
    },
    {
      id: 'datenspeicherung',
      title: 'Datenspeicherung',
      content: (
        <div>
          <p>
            We retain your personal data only as long as necessary to provide
            our services. Upon account deletion, all personal data is
            permanently removed within 30 days, except where retention is
            required by law (e.g., billing records).
          </p>
        </div>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookies',
      content: (
        <div>
          <p>
            We use essential cookies for authentication (session tokens). These
            are strictly necessary for the service to function and cannot be
            disabled. We do not use tracking or advertising cookies.
          </p>
        </div>
      ),
    },
    {
      id: 'ihre-rechte',
      title: 'Ihre Rechte (DSGVO)',
      content: (
        <div>
          <p>Under GDPR, you have the right to:</p>
          <ul>
            <li>
              <strong>Access:</strong> Request a copy of your personal data
            </li>
            <li>
              <strong>Rectification:</strong> Correct inaccurate data
            </li>
            <li>
              <strong>Erasure:</strong> Delete your account and data ("right to
              be forgotten")
            </li>
            <li>
              <strong>Portability:</strong> Export your data in a
              machine-readable format
            </li>
            <li>
              <strong>Objection:</strong> Object to certain processing
              activities
            </li>
            <li>
              <strong>Restriction:</strong> Request limited processing
            </li>
          </ul>
          <p>
            To exercise these rights, please contact us at{' '}
            <a href="mailto:privacy@meetropolis.de">privacy@meetropolis.de</a>
          </p>
        </div>
      ),
    },
    {
      id: 'sicherheit',
      title: 'Sicherheit',
      content: (
        <div>
          <p>
            We implement industry-standard security measures including:
          </p>
          <ul>
            <li>TLS/SSL encryption for all data in transit</li>
            <li>Bcrypt password hashing</li>
            <li>Rate limiting to prevent abuse</li>
            <li>Regular security audits</li>
            <li>Access controls and audit logging</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'kinder',
      title: 'Datenschutz für Kinder',
      content: (
        <div>
          <p>
            Our services are not intended for children under 16. We do not
            knowingly collect personal data from children. If you believe we
            have collected data from a child, please contact us immediately.
          </p>
        </div>
      ),
    },
    {
      id: 'aenderungen',
      title: 'Änderungen',
      content: (
        <div>
          <p>
            We may update this privacy policy from time to time. We will notify
            you of significant changes via email or in-app notification.
            Continued use of the service after changes constitutes acceptance
            of the updated policy.
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
            For privacy-related inquiries:<br />
            Email:{' '}
            <a href="mailto:privacy@meetropolis.de">privacy@meetropolis.de</a>
          </p>
          <p>
            Data Protection Officer (Datenschutzbeauftragter):<br />
            [Your DPO contact information if applicable]
          </p>
        </div>
      ),
    },
    {
      id: 'aufsichtsbehoerde',
      title: 'Aufsichtsbehörde',
      content: (
        <div>
          <p>
            You have the right to lodge a complaint with a supervisory
            authority if you believe your data protection rights have been
            violated. In Germany, you may contact your state's data protection
            authority (Landesdatenschutzbeauftragter).
          </p>
        </div>
      ),
    },
  ];

  return (
    <LegalLayout
      title={t('legal.privacyTitle')}
      subtitle={t('legal.privacySubtitle')}
      breadcrumbLabel={t('legal.privacyTitle')}
      lastUpdated="31. März 2026"
      sections={sections}
      onBack={onBack}
      navigate={navigate}
    />
  );
}
