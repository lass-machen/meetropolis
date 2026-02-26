import React from 'react';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { PaymentStatus } from '../types';

const POLL_INTERVAL = 60_000;

export function usePaymentStatus({ enabled }: { enabled: boolean }) {
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const apiBase = getApiBaseFromWindow();

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/billing/payment-status`, { credentials: 'include' });
      if (res.ok) {
        setPaymentStatus(await res.json());
      }
    } catch {
      // Silently ignore – banner simply won't show
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [enabled, fetchStatus]);

  const handleManageBilling = React.useCallback(async () => {
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
    } catch {
      // ignore
    }
  }, [apiBase]);

  return { paymentStatus, loading, handleManageBilling };
}
