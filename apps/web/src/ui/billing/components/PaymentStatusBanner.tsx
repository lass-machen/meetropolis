import React from 'react';
import { PaymentStatus } from '../types';

interface Props {
  paymentStatus: PaymentStatus;
  onManageBilling: () => void;
}

const baseStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 16px',
  borderRadius: 10,
  fontSize: 13,
  color: 'var(--fg, #fff)',
  position: 'relative',
  zIndex: 50,
};

const btnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '6px 14px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  background: 'var(--accent, #3b82f6)',
  color: '#fff',
  whiteSpace: 'nowrap',
};

export function PaymentStatusBanner({ paymentStatus, onManageBilling }: Props) {
  if (paymentStatus.status === 'ok') return null;

  const isSuspended = paymentStatus.status === 'suspended' || paymentStatus.dunningStep >= 4;
  const daysText = paymentStatus.daysUntilCancellation != null
    ? ` Noch ${paymentStatus.daysUntilCancellation} Tage bis zur Kündigung.`
    : '';

  const style: React.CSSProperties = {
    ...baseStyle,
    background: isSuspended ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
    border: isSuspended ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
  };

  return (
    <div style={style}>
      <span>{isSuspended ? '\u{1F6A8}' : '\u26A0\uFE0F'}</span>
      <span>
        {isSuspended
          ? `Zugang eingeschränkt wegen offener Zahlung.${daysText}`
          : `Zahlung fehlgeschlagen. Bitte Zahlungsmethode aktualisieren.${daysText}`}
      </span>
      <button style={btnStyle} onClick={onManageBilling}>
        {isSuspended ? 'Jetzt bezahlen' : 'Zahlungsmethode aktualisieren'}
      </button>
    </div>
  );
}
