import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput } from '../components';

/* ---------- Inline SVG icons ---------- */

function MailIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

/* ---------- Props ---------- */

interface ForgotPasswordViewProps {
  /** Resolves true once the reset mail request was accepted. */
  onSubmit: (email: string) => Promise<boolean>;
  onBack: () => void;
  /** Fallback for tokens handed out out-of-band by an admin. */
  onManualToken: () => void;
  message?: string | null;
  messageType?: 'error' | 'success';
}

/** Minutes a reset link stays valid — mirrors PASSWORD_RESET_TTL_MINUTES. */
const RESET_LINK_TTL_MINUTES = 30;

function ForgotPasswordTitle() {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('auth.forgotTitle')}
      </h2>
      <p className="pub-text-body" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
        {t('auth.forgotSubtitle')}
      </p>
    </div>
  );
}

interface AuthMessageProps {
  message: string;
  messageType: 'error' | 'success';
}

function AuthMessage({ message, messageType }: AuthMessageProps) {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: messageType === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
        border: messageType === 'success' ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(239,68,68,0.3)',
        color: messageType === 'success' ? '#22C55E' : '#EF4444',
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}

function BackToLoginLink({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation('public');
  return (
    <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center' }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          all: 'unset',
          cursor: 'pointer',
          color: 'var(--pub-accent-purple)',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        {t('auth.backToLogin')}
      </button>
    </p>
  );
}

/** Quiet inline action that reads as a link but behaves as a button. */
function InlineAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        color: 'var(--pub-accent-purple)',
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

/**
 * Post-submit state. The wording stays neutral about whether the address is
 * known — the endpoint answers identically either way on purpose, and copy that
 * said "we sent you a link" would give that back away (besides being a promise
 * we cannot keep for an unknown address).
 */
function ForgotSentPanel({
  email,
  onBack,
  onResend,
  onManualToken,
}: {
  email: string;
  onBack: () => void;
  onResend: () => void;
  onManualToken: () => void;
}) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 className="pub-text-h4" style={{ margin: 0 }}>
          {t('auth.forgotSentTitle')}
        </h2>
        <p className="pub-text-body" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
          {t('auth.forgotSentBody', { email, minutes: RESET_LINK_TTL_MINUTES })}
        </p>
      </div>
      <PubButton type="button" variant="primary" onClick={onBack} style={{ width: '100%' }}>
        {t('auth.backToLogin')}
      </PubButton>
      <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}>
        {t('auth.forgotNoMailHint')} <InlineAction onClick={onResend}>{t('auth.forgotResend')}</InlineAction>
        {' · '}
        <InlineAction onClick={onManualToken}>{t('auth.forgotManualToken')}</InlineAction>
      </p>
    </div>
  );
}

/* ---------- Component ---------- */

export function ForgotPasswordView({
  onSubmit,
  onBack,
  onManualToken,
  message,
  messageType = 'error',
}: ForgotPasswordViewProps) {
  const { t } = useTranslation('public');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (await onSubmit(email)) setSentTo(email);
    } finally {
      setLoading(false);
    }
  }

  if (sentTo !== null) {
    return (
      <ForgotSentPanel email={sentTo} onBack={onBack} onResend={() => setSentTo(null)} onManualToken={onManualToken} />
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      autoComplete="on"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <ForgotPasswordTitle />
      <PubInput
        label={t('auth.emailLabel')}
        icon={<MailIcon />}
        placeholder={t('auth.registerEmailPlaceholder')}
        name="email"
        inputMode="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      {message && <AuthMessage message={message} messageType={messageType} />}
      <PubButton type="submit" variant="primary" disabled={loading} style={{ width: '100%' }}>
        {t('auth.forgotSubmit')}
      </PubButton>
      <BackToLoginLink onBack={onBack} />
    </form>
  );
}
