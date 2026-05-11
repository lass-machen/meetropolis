import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';

interface OssFinalCtaSectionProps {
  onSignup: () => void;
  registrationEnabled: boolean;
}

/**
 * OSS-only generic final-CTA. Used when the brand submodule is not
 * installed: neutral closing message without any sales pitch.
 */
export function OssFinalCtaSection({ onSignup, registrationEnabled }: OssFinalCtaSectionProps) {
  const { t } = useTranslation('public');
  if (!registrationEnabled) return null;

  return (
    <section style={{ padding: '80px 24px', textAlign: 'center', borderTop: '1px solid var(--border, #2a2a2a)' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ fontSize: 'clamp(24px, 3.5vw, 40px)', marginBottom: 24 }}>
          {t('openSource.title', 'Available as Open Source')}
        </h2>
        <PubButton variant="primary" onClick={onSignup}>
          {t('header.ossHeroCtaPrimary', 'Get Started')}
        </PubButton>
      </div>
    </section>
  );
}
