import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BillingSuccessPage, settledCopyKeyFor } from './BillingSuccessPage';

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

function renderPage() {
  render(<BillingSuccessPage onNavigate={vi.fn()} apiBase="http://api.test" sessionId="cs_123" />);
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('settledCopyKeyFor', () => {
  // The page must never claim a payment state it does not know. A checkout does
  // not always grant a trial — the double-trial guard withholds it from an email
  // that already used one, and that customer IS charged immediately.
  it('promises "nothing charged yet" only while the subscription is trialing', () => {
    expect(settledCopyKeyFor({ status: 'done', concurrentLimit: 5, subscriptionStatus: 'trialing' })).toBe(
      'trialStarted',
    );
  });

  it('confirms the payment for an active subscription', () => {
    expect(settledCopyKeyFor({ status: 'done', concurrentLimit: 5, subscriptionStatus: 'active' })).toBe('success');
  });

  it('claims neither a trial nor a payment for any other status', () => {
    expect(settledCopyKeyFor({ status: 'done', concurrentLimit: 5, subscriptionStatus: 'past_due' })).toBe(
      'subscriptionReady',
    );
    expect(settledCopyKeyFor({ status: 'done', concurrentLimit: 5, subscriptionStatus: null })).toBe(
      'subscriptionReady',
    );
  });

  it('keeps the payment copy for a pack purchase, which is charged immediately', () => {
    expect(settledCopyKeyFor({ status: 'not-applicable' })).toBe('success');
  });
});

describe('BillingSuccessPage', () => {
  it('shows the trial copy when the reconcile reports a trialing subscription', async () => {
    stubFetch({ outcome: 'applied', status: 'trialing', concurrentLimit: 5 });
    renderPage();

    await waitFor(() => expect(screen.getByText('billing.trialStartedTitle')).toBeInTheDocument());
    expect(screen.getByText('billing.trialStartedText')).toBeInTheDocument();
    expect(screen.queryByText('billing.successTitle')).not.toBeInTheDocument();
  });

  // Regression guard for the false money claim: this checkout charged the
  // customer on the spot (no trial granted), so the "nothing has been charged"
  // copy would be a lie.
  it('shows the payment copy — not the trial copy — for an immediately charged checkout', async () => {
    stubFetch({ outcome: 'applied', status: 'active', concurrentLimit: 5 });
    renderPage();

    await waitFor(() => expect(screen.getByText('billing.successTitle')).toBeInTheDocument());
    expect(screen.getByText('billing.successText')).toBeInTheDocument();
    expect(screen.queryByText('billing.trialStartedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('billing.trialStartedText')).not.toBeInTheDocument();
  });

  it('claims nothing about money when the subscription is past due', async () => {
    stubFetch({ outcome: 'already_current', status: 'past_due', concurrentLimit: 5 });
    renderPage();

    await waitFor(() => expect(screen.getByText('billing.subscriptionReadyTitle')).toBeInTheDocument());
    expect(screen.queryByText('billing.successTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('billing.trialStartedTitle')).not.toBeInTheDocument();
  });

  it('falls back to the neutral copy when the response carries no status', async () => {
    stubFetch({ outcome: 'applied', concurrentLimit: 5 });
    renderPage();

    await waitFor(() => expect(screen.getByText('billing.subscriptionReadyTitle')).toBeInTheDocument());
    expect(screen.queryByText('billing.trialStartedText')).not.toBeInTheDocument();
  });

  // A `not-applicable` reconcile (pack-marketplace checkout) is charged
  // immediately, so the payment-confirmation copy stays accurate there.
  it('keeps the payment-confirmation copy for a not-applicable (pack purchase) reconcile', async () => {
    stubFetch({ outcome: 'pack_session' });
    renderPage();

    await waitFor(() => expect(screen.getByText('billing.successTitle')).toBeInTheDocument());
    expect(screen.getByText('billing.successText')).toBeInTheDocument();
    expect(screen.queryByText('billing.trialStartedTitle')).not.toBeInTheDocument();
  });
});
