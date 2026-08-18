import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { AppRoutes } from './AppRoutes';
import { useMiniModeAuthGuard } from './hooks/useMiniModeAuthGuard';

/**
 * The desktop client's window size hangs off one expression in AppRoutes. Its
 * exact inverse — reporting the world as a public page and vice versa — used to
 * pass the whole suite, because nothing rendered AppRoutes and looked at what the
 * guard was told. This file does exactly that, with every route target stubbed:
 * the subject is the wiring from the hash to the reported page, nothing else.
 */
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

/** The page the guard was told about on the most recent render. */
function reportedPage(): unknown {
  const calls = vi.mocked(useMiniModeAuthGuard).mock.calls;
  return calls[calls.length - 1]?.[0];
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
  vi.clearAllMocks();
});

describe('AppRoutes mini-mode wiring', () => {
  it('reports the login page as public, so the window leaves mini mode', () => {
    window.location.hash = '#/login';
    render(<AppRoutes />);
    expect(reportedPage()).toBe('public');
  });

  it('reports the world route as undecided, leaving the verdict to WorldApp', () => {
    // Not 'world': on the world route the session may still be unconfirmed, and
    // shrinking before the verdict is what put the login page in a 340px window.
    window.location.hash = '#/app';
    render(<AppRoutes />);
    expect(reportedPage()).toBe('unknown');
  });

  it.each(['#/register', '#/reset?token=t', '#/invite', '#/billing/success', '#/verify?token=t', '#/contact'])(
    'reports %s as public',
    (hash) => {
      window.location.hash = hash;
      render(<AppRoutes />);
      expect(reportedPage()).toBe('public');
    },
  );

  it('follows a hash change from the world to the login page', () => {
    window.location.hash = '#/app';
    render(<AppRoutes />);
    expect(reportedPage()).toBe('unknown');

    act(() => {
      window.location.hash = '#/login';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(reportedPage()).toBe('public');
  });
});
