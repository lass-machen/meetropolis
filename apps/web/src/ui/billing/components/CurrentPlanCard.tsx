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
  return (
    <Card title="Current Plan" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--fg, #fff)' }}>
          {status.billing.plan?.name || 'No Plan'}
        </div>
        {status.billing.plan && (
          <div style={{ fontSize: 18, color: 'var(--fg-subtle, #888)' }}>
            {status.billing.plan.amount === 0
              ? 'Free'
              : `${formatCurrency(status.billing.plan.amount, status.billing.plan.currency)}/${status.billing.plan.interval}`}
          </div>
        )}
      </div>
      {status.billing.subscription?.cancelAtPeriodEnd && (
        <Alert intent="error" style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Subscription will be cancelled on {formatDate(status.billing.subscription.currentPeriodEnd)}
          <Button
            variant="ghost"
            onClick={onReactivate}
            disabled={actionLoading}
            style={{ textDecoration: 'underline', marginLeft: 8, padding: '4px 8px' }}
          >
            Reactivate
          </Button>
        </Alert>
      )}
      {status.billing.hasSubscription && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--fg-subtle, #888)' }}>
          Current period: {formatDate(status.billing.subscription?.currentPeriodStart)} - {formatDate(status.billing.subscription?.currentPeriodEnd)}
        </div>
      )}
    </Card>
  );
}
