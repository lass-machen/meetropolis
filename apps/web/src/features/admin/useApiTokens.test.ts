import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { fetchApiTokens, useApiTokensLoader } from './useApiTokens';

const TOKEN = { id: 't1', name: 'ci', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };

function stubFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => Promise.resolve(response.body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderLoader(open = true) {
  const setFreshToken = vi.fn();
  const setApiTokens = vi.fn();
  const onLoadState = vi.fn();
  renderHook(() => useApiTokensLoader({ apiBase: '/api', open, setFreshToken, setApiTokens, onLoadState }));
  return { setFreshToken, setApiTokens, onLoadState };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchApiTokens', () => {
  it('rejects on a non-2xx status instead of returning the error body', async () => {
    stubFetch({ ok: false, status: 401, body: { error: 'unauthorized' } });

    await expect(fetchApiTokens('/api')).rejects.toThrow('401');
  });

  it('rejects on a 2xx payload that is not a list', async () => {
    stubFetch({ ok: true, body: { error: 'oops' } });

    await expect(fetchApiTokens('/api')).rejects.toThrow('not a list');
  });
});

describe('useApiTokensLoader', () => {
  it('loads the list and resets the fresh token when opened', async () => {
    const fetchMock = stubFetch({ ok: true, body: [TOKEN] });
    const { setFreshToken, setApiTokens, onLoadState } = renderLoader();

    await waitFor(() => expect(setApiTokens).toHaveBeenCalledWith([TOKEN]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setFreshToken).toHaveBeenCalledWith(null);
    expect(onLoadState.mock.calls).toEqual([['loading'], ['loaded']]);
  });

  it('clears the previous list and secret before the new list arrives', async () => {
    stubFetch({ ok: true, body: [TOKEN] });
    const { setFreshToken, setApiTokens } = renderLoader();

    // Synchronously after the effect ran, before the fetch resolved.
    expect(setApiTokens.mock.calls).toEqual([[[]]]);
    expect(setFreshToken).toHaveBeenCalledWith(null);
    await waitFor(() => expect(setApiTokens).toHaveBeenCalledWith([TOKEN]));
  });

  it('does not fetch while closed', () => {
    const fetchMock = stubFetch({ ok: true, body: [TOKEN] });
    renderLoader(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to an empty list and reports the failure on a non-2xx response', async () => {
    stubFetch({ ok: false, status: 403, body: { error: 'forbidden' } });
    const { setApiTokens, onLoadState } = renderLoader();

    await waitFor(() => expect(onLoadState).toHaveBeenCalledWith('failed'));
    // Once before the fetch, once as the fallback for the failure.
    expect(setApiTokens.mock.calls).toEqual([[[]], [[]]]);
  });

  it('falls back to an empty list and reports the failure on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')));
    const { setApiTokens, onLoadState } = renderLoader();

    await waitFor(() => expect(onLoadState).toHaveBeenCalledWith('failed'));
    expect(setApiTokens).toHaveBeenCalledWith([]);
  });
});
