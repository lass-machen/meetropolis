// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTenantCreation } from './useTenantCreation';
import type { RegistrationData } from '../AuthPageRenderer';
import type { TenantSignupSubmission } from '../signupTypes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'de' } }),
}));

const openExternalMock = vi.fn();
vi.mock('../../../../lib/openExternal', () => ({
  openExternal: (url: string) => openExternalMock(url),
}));

// Runtime detection is mocked so each test picks the web or desktop redirect
// branch explicitly. Default: web (isDesktopEnvironment → false).
const isDesktopEnvironmentMock = vi.fn(() => false);
vi.mock('../../../../lib/desktopLoader', () => ({
  isDesktopEnvironment: () => isDesktopEnvironmentMock(),
}));

const regData: RegistrationData = {
  firstName: 'Max',
  lastName: 'Muster',
  email: 'owner@acme.test',
  password: 'supersecret',
  teamName: 'Acme',
  teamSize: '11-50',
  slug: 'acme',
  plan: 'team',
};

const commercialSubmission: TenantSignupSubmission = {
  tierKey: 'team',
  b2b: {
    companyLegalName: 'Acme GmbH',
    legalForm: 'GmbH',
    billingCountry: 'DE',
    vatId: 'DE123456789',
    b2bDeclaration: true,
    agbVersion: '2026-07-01',
  },
};

function makeArgs(overrides: Partial<Parameters<typeof useTenantCreation>[0]> = {}) {
  return {
    apiBase: 'http://api.test',
    regData,
    setError: vi.fn(),
    setSlugError: vi.fn(),
    setSubmitLoading: vi.fn(),
    setRegStep: vi.fn(),
    setRegData: vi.fn(),
    storeDesktopAuthToken: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('useTenantCreation — two-step signup → trial flow', () => {
  const originalLocation = window.location;
  beforeEach(() => {
    vi.clearAllMocks();
    isDesktopEnvironmentMock.mockReturnValue(false);
    window.location.hash = '';
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
    window.location.hash = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('web: calls checkout BEFORE any subdomain navigation and redirects the same tab', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1', slug: 'acme' } }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://checkout.stripe/x' }));
    vi.stubGlobal('fetch', fetchMock);
    const hrefSpy = vi.fn();
    // Capture the same-tab checkout navigation (and prove no subdomain redirect).
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'app.meetropolis.me',
        protocol: 'https:',
        hash: '',
        set href(v: string) {
          hrefSpy(v);
        },
      },
      writable: true,
      configurable: true,
    });

    const args = makeArgs();
    const { result } = renderHook(() => useTenantCreation(args));
    await result.current(commercialSubmission);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstUrl] = fetchMock.mock.calls[0];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1];
    expect(firstUrl).toBe('http://api.test/public/tenants');
    expect(secondUrl).toBe('http://api.test/billing/checkout-session');
    expect((secondInit as RequestInit).credentials).toBe('include');
    expect((secondInit.headers as Record<string, string>)['X-Tenant']).toBe('acme');
    expect(JSON.parse(secondInit.body as string)).toEqual({ tierKey: 'team' });
    // Web: same-tab navigation to the Stripe checkout; no external/system browser.
    expect(hrefSpy).toHaveBeenCalledWith('https://checkout.stripe/x');
    expect(openExternalMock).not.toHaveBeenCalled();
  });

  it('desktop: opens the checkout URL in the system browser, not the current tab', async () => {
    isDesktopEnvironmentMock.mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1', slug: 'acme' }, token: 'jwt.abc' }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://checkout.stripe/x' }));
    vi.stubGlobal('fetch', fetchMock);
    const hrefSpy = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'app.meetropolis.me',
        protocol: 'https:',
        hash: '',
        set href(v: string) {
          hrefSpy(v);
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useTenantCreation(makeArgs()));
    await result.current(commercialSubmission);

    // Desktop: hand off to the system browser; the current tab is left untouched.
    expect(openExternalMock).toHaveBeenCalledWith('https://checkout.stripe/x');
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it('sends the B2B evidence in the tenant-creation body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1' } }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://checkout/x' }));
    vi.stubGlobal('fetch', fetchMock);
    // Absorb the same-tab checkout navigation (jsdom cannot actually navigate).
    Object.defineProperty(window, 'location', {
      value: { hostname: 'app.meetropolis.me', protocol: 'https:', hash: '', set href(_v: string) {} },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useTenantCreation(makeArgs()));
    await result.current(commercialSubmission);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      slug: 'acme',
      tierKey: 'team',
      companyLegalName: 'Acme GmbH',
      legalForm: 'GmbH',
      billingCountry: 'DE',
      vatId: 'DE123456789',
      b2bDeclaration: true,
      agbVersion: '2026-07-01',
    });
  });

  it('uses the native body token as a bearer for the checkout call', async () => {
    // A body token implies a native/desktop client; the checkout then opens in
    // the system browser rather than navigating the app tab.
    isDesktopEnvironmentMock.mockReturnValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1' }, token: 'jwt.abc' }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://checkout/x' }));
    vi.stubGlobal('fetch', fetchMock);
    const storeDesktopAuthToken = vi.fn(() => Promise.resolve());

    const { result } = renderHook(() => useTenantCreation(makeArgs({ storeDesktopAuthToken })));
    await result.current(commercialSubmission);

    expect(storeDesktopAuthToken).toHaveBeenCalledWith('jwt.abc');
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer jwt.abc');
  });

  it('OSS path (no B2B / no tier): creates the tenant and does NOT call checkout', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1' } }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useTenantCreation(makeArgs()));
    await result.current({ tierKey: null, b2b: null });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://api.test/public/tenants');
    expect(openExternalMock).not.toHaveBeenCalled();
    // localhost default → redirect switches to the in-app hash route.
    expect(window.location.hash).toBe('#/app');
  });

  it('OSS path on a public host enters the app on the current origin (no subdomain redirect)', async () => {
    // Root-domain architecture: even off localhost the workspace lives on the
    // current host, so the flow enters via the in-app hash route and never
    // navigates to a per-team subdomain (the previous behaviour).
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ ok: true, tenant: { id: 't1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const hrefSpy = vi.fn();
    let hash = '';
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'app.meetropolis.me',
        protocol: 'https:',
        get hash() {
          return hash;
        },
        set hash(v: string) {
          hash = v;
        },
        set href(v: string) {
          hrefSpy(v);
        },
      },
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useTenantCreation(makeArgs()));
    await result.current({ tierKey: null, b2b: null });

    expect(window.location.hash).toBe('#/app');
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it('surfaces slug_exists back to step 2', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ error: 'slug_exists' }, false, 400));
    vi.stubGlobal('fetch', fetchMock);
    const setSlugError = vi.fn();
    const setRegStep = vi.fn();

    const { result } = renderHook(() => useTenantCreation(makeArgs({ setSlugError, setRegStep })));
    await result.current(commercialSubmission);

    expect(setSlugError).toHaveBeenCalledWith('auth.slugExists');
    expect(setRegStep).toHaveBeenCalledWith(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
