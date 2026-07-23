import React from 'react';
import { getApiBaseFromWindow } from '../../../lib/apiBase';
import { openExternal } from '../../../lib/openExternal';
import { usePublicConfigStore } from '../../../state/publicConfigStore';
import { PaymentStatus } from '../types';

const POLL_INTERVAL = 60_000;

export function usePaymentStatus({ enabled }: { enabled: boolean }) {
  const [paymentStatus, setPaymentStatus] = React.useState<PaymentStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const apiBase = getApiBaseFromWindow();
  const billingEnabled = usePublicConfigStore((s) => s.billingEnabled);
  const publicConfigLoaded = usePublicConfigStore((s) => s.loaded);

  const fetchStatus = React.useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/billing/payment-status`, { credentials: 'include' });
      if (res.ok) {
        setPaymentStatus((await res.json()) as PaymentStatus);
      }
    } catch {
      // Silently ignore: the banner simply will not show.
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  React.useEffect(() => {
    if (!enabled) return;
    if (!publicConfigLoaded) return;
    if (!billingEnabled) return;
    setLoading(true);
    void fetchStatus();
    const id = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [enabled, billingEnabled, publicConfigLoaded, fetchStatus]);

  const handleManageBilling = React.useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/billing/portal-session`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const { url } = (await res.json()) as { url?: string };
        if (url) await openExternal(url);
      }
    } catch {
      // ignore
    }
  }, [apiBase]);

  return { paymentStatus, loading, handleManageBilling };
}
