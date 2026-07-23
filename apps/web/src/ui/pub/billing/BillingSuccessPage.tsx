import React from 'react';
import { useTranslation } from 'react-i18next';
import { PublicLayout } from '../layout/PublicLayout';
import { PubCard } from '../components/PubCard';
import { PubButton } from '../components/PubButton';
import { useBillingReconcile, type ReconcileState } from './useBillingReconcile';
import { getTelemetryModule } from '../../../lib/telemetryLoader';

/**
 * Guards the trial conversion against a reload of this page. Session-scoped on
 * purpose: reloading the thank-you page must not report a second trial, while a
 * genuinely new checkout in a new session still counts.
 */
const TRIAL_EVENT_GUARD_KEY = 'meetropolis.trialStartedReported';

function alreadyReportedTrial(): boolean {
  try {
    return window.sessionStorage.getItem(TRIAL_EVENT_GUARD_KEY) === '1';
  } catch {
    // Private mode / storage disabled: fall back to the in-render ref only.
    return false;
  }
}

function markTrialReported(): void {
  try {
    window.sessionStorage.setItem(TRIAL_EVENT_GUARD_KEY, '1');
  } catch {
    // Storage is optional; the ref still prevents a double fire in this mount.
  }
}

interface BillingSuccessPageProps {
  onNavigate: () => void;
  apiBase: string;
  /** Stripe Checkout Session id from the return URL, when present. */
  sessionId?: string | undefined;
}

/**
 * Which confirmation copy a settled reconcile may honestly show.
 *
 * The page must not guess about money. A completed checkout is NOT always a
 * trial start: the double-trial guard withholds the trial from an email that
 * already consumed one, and that customer is charged on the spot. And `done`
 * also covers `already_current`, i.e. someone re-opening this URL on a running
 * subscription. So the copy follows the subscription status the server actually
 * read from Stripe:
 *   - `trialing` → trial copy ("nothing has been charged yet"),
 *   - `active`   → payment copy (the first invoice was paid),
 *   - anything else (`past_due`, an unknown status, none reported) → a neutral
 *     "subscription is set up" that claims nothing about a payment. Claiming a
 *     successful payment for a `past_due` subscription would be the same
 *     dishonesty as the trial claim, only in the other direction.
 * `not-applicable` is a pack-marketplace checkout, which is charged immediately.
 */
type SettledCopyKey = 'trialStarted' | 'success' | 'subscriptionReady';

export function settledCopyKeyFor(state: ReconcileState): SettledCopyKey {
  if (state.status !== 'done') return 'success';
  if (state.subscriptionStatus === 'trialing') return 'trialStarted';
  if (state.subscriptionStatus === 'active') return 'success';
  return 'subscriptionReady';
}

function CheckCircleIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill="var(--pub-icon-bg-teal)" />
      <path
        d="M16 24L22 30L32 18"
        stroke="var(--pub-accent-teal)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Spinner-free waiting state: the reconcile is usually a single fast call. */
function ReconcilingCard({ label }: { label: string }) {
  return (
    <>
      <h2 className="pub-text-h4" style={{ margin: 0 }}>
        {label}
      </h2>
    </>
  );
}

export function BillingSuccessPage({ onNavigate, apiBase, sessionId }: BillingSuccessPageProps) {
  const { t } = useTranslation('public');
  const { state, retry } = useBillingReconcile(apiBase, sessionId);
  // 'not-applicable' means there was nothing of ours to provision (a pack
  // purchase); the checkout itself still succeeded, so it reads as done.
  const settled = state.status === 'done' || state.status === 'not-applicable';
  const settledCopyKey = settledCopyKeyFor(state);

  // Report the trial to the funnel exactly once, and only for a real
  // subscription: `not-applicable` is a pack purchase, `pending`/`failed` mean
  // the office is not there yet — counting either as a conversion would report
  // trials that never started. Fired here rather than server-side because the
  // ads conversion is attributed from the browser that still holds the click id.
  const trialReported = React.useRef(false);
  React.useEffect(() => {
    if (state.status !== 'done') return;
    if (trialReported.current || alreadyReportedTrial()) return;
    trialReported.current = true;
    markTrialReported();
    const { concurrentLimit } = state;
    void getTelemetryModule()
      .then((t) => t?.trackTrialStarted({ concurrentLimit }))
      .catch(() => {});
  }, [state]);

  React.useEffect(() => {
    // Only leave once the office is actually there. Auto-navigating away from a
    // pending or failed reconcile would hide the retry the customer needs. The
    // conversion above fires on the settled state, not on this timer, so a slow
    // reconcile can never race the redirect and drop it.
    if (!settled) return;
    const timer = setTimeout(onNavigate, 4000);
    return () => clearTimeout(timer);
  }, [onNavigate, settled]);

  const navigate = (route: string) => {
    window.location.hash = `#/${route}`;
  };

  return (
    <PublicLayout onLogin={() => navigate('app')} onSignup={() => navigate('register')} navigate={navigate}>
      <div
        style={{
          minHeight: 'calc(100vh - 160px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--pub-section-padding)',
        }}
      >
        <PubCard
          variant="surface"
          style={{
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            padding: '48px 40px',
          }}
        >
          {state.status === 'reconciling' && <ReconcilingCard label={t('billing.reconcilingTitle')} />}

          {settled && (
            <>
              <CheckCircleIcon />
              <h2 className="pub-text-h4" style={{ margin: 0 }}>
                {t(`billing.${settledCopyKey}Title`)}
              </h2>
              <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
                {t(`billing.${settledCopyKey}Text`)}
              </p>
              <PubButton variant="primary" onClick={onNavigate} style={{ marginTop: 8 }}>
                {t('billing.successButton')}
              </PubButton>
            </>
          )}

          {(state.status === 'pending' || state.status === 'failed') && (
            <>
              <h2 className="pub-text-h4" style={{ margin: 0 }}>
                {t('billing.processingTitle')}
              </h2>
              <p className="pub-text-body" style={{ color: 'var(--pub-text-secondary)', margin: 0 }}>
                {t(state.status === 'pending' ? 'billing.processingText' : 'billing.reconcileFailedText')}
              </p>
              <PubButton variant="primary" onClick={retry} style={{ marginTop: 8 }}>
                {t('billing.reconcileRetry')}
              </PubButton>
              <PubButton variant="ghost" onClick={onNavigate}>
                {t('billing.successButton')}
              </PubButton>
            </>
          )}
        </PubCard>
      </div>
    </PublicLayout>
  );
}
