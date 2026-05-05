import React from 'react';
import { useTranslation } from 'react-i18next';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { openExternal } from '../../../lib/openExternal';
import { BillingStatus, Invoice, AvailablePlan } from '../types';
import { translateApiError } from '../../../lib/apiErrors';

type BillingState = {
  status: BillingStatus | null;
  setStatus: React.Dispatch<React.SetStateAction<BillingStatus | null>>;
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  plans: AvailablePlan[];
  setPlans: React.Dispatch<React.SetStateAction<AvailablePlan[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  actionLoading: boolean;
  setActionLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

function useBillingState(): BillingState {
  const [status, setStatus] = React.useState<BillingStatus | null>(null);
  const [invoices, setInvoices] = React.useState<Invoice[]>([]);
  const [plans, setPlans] = React.useState<AvailablePlan[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionLoading, setActionLoading] = React.useState(false);
  return { status, setStatus, invoices, setInvoices, plans, setPlans, loading, setLoading, error, setError, actionLoading, setActionLoading };
}

async function postBillingAction(apiBase: string, endpoint: string, body?: unknown) {
  const init: RequestInit = { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return fetch(`${apiBase}${endpoint}`, init);
}

function useBillingFetch(state: BillingState, apiBase: string, t: (k: string) => string) {
  const { setStatus, setInvoices, setPlans, setLoading, setError } = state;
  return React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, invoicesRes, plansRes] = await Promise.all([
        fetch(`${apiBase}/billing/status`, { credentials: 'include' }),
        fetch(`${apiBase}/billing/invoices`, { credentials: 'include' }),
        fetch(`${apiBase}/billing/plans`, { credentials: 'include' }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      else {
        const err = await statusRes.json().catch(() => ({}));
        setError(translateApiError(err.error) || t('billing.loadFailed'));
      }
      if (invoicesRes.ok) setInvoices((await invoicesRes.json()).invoices || []);
      if (plansRes.ok) setPlans((await plansRes.json()).plans || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('common.networkError'));
    } finally {
      setLoading(false);
    }
  }, [apiBase, t, setStatus, setInvoices, setPlans, setLoading, setError]);
}

function useBillingActions(state: BillingState, apiBase: string, t: (k: string) => string, fetchData: () => Promise<void>) {
  const { setError, setActionLoading } = state;
  const handleManageBilling = async () => {
    setActionLoading(true);
    try {
      const res = await postBillingAction(apiBase, '/billing/portal-session');
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
      const res = await postBillingAction(apiBase, '/billing/checkout-session', { priceId });
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
      const res = await postBillingAction(apiBase, '/billing/cancel');
      if (res.ok) await fetchData();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.cancelFailed')); }
    setActionLoading(false);
  };
  const handleReactivate = async () => {
    setActionLoading(true);
    try {
      const res = await postBillingAction(apiBase, '/billing/reactivate');
      if (res.ok) await fetchData();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : t('billing.reactivateFailed')); }
    setActionLoading(false);
  };
  return { handleManageBilling, handleUpgrade, handleCancel, handleReactivate };
}

export function useBillingData() {
  const { t } = useTranslation();
  const apiBase = getApiBaseFromWindow();
  const state = useBillingState();
  const fetchData = useBillingFetch(state, apiBase, t);

  React.useEffect(() => { fetchData(); }, [fetchData]);

  const actions = useBillingActions(state, apiBase, t, fetchData);

  return {
    status: state.status,
    invoices: state.invoices,
    plans: state.plans,
    loading: state.loading,
    error: state.error,
    actionLoading: state.actionLoading,
    ...actions,
  };
}
