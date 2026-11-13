// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PENDING_INVITE_KEY } from '../../lib/pendingInvite';

const getEnterpriseWebModule = vi.hoisted(() => vi.fn());

vi.mock('../../lib/enterpriseWebLoader', () => ({ getEnterpriseWebModule }));
vi.mock('./hooks/useMiniModeAuthGuard', () => ({ useMiniModeAuthGuard: vi.fn() }));
vi.mock('./WorldScreen', () => ({ WorldScreen: () => <div data-testid="world" /> }));
vi.mock('./components/DesktopUpdateOverlay', () => ({ DesktopUpdateOverlay: () => null }));
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

vi.mock('../providers/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { AppRoutes } from './AppRoutes';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

let meStatus = 401;
let previewBodies: string[] = [];
let acceptBodies: string[] = [];

function urlText(url: string | URL | Request): string {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  return url.url;
}

function bodyText(init?: RequestInit): string {
  return typeof init?.body === 'string' ? init.body : '';
}

function stubFetch() {
  const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
    const u = urlText(url);
    if (u.endsWith('/public/invites/preview')) {
      previewBodies.push(bodyText(init));
      return Promise.resolve(
        jsonResponse(200, {
          tenantName: 'Acme Corp',
          role: 'member',
          status: 'pending',
          emailMasked: 'j***@acme.test',
        }),
      );
    }
    if (u.endsWith('/auth/me')) {
      return Promise.resolve(jsonResponse(meStatus, meStatus === 200 ? { id: 'u1' } : { error: 'unauthorized' }));
    }
    if (u.endsWith('/auth/login')) {
      meStatus = 200;
      return Promise.resolve(jsonResponse(200, {}));
    }
    if (u.endsWith('/invites/accept')) {
      acceptBodies.push(bodyText(init));
      return Promise.resolve(jsonResponse(200, {}));
    }
    return Promise.resolve(jsonResponse(404, { error: 'not_found' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const reloadMock = vi.fn();
const realLocation = window.location;

function installLocationShim() {
  reloadMock.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      get hash() {
        return realLocation.hash;
      },
      set hash(v: string) {
        realLocation.hash = v;
      },
      get hostname() {
        return realLocation.hostname;
      },
      get host() {
        return realLocation.host;
      },
      get href() {
        return realLocation.href;
      },
      set href(v: string) {
        realLocation.href = v;
      },
      get protocol() {
        return realLocation.protocol;
      },
      get search() {
        return realLocation.search;
      },
      get origin() {
        return realLocation.origin;
      },
      reload: reloadMock,
      toString() {
        return realLocation.href;
      },
    },
  });
}

function restoreLocation() {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: realLocation });
}

beforeEach(() => {
  meStatus = 401;
  previewBodies = [];
  acceptBodies = [];
  sessionStorage.clear();
  stubFetch();
  installLocationShim();
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreLocation();
  getEnterpriseWebModule.mockReset();
});

describe('AppRoutes auth remount', () => {
  it('shows the login form after choosing sign in on an invite link', async () => {
    window.location.hash = '#/?invite=CODE1';
    render(<AppRoutes />);

    expect(await screen.findByText('auth.inviteAccept.inviteTitle')).toBeTruthy();

    fireEvent.click(screen.getByText('auth.inviteLoginLink'));
    window.dispatchEvent(new Event('hashchange'));

    expect(window.location.hash).toBe('#/login');
    expect(await screen.findByText('auth.loginTitle')).toBeTruthy();
    expect(screen.queryByText('auth.inviteTitle')).toBeNull();
  });

  it('shows the invite acceptance after returning from sign in', async () => {
    window.location.hash = '#/login';
    render(<AppRoutes />);

    expect(await screen.findByText('auth.loginTitle')).toBeTruthy();
    previewBodies = [];

    window.location.hash = '#/?invite=CODE2';
    window.dispatchEvent(new Event('hashchange'));

    expect(await screen.findByText('auth.inviteAccept.inviteTitle')).toBeTruthy();
    await waitFor(() => expect(previewBodies.some((b) => b.includes('CODE2'))).toBe(true));
  });

  it('accepts the stored invitation once after signing in', async () => {
    window.location.hash = '#/?invite=CODE3';
    const { container } = render(<AppRoutes />);

    expect(await screen.findByText('auth.inviteAccept.inviteTitle')).toBeTruthy();

    fireEvent.click(screen.getByText('auth.inviteLoginLink'));
    window.dispatchEvent(new Event('hashchange'));

    expect(window.location.hash).toBe('#/login');
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe('CODE3');
    expect(await screen.findByText('auth.loginTitle')).toBeTruthy();

    const emailInput = container.querySelector('input[name="email"]');
    const passwordInput = container.querySelector('input[name="password"]');
    if (!emailInput || !passwordInput) throw new Error('login form missing: expected email and password inputs');

    fireEvent.change(emailInput, { target: { value: 'j@acme.test' } });
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByText('auth.loginSubmit'));

    await waitFor(() => expect(window.location.hash).toBe('#/?invite=CODE3'));
    window.dispatchEvent(new Event('hashchange'));

    await waitFor(() => expect(acceptBodies).toHaveLength(1));
    expect(acceptBodies[0]).toBe(JSON.stringify({ code: 'CODE3' }));
    await waitFor(() => expect(window.location.hash).toBe('#/app'));
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
