import { BillingStatus } from '../types';
import { formatDate, formatCurrency } from '../utils';
import { styles } from '../styles';

interface CurrentPlanCardProps {
  status: BillingStatus;
  onReactivate: () => void;
  actionLoading: boolean;
}

export function CurrentPlanCard({ status, onReactivate, actionLoading }: CurrentPlanCardProps) {
  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Current Plan</h3>
      <div style={styles.planInfo}>
        <div style={styles.planName}>{status.billing.plan?.name || 'No Plan'}</div>
        {status.billing.plan && (
          <div style={styles.planPrice}>
            {status.billing.plan.amount === 0
              ? 'Free'
              : `${formatCurrency(status.billing.plan.amount, status.billing.plan.currency)}/${status.billing.plan.interval}`}
          </div>
        )}
      </div>
      {status.billing.subscription?.cancelAtPeriodEnd && (
        <div style={styles.cancelNotice}>
          Subscription will be cancelled on {formatDate(status.billing.subscription.currentPeriodEnd)}
          <button onClick={onReactivate} disabled={actionLoading} style={styles.linkBtn}>
            Reactivate
          </button>
        </div>
      )}
      {status.billing.hasSubscription && (
        <div style={styles.periodInfo}>
          Current period: {formatDate(status.billing.subscription?.currentPeriodStart)} - {formatDate(status.billing.subscription?.currentPeriodEnd)}
        </div>
      )}
    </div>
  );
}
