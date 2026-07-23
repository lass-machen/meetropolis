import { useCallback, useEffect, useState } from 'react';
import { normalizePlans, type CatalogPlan } from './pricing';

export interface PricingPlansResult {
  plans: CatalogPlan[] | null;
  loading: boolean;
  error: string | null;
  /** Re-fetch the catalog. For the retry the error state offers. */
  retry: () => void;
}

/**
 * Fetch the public pricing catalog (`GET /public/pricing-plans`) for the
 * commercial signup step. Only runs when `enabled` (i.e. billing is available):
 * pure-OSS deployments never call the EE endpoint. The catalog is the single
 * source of truth for names, caps and net prices (E5.1/E5.8) — the wizard no
 * longer hardcodes plans.
 */
export function usePricingPlans(apiBase: string, enabled: boolean): PricingPlansResult {
  const [plans, setPlans] = useState<CatalogPlan[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/public/pricing-plans`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`pricing_plans_http_${r.status}`))))
      .then((data) => {
        // The endpoint answers 503 `catalog_unavailable` when the backend is
        // broken and reserves 200 + `{plans: []}` for "genuinely no tiers
        // configured". Both used to arrive here as an empty list, so an outage
        // rendered as a confident "no plans available". Only the 200 path may
        // set `plans`; anything else falls through to `error` and lets the view
        // offer a retry.
        if (!cancelled) {
          setPlans(normalizePlans(data));
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPlans(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled, attempt]);

  return { plans, loading, error, retry };
}
