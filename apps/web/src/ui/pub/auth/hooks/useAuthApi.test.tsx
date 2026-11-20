// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthApi } from './useAuthApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'common.networkError' ? 'Netzwerkfehler' : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

describe('useAuthApi post', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the translated network error when the server cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const { result } = renderHook(() => useAuthApi('http://api.test'));
    const pending = result.current.post('/auth/login', { email: 'jane@acme.test' });
    const settled = pending.then(
      () => {
        throw new Error('expected post to reject');
      },
      (e: unknown) => e as Error,
    );
    await vi.runAllTimersAsync();
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Netzwerkfehler');
    expect(err.message).not.toContain('Failed to fetch');
  });
});
