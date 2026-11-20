// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'de', changeLanguage: () => Promise.resolve() },
  }),
}));

const ads = {
  googleAdsId: 'AW-123456789',
  signupConversionLabel: 'AbC123',
  consentMode: 'banner' as const,
};

// The settings link is a module-level React.lazy, so each case re-imports the
// footer with a fresh module registry and its own brand loader result.
async function renderFooterWithBrand(brand: unknown) {
  vi.resetModules();
  vi.doMock('../../../lib/brandLoader', () => ({
    getBrandModule: () => Promise.resolve(brand),
  }));
  const { PublicFooter } = await import('./PublicFooter');
  const { usePublicConfigStore } = await import('../../../state/publicConfigStore');
  usePublicConfigStore.setState({ ads });
  render(<PublicFooter navigate={() => {}} />);
  // Let the lazy brand import settle so absence stays absence.
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  vi.doUnmock('../../../lib/brandLoader');
});

describe('PublicFooter — ads consent settings link', () => {
  it('renders the brand settings link when the brand module provides it', async () => {
    await renderFooterWithBrand({
      AdsConsentSettingsLink: () => <a href="#ads-settings">ads-settings-link</a>,
    });

    expect(await screen.findByText('ads-settings-link')).toBeTruthy();
  });

  it('renders nothing without a brand module', async () => {
    await renderFooterWithBrand(null);

    expect(await screen.findByText('footer.legalPrivacy')).toBeTruthy();
    expect(screen.queryByText('ads-settings-link')).toBeNull();
  });

  it('renders nothing when the brand module lacks the export', async () => {
    await renderFooterWithBrand({});

    expect(await screen.findByText('footer.legalPrivacy')).toBeTruthy();
    expect(screen.queryByText('ads-settings-link')).toBeNull();
  });
});
