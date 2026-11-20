// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule: vi.fn() }));
vi.mock('./hooks/useMiniModeAuthGuard', () => ({ useMiniModeAuthGuard: vi.fn() }));
vi.mock('./WorldScreen', () => ({ WorldScreen: () => <div data-testid="world" /> }));
vi.mock('./components/DesktopUpdateOverlay', () => ({ DesktopUpdateOverlay: () => null }));
vi.mock('../../ui/pub/auth/AuthPage', () => ({ AuthPage: () => <div data-testid="auth" /> }));
vi.mock('../../ui/pub/landing/LandingPage', () => ({ LandingPage: () => null }));
vi.mock('../../ui/pub/download/DesktopDownloadPage', () => ({ DesktopDownloadPage: () => null }));
vi.mock('../../ui/pub/billing/BillingSuccessPage', () => ({ BillingSuccessPage: () => null }));
vi.mock('../../ui/pub/billing/BillingCancelPage', () => ({ BillingCancelPage: () => null }));
vi.mock('../../ui/pub/billing/EmailVerifyPage', () => ({ EmailVerifyPage: () => null }));
vi.mock('../../ui/pub/contact/ContactPage', () => ({ ContactPage: () => null }));
vi.mock('../../ui/pub/legal/SimpleLegalNotice', () => ({ SimpleLegalNotice: () => null }));

// vi.mock factories are hoisted above module-level constants, so the shared
// config is created through vi.hoisted.
const { ads } = vi.hoisted(() => ({
  ads: {
    googleAdsId: 'AW-123456789',
    signupConversionLabel: 'AbC123',
    consentMode: 'banner',
  },
}));

vi.mock('../../lib/brandLoader', () => ({
  getBrandModule: () =>
    Promise.resolve({
      AdsConsent: () => <div data-testid="ads-consent" />,
      PrivacyPolicyPage: (props: { adsConfig?: unknown }) => (
        <div data-testid="privacy-page" data-ads={JSON.stringify(props.adsConfig ?? null)} />
      ),
    }),
  useHasBrandModule: () => ({ loading: false, hasBrand: true }),
}));
vi.mock('../../state/publicConfigStore', () => {
  const state = { registrationEnabled: true, load: async () => {}, ads };
  return { usePublicConfigStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'de', resolvedLanguage: 'de', changeLanguage: () => Promise.resolve() },
  }),
}));

import { AppRoutes } from './AppRoutes';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('AppRoutes — brand ads consent', () => {
  it('renders the brand ads consent on the landing route', async () => {
    window.location.hash = '#/';

    render(<AppRoutes />);

    expect(await screen.findByTestId('ads-consent')).toBeTruthy();
  });

  it('does not render the brand ads consent inside the app', async () => {
    window.location.hash = '#/app';

    render(<AppRoutes />);

    // Wait until the app route has rendered and lazy imports had time to settle.
    expect(await screen.findByTestId('world')).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByTestId('ads-consent')).toBeNull();
  });

  it('passes the ads config to the privacy policy page', async () => {
    window.location.hash = '#/privacy';

    render(<AppRoutes />);

    const page = await screen.findByTestId('privacy-page');
    expect(page.getAttribute('data-ads')).toBe(JSON.stringify(ads));
  });
});
