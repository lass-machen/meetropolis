// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
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
vi.mock('../../lib/brandLoader', () => ({
  getBrandModule: () => Promise.resolve(null),
  useHasBrandModule: () => ({ loading: false, hasBrand: false }),
}));
vi.mock('../../state/publicConfigStore', () => {
  const state = { registrationEnabled: true, load: async () => {} };
  return { usePublicConfigStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'de', resolvedLanguage: 'de', changeLanguage: () => Promise.resolve() },
  }),
}));

import { AppRoutes } from './AppRoutes';
import type { AgentConnectPageProps } from '../../lib/enterpriseWebLoader';

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('AppRoutes #/connect', () => {
  it('renders the slot without requiring login', async () => {
    const Page = ({ requestId }: AgentConnectPageProps) => <div>{`connect:${requestId ?? 'none'}`}</div>;
    getEnterpriseWebModule.mockResolvedValue({ AgentConnectPage: Page });
    window.location.hash = '#/connect?request=abc_-1';

    render(<AppRoutes />);

    expect(await screen.findByText('connect:abc_-1')).toBeTruthy();
    expect(screen.queryByTestId('auth')).toBeNull();
  });

  it('renders the unknown-route fallback when the slot is missing', async () => {
    getEnterpriseWebModule.mockResolvedValue({});
    window.location.hash = '#/connect';

    render(<AppRoutes />);

    expect(await screen.findByTestId('world')).toBeTruthy();
  });
});
