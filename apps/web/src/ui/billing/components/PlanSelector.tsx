import { AvailablePlan, BillingStatus } from '../types';
import { formatCurrency } from '../utils';
import { Card, Button } from '../../system';

interface PlanSelectorProps {
  plans: AvailablePlan[];
  status: BillingStatus | null;
  onSelectPlan: (priceId: string) => void;
  actionLoading: boolean;
}

export function PlanSelector({ plans, status, onSelectPlan, actionLoading }: PlanSelectorProps) {
  if (plans.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>
        No plans available
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {plans.map((plan) => {
        const isCurrent = status?.billing.plan?.id === plan.priceId;
        return (
          <Card
            key={plan.priceId}
            style={isCurrent ? { border: '1px solid var(--accent, #3b82f6)' } : {}}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--fg, #fff)' }}>{plan.name}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent, #3b82f6)' }}>
                {plan.amount === 0 ? 'Free' : `${formatCurrency(plan.amount, plan.currency)}/${plan.interval}`}
              </div>
            </div>
            {plan.description && (
              <div style={{ fontSize: 13, color: 'var(--fg-subtle, #888)', marginBottom: 8 }}>
                {plan.description}
              </div>
            )}
            <div style={{ fontSize: 14, color: 'var(--fg, #fff)', marginBottom: 12 }}>
              {plan.concurrentLimit} concurrent users
            </div>
            {plan.features.length > 0 && (
              <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13, color: 'var(--fg-subtle, #888)' }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{f}</li>
                ))}
              </ul>
            )}
            {isCurrent ? (
              <Button variant="ghost" disabled style={{ width: '100%' }}>
                Current Plan
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => onSelectPlan(plan.priceId)}
                disabled={actionLoading}
                style={{ width: '100%' }}
              >
                Select Plan
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}
