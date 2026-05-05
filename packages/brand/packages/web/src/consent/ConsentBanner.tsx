import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton } from '@app/ui/pub/components/PubButton';
import {
  getMarketingConsent,
  onMarketingConsentChange,
  setMarketingConsent,
  type MarketingConsent,
} from '../tracking/marketingConsent';

interface ConsentBannerProps {
  /** When false the banner never renders (e.g. on the authenticated `/app` route). */
  enabled: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}

function useConsentState() {
  const [consent, setConsent] = React.useState<MarketingConsent>(() => getMarketingConsent());

  React.useEffect(() => {
    return onMarketingConsentChange((next) => setConsent(next));
  }, []);

  return consent;
}

function useFocusAcceptOnVisible(
  isVisible: boolean,
  dialogRef: React.RefObject<HTMLDivElement | null>,
) {
  React.useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => {
      const btn = dialogRef.current?.querySelector<HTMLButtonElement>(
        'button[data-consent-action="accept"]',
      );
      btn?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isVisible, dialogRef]);
}

const CONSENT_BANNER_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  right: 16,
  bottom: 16,
  zIndex: 10000,
  margin: '0 auto',
  maxWidth: 960,
  background: 'var(--pub-bg-dark)',
  color: 'var(--pub-text-on-dark)',
  border: '1px solid var(--pub-border-dark)',
  borderRadius: 'var(--pub-radius-card)',
  padding: '20px 24px',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.25)',
  fontFamily: 'var(--pub-font-body)',
};

const CONSENT_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 24,
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
};

function ConsentText() {
  const { t } = useTranslation('public');
  return (
    <div style={{ flex: '1 1 360px', minWidth: 260 }}>
      <h2
        style={{
          fontFamily: 'var(--pub-font-display)',
          fontWeight: 700,
          fontSize: 16,
          lineHeight: 1.3,
          margin: '0 0 6px 0',
          color: 'var(--pub-text-on-dark)',
        }}
      >
        {t('consent.title')}
      </h2>
      <p
        style={{
          fontSize: 14,
          lineHeight: 1.6,
          margin: 0,
          color: 'var(--pub-text-on-dark-secondary)',
        }}
      >
        {t('consent.description')}{' '}
        <a
          href="#/privacy"
          style={{
            color: 'var(--pub-text-on-dark)',
            textDecoration: 'underline',
          }}
        >
          {t('consent.privacyLink')}
        </a>
        .
      </p>
    </div>
  );
}

interface ConsentActionsProps {
  onAccept: () => void;
  onDecline: () => void;
}

function ConsentActions({ onAccept, onDecline }: ConsentActionsProps) {
  const { t } = useTranslation('public');
  return (
    <div
      className="pub-consent-banner__actions"
      style={{
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}
    >
      <PubButton
        variant="secondary"
        size="md"
        onClick={onDecline}
        type="button"
        data-consent-action="decline"
      >
        {t('consent.decline')}
      </PubButton>
      <PubButton
        variant="primary"
        size="md"
        onClick={onAccept}
        type="button"
        data-consent-action="accept"
      >
        {t('consent.accept')}
      </PubButton>
    </div>
  );
}

/**
 * Sticky bottom opt-in banner for marketing tracking (Meta Pixel).
 * Renders only while the user has not made a decision yet and `enabled` is true.
 * The banner is non-modal — the rest of the page stays interactive — but it
 * exposes itself as an ARIA dialog so screen readers announce the choice.
 */
export function ConsentBanner({ enabled, onAccept, onDecline }: ConsentBannerProps) {
  const { t } = useTranslation('public');
  const consent = useConsentState();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  const isVisible = enabled && consent === 'unset';
  useFocusAcceptOnVisible(isVisible, dialogRef);

  if (!isVisible) return null;

  const handleAccept = () => {
    setMarketingConsent('granted');
    onAccept?.();
  };

  const handleDecline = () => {
    setMarketingConsent('denied');
    onDecline?.();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={false}
      aria-label={t('consent.ariaLabel')}
      className="pub-consent-banner"
      style={CONSENT_BANNER_STYLE}
    >
      <div className="pub-consent-banner__row" style={CONSENT_ROW_STYLE}>
        <ConsentText />
        <ConsentActions onAccept={handleAccept} onDecline={handleDecline} />
      </div>
    </div>
  );
}
