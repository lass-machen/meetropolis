import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePublicConfigStore } from './publicConfigStore';

function resetStore(): void {
  usePublicConfigStore.setState({
    registrationEnabled: true,
    billingEnabled: false,
    avatarEditorEnabled: false,
    ads: null,
    loaded: false,
  });
}

describe('publicConfigStore ads block', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the ads consent config from the public config', async () => {
    const ads = { googleAdsId: 'AW-123456789', signupConversionLabel: 'AbC123', consentMode: 'banner' };
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ads }) }) as unknown as Response),
    );

    await usePublicConfigStore.getState().load('http://api.test');

    expect(usePublicConfigStore.getState().ads).toEqual(ads);
  });

  it('falls back to null when the ads block is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) as unknown as Response),
    );

    await usePublicConfigStore.getState().load('http://api.test');

    expect(usePublicConfigStore.getState().ads).toBeNull();
  });

  it('falls back to null when the ads block is not an object', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          Promise.resolve({ ok: true, json: () => Promise.resolve({ ads: 'AW-123456789' }) }) as unknown as Response,
      ),
    );

    await usePublicConfigStore.getState().load('http://api.test');

    expect(usePublicConfigStore.getState().ads).toBeNull();
  });
});
