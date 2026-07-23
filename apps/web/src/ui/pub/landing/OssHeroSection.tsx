import { useTranslation } from 'react-i18next';
import { PubButton } from '../components/PubButton';

interface OssHeroSectionProps {
  onSignup: () => void;
  onLogin: () => void;
  registrationEnabled: boolean;
}

/**
 * OSS-only generic hero. Used when the brand submodule is not installed;
 * shows neutral self-host messaging without any Meetropolis branding.
 */
export function OssHeroSection({ onSignup, onLogin, registrationEnabled }: OssHeroSectionProps) {
  const { t } = useTranslation('public');

  return (
    <section style={{ padding: '80px 24px', textAlign: 'center' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 'clamp(32px, 5vw, 56px)', lineHeight: 1.15, marginBottom: 16 }}>
          {t('header.ossHeroTitle')}
        </h1>
        <p style={{ fontSize: 18, color: 'var(--fg-subtle, #888)', marginBottom: 32 }}>{t('header.ossHeroSubtitle')}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
          {registrationEnabled && (
            <PubButton variant="primary" onClick={onSignup}>
              {t('header.ossHeroCtaPrimary')}
            </PubButton>
          )}
          <PubButton variant="secondary" onClick={onLogin}>
            {t('header.ossHeroCtaSecondary')}
          </PubButton>
        </div>
      </div>
    </section>
  );
}
