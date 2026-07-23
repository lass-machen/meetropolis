import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMeOnce, runFetchMe, type UseFetchMeParams, type FetchMeRetryOptions } from './useFetchMe';

const FAST_RETRY: FetchMeRetryOptions = {
  maxAttempts: 3,
  backoff: { baseDelayMs: 0, maxDelayMs: 0, jitterMs: 0 },
};

function makeParams(overrides: Partial<UseFetchMeParams> = {}): UseFetchMeParams {
  return {
    apiBase: 'https://api.test',
    localPosRef: { current: { id: '' } },
    setMe: vi.fn(),
    setIsInternalOwner: vi.fn(),
    setCapabilities: vi.fn(),
    setPositionReady: vi.fn(),
    setAuthChecked: vi.fn(),
    setAuthOffline: vi.fn(),
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as unknown as Response;
}

const OK_USER = {
  id: 'u1',
  email: 'u1@test',
  name: 'User One',
  role: 'member',
  lastPosition: { x: 10, y: 20 },
};

describe('fetchMeOnce', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('classifies a 200 as ok and returns the parsed user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, OK_USER)));
    const result = await fetchMeOnce('https://api.test');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.user.id).toBe('u1');
  });

  it('classifies 401 as unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    expect((await fetchMeOnce('https://api.test')).status).toBe('unauthorized');
  });

  it('classifies 403 as unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' })));
    expect((await fetchMeOnce('https://api.test')).status).toBe('unauthorized');
  });

  it('classifies a 5xx as a transient network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { error: 'unavailable' })));
    expect((await fetchMeOnce('https://api.test')).status).toBe('network-error');
  });

  it('classifies 429 and 408 as transient network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {})));
    expect((await fetchMeOnce('https://api.test')).status).toBe('network-error');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(408, {})));
    expect((await fetchMeOnce('https://api.test')).status).toBe('network-error');
  });

  it('classifies a fetch rejection as a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect((await fetchMeOnce('https://api.test')).status).toBe('network-error');
  });
});

describe('runFetchMe boot behavior', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs the user in on a 200 and clears the offline flag', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, OK_USER)));
    const params = makeParams();

    await runFetchMe(params, { cancelled: false }, FAST_RETRY);

    expect(params.setMe).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1', email: 'u1@test' }));
    expect(params.setAuthChecked).toHaveBeenCalledWith(true);
    expect(params.setPositionReady).toHaveBeenCalledWith(true);
    expect(params.setAuthOffline).toHaveBeenCalledWith(false);
    expect(params.setMe).not.toHaveBeenCalledWith(null);
  });

  it('logs out on a 401 (definitive unauthorized)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'unauthorized' })));
    const params = makeParams();

    await runFetchMe(params, { cancelled: false }, FAST_RETRY);

    expect(params.setMe).toHaveBeenCalledWith(null);
    expect(params.setAuthChecked).toHaveBeenCalledWith(true);
    expect(params.setAuthOffline).toHaveBeenCalledWith(false);
  });

  it('holds the session on a network error and keeps polling beyond the backoff ramp', async () => {
    const control = { cancelled: false };
    const fetchMock = vi.fn().mockImplementation(() => {
      // End the test once the loop has demonstrably outlived the ramp;
      // in production it would keep polling at the capped delay.
      if (fetchMock.mock.calls.length >= FAST_RETRY.maxAttempts + 2) control.cancelled = true;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const params = makeParams();

    await runFetchMe(params, control, FAST_RETRY);

    // The critical H8 guarantee: a transient outage must not null the session
    // or mark auth as "checked" (which would bounce the user to /login).
    expect(params.setMe).not.toHaveBeenCalled();
    expect(params.setAuthChecked).not.toHaveBeenCalled();
    expect(params.setAuthOffline).toHaveBeenCalledWith(true);
    // An outage longer than the ramp must not strand the user on a dead
    // offline screen: the loop keeps retrying past maxAttempts.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(FAST_RETRY.maxAttempts);
  });

  it('recovers to a signed-in state once the network returns mid-retry', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, OK_USER));
    vi.stubGlobal('fetch', fetchMock);
    const params = makeParams();

    await runFetchMe(params, { cancelled: false }, FAST_RETRY);

    expect(params.setAuthOffline).toHaveBeenCalledWith(true);
    expect(params.setAuthOffline).toHaveBeenLastCalledWith(false);
    expect(params.setMe).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
    expect(params.setAuthChecked).toHaveBeenCalledWith(true);
  });

  it('stops touching state once cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, OK_USER)));
    const params = makeParams();

    await runFetchMe(params, { cancelled: true }, FAST_RETRY);

    expect(params.setMe).not.toHaveBeenCalled();
    expect(params.setAuthChecked).not.toHaveBeenCalled();
  });
});
