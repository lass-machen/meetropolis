import { useCallback, useEffect, useState } from 'react';
import { logger } from '../../../lib/logger';

/**
 * Claim the checkout result instead of assuming it.
 *
 * The success page used to congratulate the customer the moment Stripe
 * redirected back, which is a promise the page cannot keep: provisioning
 * happens on a webhook, and a late or lost webhook left a paying customer
 * looking at a confirmation for an office that was not there. `POST
 * /billing/reconcile` reads the session from Stripe directly and applies it, so
 * the page can wait for a real answer before claiming anything.
 *
 * The call is idempotent — safe to retry, and a no-op once the office is
 * current — so a retry button costs nothing.
 */

/** What the page should tell the customer. */
export type ReconcileState =
  | { status: 'reconciling' }
  /**
   * Provisioned — 'applied' or 'already_current'.
   *
   * `subscriptionStatus` is the tenant's subscription state as the server just
   * read it from Stripe ('trialing' | 'active' | 'past_due' | …), or null when
   * the response did not carry one. It is what decides whether the page may say
   * "nothing has been charged": a checkout does NOT always grant a trial (the
   * double-trial guard withholds it from anyone who already used one), so
   * "provisioned" alone is no evidence either way.
   */
  | { status: 'done'; concurrentLimit: number | null; subscriptionStatus: string | null }
  /** Stripe has nothing (yet): worth retrying. */
  | { status: 'pending' }
  /** Nothing to reconcile here (a pack purchase, not a subscription). */
  | { status: 'not-applicable' }
  /** The call itself failed; retrying may help. */
  | { status: 'failed' };

interface ReconcileResponse {
  reconciled?: unknown;
  outcome?: unknown;
  concurrentLimit?: unknown;
  /** Subscription status the server applied ('trialing' | 'active' | …). */
  status?: unknown;
}

function classify(body: ReconcileResponse): ReconcileState {
  const outcome = typeof body.outcome === 'string' ? body.outcome : '';
  const limit = typeof body.concurrentLimit === 'number' ? body.concurrentLimit : null;
  const subscriptionStatus = typeof body.status === 'string' && body.status ? body.status : null;
  switch (outcome) {
    case 'applied':
    case 'already_current':
      return { status: 'done', concurrentLimit: limit, subscriptionStatus };
    case 'no_subscription':
    case 'session_incomplete':
      return { status: 'pending' };
    case 'pack_session':
    case 'not_connection_subscription':
      return { status: 'not-applicable' };
    default:
      // An outcome we do not know is not something to celebrate.
      return { status: 'failed' };
  }
}

export interface UseBillingReconcileResult {
  state: ReconcileState;
  /** Run the reconcile again. Safe: the endpoint is idempotent. */
  retry: () => void;
}

/**
 * Reconcile once on mount, and on demand thereafter.
 * `sessionId` is optional — the endpoint also works without it (it falls back
 * to the tenant's current subscription), so a stripped return URL still lands.
 */
export function useBillingReconcile(apiBase: string, sessionId: string | undefined): UseBillingReconcileResult {
  const [state, setState] = useState<ReconcileState>({ status: 'reconciling' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setState({ status: 'reconciling' });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`${apiBase}/billing/reconcile`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sessionId ? { sessionId } : {}),
        });
        if (cancelled) return;
        if (!res.ok) {
          // 502 means Stripe was unreachable — a retry is genuinely useful.
          // 4xx means this session is not ours to apply; retrying will not fix
          // it, but the state is the same from the customer's side: we cannot
          // confirm, so we do not pretend to.
          logger.debug('[billing/reconcile] http error', res.status);
          setState({ status: 'failed' });
          return;
        }
        setState(classify((await res.json()) as ReconcileResponse));
      } catch (e) {
        if (cancelled) return;
        logger.debug('[billing/reconcile] network error', e);
        setState({ status: 'failed' });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [apiBase, sessionId, attempt]);

  return { state, retry };
}
