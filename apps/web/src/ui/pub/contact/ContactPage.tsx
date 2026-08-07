import React from 'react';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { ContactForm } from './ContactForm';

interface ContactPageProps {
  apiBase: string;
  registrationEnabled?: boolean;
}

/**
 * Public contact page (`#/contact`).
 *
 * Unlike the legal pages, this one is not brand-only: the form is generic and
 * a self-hosted instance can point it at its own inbox by setting
 * `CONTACT_FORM_TO`. Where an instance has not, the form says so.
 *
 * `contact.fallbackEmail` deliberately has no OSS default. The brand bundle
 * supplies it through `publicOverrides`, so the hosted site can offer a real
 * address when the form is down; an OSS build gets the key back unresolved,
 * which — following the same convention as `header.brandName` in
 * PublicFooter — means "not set" rather than a literal to display.
 */
export function ContactPage({ apiBase, registrationEnabled }: ContactPageProps) {
  const { t } = useTranslation('public');
  const navigate = React.useCallback((route: string) => {
    window.location.hash = `#/${route}`;
  }, []);
  const fallbackRaw = t('contact.fallbackEmail');
  const fallbackEmail = fallbackRaw && fallbackRaw !== 'contact.fallbackEmail' ? fallbackRaw : null;

  return (
    <PublicLayout
      onLogin={() => navigate('login')}
      onSignup={() => navigate('register')}
      navigate={navigate}
      {...(registrationEnabled !== undefined && { registrationEnabled })}
    >
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          padding: 'var(--pub-section-padding)',
        }}
      >
        <h1 style={{ fontFamily: 'var(--pub-font-heading)', fontSize: 40, lineHeight: 1.2, margin: '0 0 12px 0' }}>
          {t('contact.title')}
        </h1>
        <p
          style={{
            fontFamily: 'var(--pub-font-body)',
            fontSize: 17,
            lineHeight: 1.7,
            color: 'var(--pub-text-secondary)',
            margin: '0 0 32px 0',
          }}
        >
          {t('contact.subtitle')}
        </p>

        <PubCard variant="surface" style={{ padding: '32px 28px' }}>
          <ContactForm apiBase={apiBase} fallbackEmail={fallbackEmail} onNavigate={navigate} />
        </PubCard>
      </div>
    </PublicLayout>
  );
}
