import { BillingStatus } from '../types';
import { styles } from '../styles';

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
    <div style={styles.actions}>
      {status.billing.enabled && (
        <>
          {status.billing.hasSubscription ? (
            <>
              <button onClick={onManageBilling} disabled={actionLoading} style={styles.primaryBtn}>
                Manage Payment Methods
              </button>
              {!status.billing.subscription?.cancelAtPeriodEnd && (
                <button onClick={onCancel} disabled={actionLoading} style={styles.dangerBtn}>
                  Cancel Subscription
                </button>
              )}
            </>
          ) : (
            <button onClick={onUpgrade} style={styles.primaryBtn}>
              Upgrade Plan
            </button>
          )}
        </>
      )}
    </div>
  );
}
