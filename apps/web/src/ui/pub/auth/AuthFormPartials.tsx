import React from 'react';
import { useTranslation } from 'react-i18next';

export interface AuthMessageProps {
  message: string;
  messageType: 'error' | 'success';
}

export function AuthMessage({ message, messageType }: AuthMessageProps) {
  return (
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
  );
}

interface AuthLinkProps {
  onClick: () => void;
  labelKey: string;
  align?: 'left' | 'center' | 'right';
}

export function AuthLink({ onClick, labelKey, align = 'center' }: AuthLinkProps) {
  const { t } = useTranslation('public');
  return (
    <p
      className="pub-text-body-sm"
      style={{ margin: 0, textAlign: align }}
    >
      <a
        onClick={onClick}
        style={{
          cursor: 'pointer',
          color: 'var(--pub-accent-purple)',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        {t(labelKey)}
      </a>
    </p>
  );
}

interface AuthMailIconProps {
  size?: number;
}

export function AuthMailIcon({ size = 18 }: AuthMailIconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
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
