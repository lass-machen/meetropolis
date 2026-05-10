import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput } from '../components';
import { AuthLink, AuthMailIcon, AuthMessage } from './AuthFormPartials';

/* ---------- Props ---------- */

interface ResetPasswordViewProps {
  onSubmit: (email: string, token: string, password: string) => Promise<void>;
  onBack: () => void;
  initialEmail?: string | undefined;
  initialToken?: string | undefined;
  message?: string | null;
  messageType?: 'error' | 'success';
}

/* ---------- Sub-Components ---------- */

interface ResetFieldsProps {
  email: string;
  token: string;
  password: string;
  initialEmail: string;
  initialToken: string;
  onEmailChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
}

function ResetPasswordFields({
  email,
  token,
  password,
  initialEmail,
  initialToken,
  onEmailChange,
  onTokenChange,
  onPasswordChange,
}: ResetFieldsProps) {
  const { t } = useTranslation('public');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PubInput
        label={t('auth.emailLabel')}
        icon={<AuthMailIcon />}
        placeholder={t('auth.registerEmailPlaceholder')}
        name="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        readOnly={!!initialEmail}
        required
      />

      <PubInput
        label="Token"
        placeholder="Reset-Token"
        name="token"
        value={token}
        onChange={(e) => onTokenChange(e.target.value)}
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
        onChange={(e) => onPasswordChange(e.target.value)}
        required
      />
    </div>
  );
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
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
      autoComplete="on"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {t('auth.resetTitle')}
      </h2>
      <ResetPasswordFields
        email={email}
        token={token}
        password={password}
        initialEmail={initialEmail}
        initialToken={initialToken}
        onEmailChange={setEmail}
        onTokenChange={setToken}
        onPasswordChange={setPassword}
      />
      {message && <AuthMessage message={message} messageType={messageType} />}
      <PubButton type="submit" variant="primary" disabled={loading} style={{ width: '100%' }}>
        {t('auth.resetSubmit')}
      </PubButton>
      <AuthLink onClick={onBack} labelKey="auth.backToLogin" />
    </form>
  );
}
