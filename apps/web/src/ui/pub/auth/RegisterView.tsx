import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput, PubStepIndicator } from '../components';
import { AuthMailIcon } from './AuthFormPartials';

/* ---------- Inline SVG icons ---------- */

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
  onSubmit: (data: { name: string; email: string; password: string; invite?: string | undefined }) => Promise<void>;
  onLogin: () => void;
  initialInvite?: string | undefined;
  error?: string | null;
}

/* ---------- Sub-Components ---------- */

function RegisterTitle() {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 className="pub-text-h3" style={{ margin: 0 }}>
        {t('auth.registerTitle')}
      </h1>
      <p className="pub-text-body-sm" style={{ margin: 0, color: 'var(--pub-text-secondary)' }}>
        {t('auth.registerSubtitle')}
      </p>
    </div>
  );
}

interface RegisterFieldsProps {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  onFirstName: (v: string) => void;
  onLastName: (v: string) => void;
  onEmail: (v: string) => void;
  onPassword: (v: string) => void;
}

function RegisterNameRow({
  firstName,
  lastName,
  onFirstName,
  onLastName,
}: Pick<RegisterFieldsProps, 'firstName' | 'lastName' | 'onFirstName' | 'onLastName'>) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <PubInput
          label={t('auth.registerFirstName')}
          placeholder={t('auth.registerFirstNamePlaceholder')}
          name="given-name"
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => onFirstName(e.target.value)}
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
          onChange={(e) => onLastName(e.target.value)}
        />
      </div>
    </div>
  );
}

function RegisterFields(props: RegisterFieldsProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <RegisterNameRow
        firstName={props.firstName}
        lastName={props.lastName}
        onFirstName={props.onFirstName}
        onLastName={props.onLastName}
      />
      <PubInput
        label={t('auth.registerEmail')}
        icon={<AuthMailIcon />}
        placeholder={t('auth.registerEmailPlaceholder')}
        name="email"
        inputMode="email"
        autoComplete="username"
        value={props.email}
        onChange={(e) => props.onEmail(e.target.value)}
        required
      />
      <PubInput
        label={t('auth.registerPassword')}
        placeholder={t('auth.registerPasswordPlaceholder')}
        type="password"
        name="password"
        autoComplete="new-password"
        value={props.password}
        onChange={(e) => props.onPassword(e.target.value)}
        required
      />
    </div>
  );
}

function RegisterError({ error }: { error: string }) {
  return (
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
  );
}

function RegisterFooter({ onLogin }: { onLogin: () => void }) {
  const { t } = useTranslation('public');
  return (
    <>
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
      <p className="pub-text-body-sm" style={{ margin: 0, textAlign: 'center', color: 'var(--pub-text-secondary)' }}>
        {t('auth.registerHasAccount')}{' '}
        <button
          type="button"
          onClick={onLogin}
          style={{
            all: 'unset',
            cursor: 'pointer',
            color: 'var(--pub-accent-purple)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('auth.registerLoginLink')}
        </button>
      </p>
    </>
  );
}

/* ---------- Component ---------- */

export function RegisterView({ onSubmit, onLogin, initialInvite, error }: RegisterViewProps) {
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
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      autoComplete="on"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <PubStepIndicator steps={3} currentStep={1} />
      <RegisterTitle />
      <RegisterFields
        firstName={firstName}
        lastName={lastName}
        email={email}
        password={password}
        onFirstName={setFirstName}
        onLastName={setLastName}
        onEmail={setEmail}
        onPassword={setPassword}
      />
      {error && <RegisterError error={error} />}
      <PubButton
        type="submit"
        variant="primary"
        disabled={loading}
        rightIcon={<ArrowRightIcon />}
        style={{ width: '100%' }}
      >
        {t('auth.registerSubmit')}
      </PubButton>
      <RegisterFooter onLogin={onLogin} />
    </form>
  );
}
