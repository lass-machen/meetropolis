import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput, PubStepIndicator } from '../components';

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

function ArrowRightIcon() {
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
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ---------- Props ---------- */

interface RegisterViewProps {
  onSubmit: (data: {
    name: string;
    email: string;
    password: string;
    invite?: string | undefined;
  }) => Promise<void>;
  onLogin: () => void;
  initialInvite?: string | undefined;
  error?: string | null;
}

/* ---------- Component ---------- */

export function RegisterView({
  onSubmit,
  onLogin,
  initialInvite,
  error,
}: RegisterViewProps) {
  const { t } = useTranslation('public');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const name = [firstName, lastName].filter(Boolean).join(' ');
      await onSubmit({ name, email, password, invite: initialInvite });
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
      {/* Step indicator */}
      <PubStepIndicator steps={3} currentStep={1} />

      {/* Title */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.registerTitle')}
        </h1>
        <p
          className="pub-text-body-sm"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.registerSubtitle')}
        </p>
      </div>

      {/* Form fields */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* First + Last name row */}
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <PubInput
              label={t('auth.registerFirstName')}
              placeholder={t('auth.registerFirstNamePlaceholder')}
              name="given-name"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div style={{ flex: 1 }}>
            <PubInput
              label={t('auth.registerLastName')}
              placeholder={t('auth.registerLastNamePlaceholder')}
              name="family-name"
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        {/* Email */}
        <PubInput
          label={t('auth.registerEmail')}
          icon={<MailIcon />}
          placeholder={t('auth.registerEmailPlaceholder')}
          name="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        {/* Password */}
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
        disabled={loading}
        rightIcon={<ArrowRightIcon />}
        style={{ width: '100%' }}
      >
        {t('auth.registerSubmit')}
      </PubButton>

      {/* Terms hint */}
      <p
        className="pub-text-body-sm"
        style={{
          margin: 0,
          textAlign: 'center',
          color: 'var(--pub-text-secondary)',
          fontSize: 12,
        }}
      >
        {t('auth.registerTermsHint')}
      </p>

      {/* Login link */}
      <p
        className="pub-text-body-sm"
        style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}
      >
        {t('auth.registerHasAccount')}{' '}
        <a
          onClick={onLogin}
          style={{
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.registerLoginLink')}
        </a>
      </p>
    </form>
  );
}
