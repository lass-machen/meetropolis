import React from 'react';
import { useTranslation } from 'react-i18next';
import { useBillingData } from './hooks/useBillingData';
import { usePaymentStatus } from './hooks/usePaymentStatus';
import { CurrentPlanCard } from './components/CurrentPlanCard';
import { UsageDisplay } from './components/UsageDisplay';
import { BillingActions } from './components/BillingActions';
import { InvoiceHistory } from './components/InvoiceHistory';
import { PlanSelector } from './components/PlanSelector';
import { PaymentStatusBanner } from './components/PaymentStatusBanner';
import { Tabs, Alert } from '../system';

export function BillingDashboard({ onClose: _onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = React.useState<'overview' | 'invoices' | 'plans'>('overview');

  const {
    status,
    invoices,
    plans,
    loading,
    error,
    actionLoading,
    handleManageBilling,
    handleUpgrade,
    handleCancel,
    handleReactivate,
  } = useBillingData();

  const { paymentStatus, handleManageBilling: handlePaymentBilling } = usePaymentStatus({ enabled: true });

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-subtle, #888)' }}>
        {t('billing.loading')}
      </div>
    );
  }

  if (error) {
    return <Alert intent="error">{error}</Alert>;
  }

  return (
    <>
      {paymentStatus && paymentStatus.status !== 'ok' && (
        <PaymentStatusBanner paymentStatus={paymentStatus} onManageBilling={handlePaymentBilling} />
      )}

      <Tabs
        items={[
          { key: 'overview', label: t('billing.tabOverview') },
          { key: 'invoices', label: t('billing.tabInvoices') },
          { key: 'plans', label: t('billing.tabPlans') },
        ]}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as 'overview' | 'invoices' | 'plans')}
      />

      <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {activeTab === 'overview' && status && (
          <>
            <CurrentPlanCard
              status={status}
              onReactivate={handleReactivate}
              actionLoading={actionLoading}
            />

            <UsageDisplay status={status} />

            <BillingActions
              status={status}
              onManageBilling={handleManageBilling}
              onCancel={handleCancel}
              onUpgrade={() => setActiveTab('plans')}
              actionLoading={actionLoading}
            />
          </>
        )}

        {activeTab === 'invoices' && (
          <InvoiceHistory invoices={invoices} />
        )}

        {activeTab === 'plans' && (
          <PlanSelector
            plans={plans}
            status={status}
            onSelectPlan={handleUpgrade}
            actionLoading={actionLoading}
          />
        )}
      </div>
    </>
  );
}

export default BillingDashboard;
