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

interface ResetPasswordViewProps {
  onSubmit: (email: string, token: string, password: string) => Promise<void>;
  onBack: () => void;
  initialEmail?: string | undefined;
  initialToken?: string | undefined;
  message?: string | null;
  messageType?: 'error' | 'success';
}

/* ---------- Component ---------- */

export function ResetPasswordView({
  onSubmit,
  onBack,
  initialEmail = '',
  initialToken = '',
  message,
  messageType = 'error',
}: ResetPasswordViewProps) {
  const { t } = useTranslation('public');
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(email, token, password);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="on"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Title */}
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('auth.resetTitle')}
      </h2>

      {/* Form fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <PubInput
          label={t('auth.emailLabel')}
          icon={<MailIcon />}
          placeholder={t('auth.registerEmailPlaceholder')}
          name="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={!!initialEmail}
          required
        />

        <PubInput
          label="Token"
          placeholder="Reset-Token"
          name="token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          readOnly={!!initialToken}
          required
        />

        <PubInput
          label={t('auth.registerPassword')}
          placeholder={t('auth.registerPasswordPlaceholder')}
          type="password"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>

      {/* Message */}
      {message && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background:
              messageType === 'success'
                ? 'rgba(34,197,94,0.1)'
                : 'rgba(239,68,68,0.1)',
            border:
              messageType === 'success'
                ? '1px solid rgba(34,197,94,0.3)'
                : '1px solid rgba(239,68,68,0.3)',
            color: messageType === 'success' ? '#22C55E' : '#EF4444',
            fontSize: 14,
          }}
        >
          {message}
        </div>
      )}

      {/* Submit */}
      <PubButton
        type="submit"
        variant="primary"
        disabled={loading}
        style={{ width: '100%' }}
      >
        {t('auth.resetSubmit')}
      </PubButton>

      {/* Back link */}
      <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center' }}>
        <a
          onClick={onBack}
          style={{
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.backToLogin')}
        </a>
      </p>
    </form>
  );
}
