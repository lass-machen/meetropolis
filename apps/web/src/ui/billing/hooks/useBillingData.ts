import React from 'react';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { BillingStatus, Invoice, AvailablePlan } from '../types';

export function useBillingData() {
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [plans, setPlans] = React.useState<AvailablePlan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);

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
    } catch (e: unknown) {
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

  return {
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
  };
}
