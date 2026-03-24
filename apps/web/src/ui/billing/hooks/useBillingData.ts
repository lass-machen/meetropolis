import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { openExternal } from '../../../lib/openExternal';
import { BillingStatus, Invoice, AvailablePlan } from '../types';
import { translateApiError } from '../../../lib/apiErrors';

export function useBillingData() {
  const { t } = useTranslation();
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
        setError(translateApiError(err.error) || t('billing.loadFailed'));
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
      setError(e instanceof Error ? e.message : t('common.networkError'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, t]);

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
        if (url) await openExternal(url);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.portalFailed')); }
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
        if (url) await openExternal(url);
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.checkoutFailed')); }
    setActionLoading(false);
  };

  const handleCancel = async () => {
    if (!confirm(t('billing.confirmCancel'))) return;
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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.cancelFailed')); }
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
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.reactivateFailed')); }
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
