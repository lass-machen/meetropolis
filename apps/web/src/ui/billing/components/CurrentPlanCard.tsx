import { useTranslation } from 'react-i18next';
import { BillingStatus } from '../types';
import { formatDate, formatCurrency } from '../utils';
import { Card } from '../../system';
import { Alert } from '../../system';
import { Button } from '../../system';

interface CurrentPlanCardProps {
  status: BillingStatus;
  onReactivate: () => void;
  actionLoading: boolean;
}

export function CurrentPlanCard({ status, onReactivate, actionLoading }: CurrentPlanCardProps) {
  const { t } = useTranslation();

  return (
    <Card title={t('billing.currentPlan')} style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fg, #fff)' }}>
          {status.billing.plan?.name || t('billing.noPlan')}
        </div>
        {status.billing.plan && (
          <div style={{ fontSize: 18, color: 'var(--fg-subtle, #888)' }}>
            {status.billing.plan.amount === 0
              ? t('billing.free')
              : `${formatCurrency(status.billing.plan.amount, status.billing.plan.currency)}/${status.billing.plan.interval}`}
          </div>
        )}
      </div>
      {status.billing.subscription?.cancelAtPeriodEnd && (
        <Alert intent="error" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {t('billing.cancelledOn', { date: formatDate(status.billing.subscription.currentPeriodEnd) })}
          <Button
            variant="ghost"
            onClick={onReactivate}
            disabled={actionLoading}
            style={{ textDecoration: 'underline', marginLeft: 8, padding: '4px 8px' }}
          >
            {t('billing.reactivate')}
          </Button>
        </Alert>
      )}
      {status.billing.hasSubscription && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle, #888)' }}>
          {t('billing.currentPeriod', { start: formatDate(status.billing.subscription?.currentPeriodStart), end: formatDate(status.billing.subscription?.currentPeriodEnd) })}
        </div>
      )}
    </Card>
  );
}
