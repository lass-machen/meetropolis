import React from 'react';
import { getApiBaseFromWindow } from '../../lib/apiBase';

interface Plan {
  id?: string;
  name: string;
  description?: string | null;
  amount: number;
  currency: string;
  interval: string;
  concurrentLimit: number;
}

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
}

interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amount: number;
  currency: string;
  date: string | null;
  paidAt: string | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
}

interface BillingStatus {
  billing: {
    enabled: boolean;
    status: string;
    hasSubscription: boolean;
    subscription: Subscription | null;
    plan: Plan | null;
  };
  usage: {
    currentUsers: number;
    limit: number;
    freeSeats: number;
    paidSeats: number;
  };
  tenant: {
    id: string;
    slug: string;
    name: string;
    bypassLimits: boolean;
    isInternal: boolean;
  };
}

interface AvailablePlan {
  priceId: string;
  productId: string;
  name: string;
  description: string | null;
  amount: number;
  currency: string;
  interval: string;
  concurrentLimit: number;
  features: string[];
}

export function BillingDashboard({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [plans, setPlans] = React.useState<AvailablePlan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'overview' | 'invoices' | 'plans'>('overview');

  const apiBase = getApiBaseFromWindow();

  const fetchData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, invoicesRes, plansRes] = await Promise.all([
        fetch(`${apiBase}/billing/status`, { credentials: 'include' }),
        fetch(`${apiBase}/billing/invoices`, { credentials: 'include' }),
        fetch(`${apiBase}/billing/plans`, { credentials: 'include' }),
      ]);

      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus(data);
      } else {
        const err = await statusRes.json().catch(() => ({}));
        setError(err.error || 'Failed to load billing status');
      }

      if (invoicesRes.ok) {
        const data = await invoicesRes.json();
        setInvoices(data.invoices || []);
      }

      if (plansRes.ok) {
        const data = await plansRes.json();
        setPlans(data.plans || []);
      }
    } catch (e: any) {
      setError(e.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleManageBilling = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/billing/portal-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const { url } = await res.json();
        if (url) window.open(url, '_blank');
      }
    } catch { }
    setActionLoading(false);
  };

  const handleUpgrade = async (priceId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/billing/checkout-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });
      if (res.ok) {
        const { url } = await res.json();
        if (url) window.location.href = url;
      }
    } catch { }
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? You will retain access until the end of the billing period.')) return;
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/billing/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchData();
      }
    } catch { }
    setActionLoading(false);
  };

  const handleReactivate = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${apiBase}/billing/reactivate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        await fetchData();
      }
    } catch { }
    setActionLoading(false);
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('de-DE', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(amount);
  };

  if (loading) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.loading}>Loading billing information...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <div style={styles.header}>
            <h2 style={styles.title}>Billing</h2>
            <button onClick={onClose} style={styles.closeBtn}>&times;</button>
          </div>
          <div style={styles.error}>{error}</div>
        </div>
      </div>
    );
  }

  const usagePercent = status ? Math.min(100, (status.usage.currentUsers / Math.max(1, status.usage.limit)) * 100) : 0;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>Billing & Subscription</h2>
          <button onClick={onClose} style={styles.closeBtn}>&times;</button>
        </div>

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
              {/* Current Plan */}
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
                    <button onClick={handleReactivate} disabled={actionLoading} style={styles.linkBtn}>
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

              {/* Usage */}
              <div style={styles.card}>
                <h3 style={styles.cardTitle}>Usage</h3>
                <div style={styles.usageInfo}>
                  <div style={styles.usageNumbers}>
                    <span style={styles.usageCurrent}>{status.usage.currentUsers}</span>
                    <span style={styles.usageLimit}>/ {status.usage.limit} users</span>
                  </div>
                  <div style={styles.usageBar}>
                    <div
                      style={{
                        ...styles.usageFill,
                        width: `${usagePercent}%`,
                        background: usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#f59e0b' : '#22c55e',
                      }}
                    />
                  </div>
                  <div style={styles.usageLabel}>
                    {status.usage.freeSeats > 0 && <span>{status.usage.freeSeats} free seats</span>}
                    {status.usage.paidSeats > 0 && <span> + {status.usage.paidSeats} paid seats</span>}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div style={styles.actions}>
                {status.billing.enabled && (
                  <>
                    {status.billing.hasSubscription ? (
                      <>
                        <button onClick={handleManageBilling} disabled={actionLoading} style={styles.primaryBtn}>
                          Manage Payment Methods
                        </button>
                        {!status.billing.subscription?.cancelAtPeriodEnd && (
                          <button onClick={handleCancel} disabled={actionLoading} style={styles.dangerBtn}>
                            Cancel Subscription
                          </button>
                        )}
                      </>
                    ) : (
                      <button onClick={() => setActiveTab('plans')} style={styles.primaryBtn}>
                        Upgrade Plan
                      </button>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          {activeTab === 'invoices' && (
            <div style={styles.invoiceList}>
              {invoices.length === 0 ? (
                <div style={styles.emptyState}>No invoices yet</div>
              ) : (
                invoices.map((inv) => (
                  <div key={inv.id} style={styles.invoiceItem}>
                    <div style={styles.invoiceMain}>
                      <div style={styles.invoiceNumber}>{inv.number || inv.id.slice(0, 12)}</div>
                      <div style={styles.invoiceDate}>{formatDate(inv.date)}</div>
                    </div>
                    <div style={styles.invoiceRight}>
                      <div style={styles.invoiceAmount}>{formatCurrency(inv.amount, inv.currency)}</div>
                      <div style={{
                        ...styles.invoiceStatus,
                        color: inv.status === 'paid' ? '#22c55e' : inv.status === 'open' ? '#f59e0b' : '#6b7280'
                      }}>
                        {inv.status}
                      </div>
                    </div>
                    <div style={styles.invoiceActions}>
                      {inv.hostedUrl && (
                        <a href={inv.hostedUrl} target="_blank" rel="noopener noreferrer" style={styles.invoiceLink}>
                          View
                        </a>
                      )}
                      {inv.pdfUrl && (
                        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" style={styles.invoiceLink}>
                          PDF
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'plans' && (
            <div style={styles.plansList}>
              {plans.length === 0 ? (
                <div style={styles.emptyState}>No plans available</div>
              ) : (
                plans.map((plan) => {
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
                        onClick={() => !isCurrent && handleUpgrade(plan.priceId)}
                        disabled={isCurrent || actionLoading}
                        style={{ ...styles.planBtn, ...(isCurrent ? styles.planBtnCurrent : {}) }}
                      >
                        {isCurrent ? 'Current Plan' : 'Select Plan'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    background: 'var(--glass, rgba(30,30,30,0.95))',
    borderRadius: 16,
    border: '1px solid var(--border, rgba(255,255,255,0.1))',
    width: '90%',
    maxWidth: 600,
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 24,
    cursor: 'pointer',
    color: 'var(--fg-subtle, #888)',
    padding: 0,
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    gap: 4,
    padding: '8px 16px',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
  },
  tab: {
    padding: '8px 16px',
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    color: 'var(--fg-subtle, #888)',
    fontSize: 14,
    fontWeight: 500,
  },
  tabActive: {
    background: 'var(--accent, #3b82f6)',
    color: '#fff',
  },
  content: {
    padding: 20,
    overflowY: 'auto',
    flex: 1,
  },
  loading: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  error: {
    padding: 20,
    color: '#ef4444',
    textAlign: 'center',
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardTitle: {
    margin: '0 0 12px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--fg-subtle, #888)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  planInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  planName: {
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--fg, #fff)',
  },
  planPrice: {
    fontSize: 18,
    color: 'var(--fg-subtle, #888)',
  },
  cancelNotice: {
    marginTop: 12,
    padding: '8px 12px',
    background: 'rgba(239,68,68,0.15)',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 13,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  periodInfo: {
    marginTop: 8,
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
  },
  usageInfo: {},
  usageNumbers: {
    marginBottom: 8,
  },
  usageCurrent: {
    fontSize: 32,
    fontWeight: 700,
    color: 'var(--fg, #fff)',
  },
  usageLimit: {
    fontSize: 16,
    color: 'var(--fg-subtle, #888)',
    marginLeft: 4,
  },
  usageBar: {
    height: 8,
    background: 'rgba(255,255,255,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  usageFill: {
    height: '100%',
    borderRadius: 4,
    transition: 'width 0.3s ease',
  },
  usageLabel: {
    marginTop: 8,
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginTop: 8,
  },
  primaryBtn: {
    flex: 1,
    padding: '12px 20px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  dangerBtn: {
    flex: 1,
    padding: '12px 20px',
    background: 'transparent',
    border: '1px solid #ef4444',
    borderRadius: 8,
    color: '#ef4444',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  linkBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--accent, #3b82f6)',
    cursor: 'pointer',
    fontSize: 13,
    textDecoration: 'underline',
    marginLeft: 8,
  },
  invoiceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  invoiceItem: {
    display: 'flex',
    alignItems: 'center',
    padding: 12,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 8,
    gap: 12,
  },
  invoiceMain: {
    flex: 1,
  },
  invoiceNumber: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
    fontSize: 14,
  },
  invoiceDate: {
    fontSize: 12,
    color: 'var(--fg-subtle, #888)',
  },
  invoiceRight: {
    textAlign: 'right',
  },
  invoiceAmount: {
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  invoiceStatus: {
    fontSize: 12,
    textTransform: 'uppercase',
  },
  invoiceActions: {
    display: 'flex',
    gap: 8,
  },
  invoiceLink: {
    color: 'var(--accent, #3b82f6)',
    textDecoration: 'none',
    fontSize: 13,
  },
  emptyState: {
    padding: 40,
    textAlign: 'center',
    color: 'var(--fg-subtle, #888)',
  },
  plansList: {
    display: 'grid',
    gap: 12,
  },
  planCard: {
    padding: 16,
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    border: '1px solid transparent',
  },
  planCardCurrent: {
    border: '1px solid var(--accent, #3b82f6)',
  },
  planCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  planCardName: {
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--fg, #fff)',
  },
  planCardPrice: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--accent, #3b82f6)',
  },
  planCardDesc: {
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
    marginBottom: 8,
  },
  planCardLimit: {
    fontSize: 14,
    color: 'var(--fg, #fff)',
    marginBottom: 12,
  },
  planFeatures: {
    margin: '0 0 12px',
    paddingLeft: 20,
    fontSize: 13,
    color: 'var(--fg-subtle, #888)',
  },
  planFeature: {
    marginBottom: 4,
  },
  planBtn: {
    width: '100%',
    padding: '10px 16px',
    background: 'var(--accent, #3b82f6)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  planBtnCurrent: {
    background: 'rgba(255,255,255,0.1)',
    color: 'var(--fg-subtle, #888)',
    cursor: 'default',
  },
};

export default BillingDashboard;
