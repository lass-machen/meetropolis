import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput } from '../components';
import { AuthMailIcon } from './AuthFormPartials';

/* ---------- Inline SVG icons ---------- */

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
  registrationEnabled?: boolean;
}

/* ---------- Sub-Components ---------- */

function LoginTitle() {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 className="pub-text-h3" style={{ margin: 0 }}>
        {t('auth.loginTitle')}
      </h1>
      <p className="pub-text-body" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
        {t('auth.loginSubtitle')}
      </p>
    </div>
  );
}

interface PasswordFieldProps {
  password: string;
  onChange: (v: string) => void;
  onForgot: () => void;
}

function PasswordField({ password, onChange, onForgot }: PasswordFieldProps) {
  const { t } = useTranslation('public');
  return (
    <div>
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
        <button
          type="button"
          onClick={onForgot}
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
          }}
        >
          {t('auth.forgotPasswordLink')}
        </button>
      </div>
      <div className="pub-input-wrapper">
        <input
          className="pub-input"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => onChange(e.target.value)}
          required
        />
      </div>
    </div>
  );
}

interface LoginFieldsProps {
  email: string;
  password: string;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
  onForgot: () => void;
}

function LoginFields({ email, password, onEmail, onPassword, onForgot }: LoginFieldsProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PubInput
        label={t('auth.emailLabel')}
        icon={<AuthMailIcon />}
        placeholder={t('auth.registerEmailPlaceholder')}
        name="email"
        inputMode="email"
        autoComplete="username"
        value={email}
        onChange={(e) => onEmail(e.target.value)}
        required
      />
      <PasswordField password={password} onChange={onPassword} onForgot={onForgot} />
    </div>
  );
}

function LoginAlert({ kind, text }: { kind: 'success' | 'error'; text: string }) {
  const styles =
    kind === 'success'
      ? { bg: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22C55E' }
      : { bg: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444' };
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: 8,
        background: styles.bg,
        border: styles.border,
        color: styles.color,
        fontSize: 14,
      }}
    >
      {text}
    </div>
  );
}

interface LoginFooterProps {
  onRegister: () => void;
  onInvite: () => void;
  registrationEnabled: boolean;
}

function LoginFooter({ onRegister, onInvite, registrationEnabled }: LoginFooterProps) {
  const { t } = useTranslation('public');
  return (
    <>
      {registrationEnabled && (
        <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}>
          {t('auth.loginNoAccount')}{' '}
          <button
            type="button"
            onClick={onRegister}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: 'var(--pub-accent-purple)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            {t('auth.loginRegisterLink')}
          </button>
        </p>
      )}
      <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}>
        {t('auth.loginHasInvite')}{' '}
        <button
          type="button"
          onClick={onInvite}
          style={{
            all: 'unset',
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.loginInviteLink')}
        </button>
      </p>
    </>
  );
}

/* ---------- Component ---------- */

export function LoginView({
  onSubmit,
  onForgot,
  onRegister,
  onInvite,
  error,
  successMessage,
  registrationEnabled = true,
}: LoginViewProps) {
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
    <form
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      autoComplete="on"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <LoginTitle />
      <LoginFields email={email} password={password} onEmail={setEmail} onPassword={setPassword} onForgot={onForgot} />
      {successMessage && <LoginAlert kind="success" text={successMessage} />}
      {error && <LoginAlert kind="error" text={error} />}
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
      <LoginFooter onRegister={onRegister} onInvite={onInvite} registrationEnabled={registrationEnabled} />
    </form>
  );
}
