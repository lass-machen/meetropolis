import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BillingSuccessPage, settledCopyKeyFor } from './BillingSuccessPage';
import { getTelemetryModule, type TelemetryModule } from '../../../lib/telemetryLoader';

// Default to the OSS build shape (no telemetry module), so the existing
// copy-only cases above stay green; the conversion cases below override this
// per test with a module carrying a trackTrialStarted spy.
vi.mock('../../../lib/telemetryLoader', () => ({
  getTelemetryModule: vi.fn(() => Promise.resolve(null)),
}));

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

describe('BillingSuccessPage trial conversion', () => {
  const mockedGetTelemetryModule = vi.mocked(getTelemetryModule);

  function stubReconcile(body: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function renderTrialPage() {
    const onNavigate = vi.fn();
    const view = render(<BillingSuccessPage onNavigate={onNavigate} apiBase="http://api.test" sessionId="cs_123" />);
    return { ...view, onNavigate };
  }

  function moduleWith(spy: ReturnType<typeof vi.fn>) {
    return { trackTrialStarted: spy } as unknown as TelemetryModule;
  }

  beforeEach(() => {
    sessionStorage.clear();
    mockedGetTelemetryModule.mockReset();
    mockedGetTelemetryModule.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    {
      outcome: 'applied',
      body: { outcome: 'applied', status: 'trialing', concurrentLimit: 7 },
      title: 'billing.trialStartedTitle',
      calls: 1,
    },
    {
      outcome: 'already_current',
      body: { outcome: 'already_current', status: 'trialing', concurrentLimit: 7 },
      title: 'billing.trialStartedTitle',
      calls: 1,
    },
    {
      outcome: 'applied',
      body: { outcome: 'applied', status: 'active', concurrentLimit: 7 },
      title: 'billing.successTitle',
      calls: 0,
    },
    {
      outcome: 'applied',
      body: { outcome: 'applied', status: 'past_due', concurrentLimit: 7 },
      title: 'billing.subscriptionReadyTitle',
      calls: 0,
    },
    {
      outcome: 'applied',
      body: { outcome: 'applied', concurrentLimit: 7 },
      title: 'billing.subscriptionReadyTitle',
      calls: 0,
    },
  ])('outcome $outcome with status $body.status reports $calls conversion(s)', async ({ body, title, calls }) => {
    const trackTrialStarted = vi.fn();
    mockedGetTelemetryModule.mockResolvedValue(moduleWith(trackTrialStarted));
    const fetchMock = stubReconcile(body);
    const { unmount } = renderTrialPage();
    try {
      // Wait for the settled state first: a zero-call assertion before the
      // reconcile ran would pass vacuously.
      await screen.findByText(title);
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      if (calls === 1) {
        await waitFor(() => expect(trackTrialStarted).toHaveBeenCalledTimes(1));
        expect(trackTrialStarted).toHaveBeenCalledWith({ concurrentLimit: 7 });
      } else {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(trackTrialStarted).not.toHaveBeenCalled();
      }
    } finally {
      unmount();
    }
  });

  it('reports only once when a trialing page renders twice in the same session', async () => {
    const trackTrialStarted = vi.fn();
    mockedGetTelemetryModule.mockResolvedValue(moduleWith(trackTrialStarted));
    stubReconcile({ outcome: 'applied', status: 'trialing', concurrentLimit: 7 });

    const first = renderTrialPage();
    await screen.findByText('billing.trialStartedTitle');
    await waitFor(() => expect(trackTrialStarted).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderTrialPage();
    try {
      await screen.findByText('billing.trialStartedTitle');
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(trackTrialStarted).toHaveBeenCalledTimes(1);
    } finally {
      second.unmount();
    }
  });
});
