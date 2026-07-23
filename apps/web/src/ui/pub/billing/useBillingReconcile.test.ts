// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBillingReconcile } from './useBillingReconcile';

function stubFetch(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('useBillingReconcile', () => {
  it('treats applied as provisioned and reports the new cap', async () => {
    stubFetch({ reconciled: true, outcome: 'applied', status: 'active', concurrentLimit: 5 });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'done',
        concurrentLimit: 5,
        subscriptionStatus: 'active',
      }),
    );
  });

  // The subscription status is what tells the success page whether it may say
  // "nothing has been charged yet" — dropping it would put that claim on every
  // completed checkout, including the ones that charge immediately.
  it('carries the subscription status through to the done state', async () => {
    stubFetch({ reconciled: true, outcome: 'applied', status: 'trialing', concurrentLimit: 5 });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'done', subscriptionStatus: 'trialing' }));
  });

  it('reports a missing or empty status as unknown rather than inventing one', async () => {
    stubFetch({ reconciled: true, outcome: 'applied', status: null, concurrentLimit: 5 });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'done', subscriptionStatus: null }));
  });

  it('treats already_current as provisioned — the call is idempotent', async () => {
    stubFetch({ reconciled: true, outcome: 'already_current', status: 'active', concurrentLimit: 5 });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('done'));
  });

  it.each(['no_subscription', 'session_incomplete'])('reports %s as pending, not success', async (outcome) => {
    stubFetch({ reconciled: false, outcome, status: null, concurrentLimit: null });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('pending'));
  });

  it.each(['pack_session', 'not_connection_subscription'])('reports %s as nothing to do', async (outcome) => {
    stubFetch({ reconciled: false, outcome, status: null, concurrentLimit: null });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('not-applicable'));
  });

  it('never claims success on a 502 from Stripe', async () => {
    stubFetch({ error: 'reconcile_failed' }, false, 502);
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });

  it('never claims success on an unknown outcome', async () => {
    stubFetch({ reconciled: true, outcome: 'something_new' });
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });

  it('fails closed on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(result.current.state.status).toBe('failed'));
  });

  it('sends the sessionId when present', async () => {
    const fetchMock = stubFetch({ outcome: 'applied', concurrentLimit: 5 });
    renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/billing/reconcile');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'cs_123' });
  });

  it('works without a sessionId — a stripped return URL still reconciles', async () => {
    const fetchMock = stubFetch({ outcome: 'applied', concurrentLimit: 5 });
    renderHook(() => useBillingReconcile('http://api.test', undefined));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({});
  });

  it('retries on demand and can recover from pending to done', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ outcome: 'no_subscription' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ outcome: 'applied', concurrentLimit: 5 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useBillingReconcile('http://api.test', 'cs_123'));
    await waitFor(() => expect(result.current.state.status).toBe('pending'));

    result.current.retry();
    await waitFor(() => expect(result.current.state.status).toBe('done'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
