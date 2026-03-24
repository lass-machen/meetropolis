import { BillingStatus } from '../types';
import { Button } from '../../system';

interface BillingActionsProps {
  status: BillingStatus;
  onManageBilling: () => void;
  onCancel: () => void;
  onUpgrade: () => void;
  actionLoading: boolean;
}

export function BillingActions({
  status,
  onManageBilling,
  onCancel,
  onUpgrade,
  actionLoading
}: BillingActionsProps) {
  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
      {status.billing.enabled && (
        <>
          {status.billing.hasSubscription ? (
            <>
              <Button variant="primary" onClick={onManageBilling} disabled={actionLoading} style={{ flex: 1 }}>
                Manage Payment Methods
              </Button>
              {!status.billing.subscription?.cancelAtPeriodEnd && (
                <Button variant="danger" onClick={onCancel} disabled={actionLoading} style={{ flex: 1 }}>
                  Cancel Subscription
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" onClick={onUpgrade} style={{ flex: 1 }}>
              Upgrade Plan
            </Button>
          )}
        </>
      )}
    </div>
  );
}
