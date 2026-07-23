import { useTranslation } from 'react-i18next';
import { PaymentStatus } from '../types';
import { Alert, Button } from '../../system';

interface Props {
  paymentStatus: PaymentStatus;
  onManageBilling: () => void;
}

export function PaymentStatusBanner({ paymentStatus, onManageBilling }: Props) {
  const { t } = useTranslation();

  if (paymentStatus.status === 'ok') return null;

  const isSuspended = paymentStatus.status === 'suspended' || paymentStatus.dunningStep >= 4;
  const daysText =
    paymentStatus.daysUntilCancellation != null
      ? ` ${t('billing.daysUntilCancel', { days: paymentStatus.daysUntilCancellation })}`
      : '';

  return (
    // No position/z-index here on purpose: this banner renders in normal document
    // flow, above the game surface (see WorldMainView's BannerAndGameLayout), so it
    // never needs to fight the top header bar for stacking order (A15).
    <Alert intent={isSuspended ? 'error' : 'warning'} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span>{isSuspended ? '\u{1F6A8}' : '\u26A0\uFE0F'}</span>
      <span>
        {isSuspended ? t('billing.accessRestricted', { daysText }) : t('billing.paymentFailed', { daysText })}
      </span>
      <Button
        variant="primary"
        onClick={onManageBilling}
        style={{ marginLeft: 'auto', whiteSpace: 'nowrap', padding: '6px 14px', fontSize: 13 }}
      >
        {isSuspended ? t('billing.payNow') : t('billing.updatePayment')}
      </Button>
    </Alert>
  );
}
