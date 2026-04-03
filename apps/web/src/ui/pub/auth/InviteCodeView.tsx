import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PubButton, PubInput, PubBadge } from '../components';

/* ---------- Inline SVG icons ---------- */

function TicketIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  );
}

function KeyIcon() {
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
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
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

interface InviteCodeViewProps {
  onSubmit: (code: string) => Promise<void>;
  onLogin: () => void;
  onRegister: () => void;
  initialCode?: string | undefined;
  error?: string | null;
  registrationEnabled?: boolean;
}

/* ---------- Component ---------- */

export function InviteCodeView({
  onSubmit,
  onLogin,
  onRegister,
  initialCode = '',
  error,
  registrationEnabled = true,
}: InviteCodeViewProps) {
  const { t } = useTranslation('public');
  const [code, setCode] = useState(initialCode);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await onSubmit(code);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      style={{ display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {/* Badge */}
      <PubBadge variant="teal" icon={<TicketIcon />}>
        {t('auth.inviteBadge')}
      </PubBadge>

      {/* Title */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 className="pub-text-h3" style={{ margin: 0 }}>
          {t('auth.inviteTitle')}
        </h1>
        <p
          className="pub-text-body"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.inviteSubtitle')}
        </p>
      </div>

      {/* Invite code input */}
      <PubInput
        label={t('auth.inviteCodeLabel')}
        icon={<KeyIcon />}
        placeholder={t('auth.inviteCodePlaceholder')}
        hint={t('auth.inviteCodeHint')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        style={{ letterSpacing: '1px' }}
        required
      />

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
        {t('auth.inviteSubmit')}
      </PubButton>

      {/* Divider */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          color: 'var(--pub-text-secondary)',
          fontSize: 13,
        }}
      >
        <div style={{ flex: 1, height: 1, background: 'var(--pub-border-light)' }} />
        {t('auth.dividerOr')}
        <div style={{ flex: 1, height: 1, background: 'var(--pub-border-light)' }} />
      </div>

      {/* Links */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        <p
          className="pub-text-body-sm"
          style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
        >
          {t('auth.inviteHasAccount')}{' '}
          <a
            onClick={onLogin}
            style={{
              cursor: 'pointer',
              color: 'var(--pub-accent-purple)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            {t('auth.inviteLoginLink')}
          </a>
        </p>
        {registrationEnabled && (
          <p
            className="pub-text-body-sm"
            style={{ margin: 0, color: 'var(--pub-text-secondary)' }}
          >
            {t('auth.inviteNoAccount')}{' '}
            <a
              onClick={onRegister}
              style={{
                cursor: 'pointer',
                color: 'var(--pub-accent-purple)',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              {t('auth.inviteRegisterLink')}
            </a>
          </p>
        )}
      </div>
    </form>
  );
}
