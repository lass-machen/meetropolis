import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
      {status.billing.enabled && (
        <>
          {status.billing.hasSubscription ? (
            <>
              <Button variant="primary" onClick={onManageBilling} disabled={actionLoading} style={{ flex: 1 }}>
                {t('billing.managePayment')}
              </Button>
              {!status.billing.subscription?.cancelAtPeriodEnd && (
                <Button variant="danger" onClick={onCancel} disabled={actionLoading} style={{ flex: 1 }}>
                  {t('billing.cancelSubscription')}
                </Button>
              )}
            </>
          ) : (
            <Button variant="primary" onClick={onUpgrade} style={{ flex: 1 }}>
              {t('billing.upgradePlan')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
