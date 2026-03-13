import { AvailablePlan, BillingStatus } from '../types';
import { formatCurrency } from '../utils';
import { styles } from '../styles';

interface PlanSelectorProps {
  plans: AvailablePlan[];
  status: BillingStatus | null;
  onSelectPlan: (priceId: string) => void;
  actionLoading: boolean;
}

export function PlanSelector({ plans, status, onSelectPlan, actionLoading }: PlanSelectorProps) {
  if (plans.length === 0) {
    return <div style={styles.emptyState}>No plans available</div>;
  }

  return (
    <div style={styles.plansList}>
      {plans.map((plan) => {
        const isCurrent = status?.billing.plan?.id === plan.priceId;
        return (
          <div key={plan.priceId} style={{ ...styles.planCard, ...(isCurrent ? styles.planCardCurrent : {}) }}>
            <div style={styles.planCardHeader}>
              <div style={styles.planCardName}>{plan.name}</div>
              <div style={styles.planCardPrice}>
                {plan.amount === 0 ? 'Free' : `${formatCurrency(plan.amount, plan.currency)}/${plan.interval}`}
              </div>
            </div>
            {plan.description && <div style={styles.planCardDesc}>{plan.description}</div>}
            <div style={styles.planCardLimit}>{plan.concurrentLimit} concurrent users</div>
            {plan.features.length > 0 && (
              <ul style={styles.planFeatures}>
                {plan.features.map((f, i) => (
                  <li key={i} style={styles.planFeature}>{f}</li>
                ))}
              </ul>
            )}
            <button
              onClick={() => !isCurrent && onSelectPlan(plan.priceId)}
              disabled={isCurrent || actionLoading}
              style={{ ...styles.planBtn, ...(isCurrent ? styles.planBtnCurrent : {}) }}
            >
              {isCurrent ? 'Current Plan' : 'Select Plan'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
