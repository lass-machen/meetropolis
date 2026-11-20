// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InviteAcceptView } from './InviteAcceptView';
import { PENDING_INVITE_KEY } from '../../../lib/pendingInvite';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, vars?: Record<string, string>) => (vars ? `${k} ${Object.values(vars).join(' ')}` : k),
  }),
}));

// Mock the i18next instance behind translateApiError: missing keys echo back,
// so translateApiError falls back to the server message.
vi.mock('../../../app/providers/i18n', () => ({
  default: { t: (key: string) => key },
}));

const storeDesktopAuthTokenMock = vi.fn(() => Promise.resolve());
vi.mock('./hooks/useAuthApi', () => ({
  useAuthApi: () => ({
    post: vi.fn(),
    storeDesktopAuthToken: storeDesktopAuthTokenMock,
  }),
}));

const CODE = 'MEET-AAA-111111';

function pendingPreview() {
  return { tenantName: 'Acme Corp', role: 'member', status: 'pending', emailMasked: 'j***@acme.test' };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

let previewStatus = 200;
let previewBody: unknown = null;
let meStatus = 401;
let acceptStatus = 200;
let acceptBody: unknown = {};
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch() {
  fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.endsWith('/public/invites/preview')) return Promise.resolve(jsonResponse(previewStatus, previewBody));
    if (u.endsWith('/auth/me'))
      return Promise.resolve(jsonResponse(meStatus, meStatus === 200 ? { id: 'u1' } : { error: 'unauthorized' }));
    if (u.endsWith('/invites/accept')) return Promise.resolve(jsonResponse(acceptStatus, acceptBody));
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function acceptCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/invites/accept'));
}

const reloadMock = vi.fn();
const originalLocation = window.location;

function renderView() {
  return render(<InviteAcceptView apiBase="http://api.test" code={CODE} onRegisterWithInvite={() => {}} />);
}

describe('InviteAcceptView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    previewStatus = 200;
    previewBody = null;
    meStatus = 401;
    acceptStatus = 200;
    acceptBody = {};
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { hash: '', reload: reloadMock },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: originalLocation });
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('shows not_found when the preview answers 404', async () => {
    previewStatus = 404;
    previewBody = { error: 'not_found' };
    stubFetch();

    renderView();

    expect(await screen.findByText('auth.inviteAccept.notFound')).toBeTruthy();
    const [[previewUrl, previewInit]] = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/public/invites/preview'),
    );
    expect(String(previewUrl)).toContain('/public/invites/preview');
    expect(previewInit).toMatchObject({ method: 'POST', credentials: 'include' });
  });

  it('shows the expiry text when the invite status is expired', async () => {
    previewBody = { tenantName: 'Acme Corp', role: 'member', status: 'expired', emailMasked: 'j***@acme.test' };
    stubFetch();

    renderView();

    expect(await screen.findByText('invite_expired')).toBeTruthy();
  });

  it('shows tenant and masked address when logged out; sign-in stores the code and goes to #/login', async () => {
    previewBody = pendingPreview();
    stubFetch();

    renderView();

    expect(await screen.findByText(/Acme Corp/)).toBeTruthy();
    expect(screen.getByText(/j\*\*\*@acme\.test/)).toBeTruthy();

    fireEvent.click(screen.getByText('auth.inviteLoginLink'));
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBe(CODE);
    expect(window.location.hash).toBe('#/login');
  });

  it('accepts on click when logged in: posts {code}, then goes to #/app and reloads', async () => {
    previewBody = pendingPreview();
    meStatus = 200;
    acceptBody = { id: 'u1', email: 'j@acme.test', name: 'J', alreadyMember: false };
    stubFetch();

    renderView();

    fireEvent.click(await screen.findByText('auth.inviteAccept.acceptButton'));

    await waitFor(() => expect(acceptCalls()).toHaveLength(1));
    expect(acceptCalls()[0]?.[1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect((acceptCalls()[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ code: CODE }));
    await waitFor(() => expect(window.location.hash).toBe('#/app'));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('auto-accepts exactly once when logged in with the same code stored', async () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, CODE);
    previewBody = pendingPreview();
    meStatus = 200;
    acceptBody = { id: 'u1', email: 'j@acme.test', name: 'J', alreadyMember: false };
    stubFetch();

    renderView();

    await waitFor(() => expect(acceptCalls()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(acceptCalls()).toHaveLength(1);
  });

  it('shows the mismatch text and clears storage when accept answers 403 invite_email_mismatch', async () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, CODE);
    previewBody = pendingPreview();
    meStatus = 200;
    acceptStatus = 403;
    acceptBody = { error: { code: 'invite_email_mismatch', message: 'apiError.invite_email_mismatch' } };
    stubFetch();

    renderView();

    expect(await screen.findByText('apiError.invite_email_mismatch')).toBeTruthy();
    expect(sessionStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });
});
