import React from 'react';
import { useBillingData } from './hooks/useBillingData';
import { CurrentPlanCard } from './components/CurrentPlanCard';
import { UsageDisplay } from './components/UsageDisplay';
import { BillingActions } from './components/BillingActions';
import { InvoiceHistory } from './components/InvoiceHistory';
import { PlanSelector } from './components/PlanSelector';
import { styles } from './styles';

export function BillingDashboard({ onClose: _onClose }: { onClose: () => void }) {
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

  if (loading) {
    return <div style={styles.loading}>Loading billing information...</div>;
  }

  if (error) {
    return <div style={styles.error}>{error}</div>;
  }

  return (
    <>
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{ ...styles.tab, ...(activeTab === 'overview' ? styles.tabActive : {}) }}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          style={{ ...styles.tab, ...(activeTab === 'invoices' ? styles.tabActive : {}) }}
        >
          Invoices
        </button>
        <button
          onClick={() => setActiveTab('plans')}
          style={{ ...styles.tab, ...(activeTab === 'plans' ? styles.tabActive : {}) }}
        >
          Plans
        </button>
      </div>

      <div style={styles.content}>
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
