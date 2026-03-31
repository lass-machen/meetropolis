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

function LogInIcon() {
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
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="10 17 15 12 10 7" />
      <line x1="15" y1="12" x2="3" y2="12" />
    </svg>
  );
}

/* ---------- Props ---------- */

interface LoginViewProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  onForgot: () => void;
  onRegister: () => void;
  onInvite: () => void;
  error?: string | null;
  successMessage?: string | null;
}

/* ---------- Component ---------- */

export function LoginView({ onSubmit, onForgot, onRegister, onInvite, error, successMessage }: LoginViewProps) {
  const { t } = useTranslation('public');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(email, password);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} autoComplete="on" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Title */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.loginTitle')}
        </h1>
        <p
          className="pub-text-body"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.loginSubtitle')}
        </p>
      </div>

      {/* Form fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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

        <div>
          {/* Label row with forgot-password link */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 6,
            }}
          >
            <label className="pub-input-label" style={{ margin: 0 }}>
              {t('auth.passwordLabel')}
            </label>
            <a
              onClick={onForgot}
              style={{
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--pub-accent-purple)',
                textDecoration: 'none',
              }}
            >
              {t('auth.forgotPasswordLink')}
            </a>
          </div>
          <div className="pub-input-wrapper">
            <input
              className="pub-input"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
        </div>
      </div>

      {/* Success message (e.g. after password reset) */}
      {successMessage && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.3)',
            color: '#22C55E',
            fontSize: 14,
          }}
        >
          {successMessage}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#EF4444',
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Submit */}
      <PubButton
        type="submit"
        variant="primary"
        className="pub-btn--full-width"
        disabled={loading}
        rightIcon={<LogInIcon />}
        style={{ width: '100%' }}
      >
        {t('auth.loginSubmit')}
      </PubButton>

      {/* Register link */}
      <p
        className="pub-text-body-sm"
        style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}
      >
        {t('auth.loginNoAccount')}{' '}
        <a
          onClick={onRegister}
          style={{
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.loginRegisterLink')}
        </a>
      </p>

      {/* Invite link */}
      <p
        className="pub-text-body-sm"
        style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}
      >
        {t('auth.loginHasInvite')}{' '}
        <a
          onClick={onInvite}
          style={{
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.loginInviteLink')}
        </a>
      </p>
    </form>
  );
}
