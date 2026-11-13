import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { InvitesTab } from './InvitesTab';
import { translateApiError } from '../../../lib/apiErrors';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

type Invite = {
  id: string;
  email: string | null;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: string | null;
  lastSentAt: string | null;
  lastSendError: string | null;
  createdAt: string;
  usedAt: string | null;
  url: string | null;
};

const BASE_INVITE: Invite = {
  id: 'id-base',
  email: 'base@example.test',
  role: 'member',
  status: 'pending',
  expiresAt: '2026-02-01T00:00:00.000Z',
  lastSentAt: '2026-01-01T10:00:00.000Z',
  lastSendError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  usedAt: null,
  url: 'https://public.example/#/?invite=XYZ',
};

const PENDING: Invite = { ...BASE_INVITE, id: 'id-pending', email: 'pending@example.test' };
const ACCEPTED: Invite = {
  ...BASE_INVITE,
  id: 'id-accepted',
  email: 'accepted@example.test',
  status: 'accepted',
  usedAt: '2026-01-02T00:00:00.000Z',
};
const EXPIRED: Invite = { ...BASE_INVITE, id: 'id-expired', email: 'expired@example.test', status: 'expired' };
const NOT_DELIVERED: Invite = {
  ...BASE_INVITE,
  id: 'id-notdelivered',
  email: 'notdelivered@example.test',
  lastSentAt: null,
  lastSendError: 'not_delivered',
};
const NEVER_SENT: Invite = {
  ...BASE_INVITE,
  id: 'id-never',
  email: 'never@example.test',
  expiresAt: null,
  lastSentAt: null,
  lastSendError: null,
};

let serverInvites: Invite[];
let getStatus: number;
let getReject: boolean;
let resendEmailSent: boolean;

function stubApi(del: { ok: boolean; status: number } | 'network-error' = { ok: true, status: 200 }) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      if (del === 'network-error') return Promise.reject(new TypeError('offline'));
      if (del.ok || del.status === 404) {
        const id = String(url).split('/').pop() ?? '';
        serverInvites = serverInvites.filter((i) => i.id !== decodeURIComponent(id));
      }
      return Promise.resolve({ ...del, json: () => Promise.resolve({}) });
    }
    if (init?.method === 'POST' && String(url).includes('/resend')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ emailSent: resendEmailSent }),
      });
    }
    if (getReject) return Promise.reject(new TypeError('offline'));
    return Promise.resolve({
      ok: getStatus >= 200 && getStatus < 300,
      status: getStatus,
      json: () => Promise.resolve(serverInvites),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const getCalls = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/invites') && !init?.method);

const deletes = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');

const resends = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

let originalLocation: Location;
let originalClipboard: PropertyDescriptor | undefined;
const writeText = vi.fn<() => Promise<void>>();

beforeEach(() => {
  serverInvites = [PENDING, ACCEPTED, EXPIRED, NOT_DELIVERED, NEVER_SENT];
  getStatus = 200;
  getReject = false;
  resendEmailSent = true;
  // The desktop shell has no usable window.confirm; the tab must not call it.
  vi.stubGlobal('confirm', vi.fn());
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, origin: 'tauri://localhost' },
  });
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  writeText.mockReset().mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  vi.unstubAllGlobals();
});

describe('InvitesTab invite links', () => {
  it('copies the URL supplied by the server', async () => {
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    const row = (await screen.findByText('pending@example.test')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('tenant.inviteCopy'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://public.example/#/?invite=XYZ'));
  });

  it('shows a translated error and does not copy when the server has no URL', async () => {
    serverInvites = [{ ...PENDING, url: null }];
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    fireEvent.click(await screen.findByText('tenant.inviteCopy'));

    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText(translateApiError('public_base_url_missing'))).toBeTruthy();
  });
});

describe('InvitesTab status badges', () => {
  it('shows pending, accepted and expired badges', async () => {
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    expect(await screen.findByText('pending@example.test')).toBeTruthy();
    expect(screen.getAllByText('tenant.invitePending')).toHaveLength(3);
    expect(screen.getByText('tenant.inviteAccepted')).toBeTruthy();
    expect(screen.getByText('tenant.inviteExpired')).toBeTruthy();
  });
});

describe('InvitesTab validity and delivery', () => {
  it('shows the valid-until column and delivery states', async () => {
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    expect(await screen.findByText('tenant.inviteValidUntil')).toBeTruthy();
    expect(screen.getByText('tenant.inviteNotDelivered')).toBeTruthy();
    expect(screen.getAllByText('tenant.inviteSentOn')).toHaveLength(3);
    const neverRow = (await screen.findByText('never@example.test')).closest('tr') as HTMLElement;
    expect(within(neverRow).getAllByText('\u2014')).toHaveLength(2);
  });
});

describe('InvitesTab resend', () => {
  async function clickResend(email: string) {
    const row = (await screen.findByText(email)).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('tenant.inviteResend'));
  }

  it('posts to the resend endpoint and reloads the list', async () => {
    const fetchMock = stubApi();
    render(<InvitesTab apiBase="/api" />);
    await screen.findByText('pending@example.test');
    expect(getCalls(fetchMock)).toHaveLength(1);

    await clickResend('pending@example.test');

    await waitFor(() => expect(resends(fetchMock)).toHaveLength(1));
    expect(String(resends(fetchMock)[0][0])).toBe('/api/invites/id-pending/resend');
    expect(await screen.findByText('tenant.inviteResent')).toBeTruthy();
    await waitFor(() => expect(getCalls(fetchMock).length).toBeGreaterThan(1));
  });

  it('shows the not-delivered hint when the email was not sent', async () => {
    resendEmailSent = false;
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    await clickResend('pending@example.test');

    expect(await screen.findByText('tenant.inviteResendNotDelivered')).toBeTruthy();
  });
});

describe('InvitesTab revoke confirmation', () => {
  it('revokes an invite by id only after the in-app confirmation', async () => {
    const fetchMock = stubApi();
    render(<InvitesTab apiBase="/api" />);

    const row = (await screen.findByText('pending@example.test')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('tenant.inviteRevoke'));
    expect(screen.getByText('tenant.inviteDeleteConfirm')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByText('confirmDialog.confirm'));

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    expect(String(deletes(fetchMock)[0][0])).toBe('/api/invites/id-pending');
    await waitFor(() => expect(screen.queryByText('pending@example.test')).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the invite when the confirmation is cancelled', async () => {
    const fetchMock = stubApi();
    render(<InvitesTab apiBase="/api" />);

    const row = (await screen.findByText('pending@example.test')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('tenant.inviteRevoke'));
    fireEvent.click(screen.getByText('confirmDialog.cancel'));

    await waitFor(() => expect(screen.queryByText('tenant.inviteDeleteConfirm')).toBeNull());
    expect(deletes(fetchMock)).toHaveLength(0);
    expect(screen.getByText('pending@example.test')).toBeTruthy();
  });
});

describe('InvitesTab revoke response', () => {
  async function confirmRevoke() {
    const row = (await screen.findByText('pending@example.test')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('tenant.inviteRevoke'));
    fireEvent.click(screen.getByText('confirmDialog.confirm'));
  }

  it('shows an error and keeps the invite when the server rejects the revoke', async () => {
    stubApi({ ok: false, status: 500 });
    render(<InvitesTab apiBase="/api" />);

    await confirmRevoke();

    expect(await screen.findByText('tenant.inviteRevokeFailed')).toBeTruthy();
    expect(screen.getByText('pending@example.test')).toBeTruthy();
  });

  it('shows an error and keeps the invite on a network error', async () => {
    stubApi('network-error');
    render(<InvitesTab apiBase="/api" />);

    await confirmRevoke();

    expect(await screen.findByText('tenant.inviteRevokeFailed')).toBeTruthy();
    expect(screen.getByText('pending@example.test')).toBeTruthy();
  });

  it('treats a 404 as already revoked', async () => {
    stubApi({ ok: false, status: 404 });
    render(<InvitesTab apiBase="/api" />);

    await confirmRevoke();

    await waitFor(() => expect(screen.queryByText('pending@example.test')).toBeNull());
    expect(screen.queryByText('tenant.inviteRevokeFailed')).toBeNull();
  });
});

describe('InvitesTab accepted invites', () => {
  it('offers neither resend nor revoke for accepted invites', async () => {
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    const row = (await screen.findByText('accepted@example.test')).closest('tr') as HTMLElement;
    expect(within(row).queryByText('tenant.inviteResend')).toBeNull();
    expect(within(row).queryByText('tenant.inviteRevoke')).toBeNull();
  });

  it('offers no link copy for accepted and expired invites', async () => {
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    const acceptedRow = (await screen.findByText('accepted@example.test')).closest('tr') as HTMLElement;
    const expiredRow = (await screen.findByText('expired@example.test')).closest('tr') as HTMLElement;
    expect(within(acceptedRow).queryByText('tenant.inviteCopy')).toBeNull();
    expect(within(expiredRow).queryByText('tenant.inviteCopy')).toBeNull();
  });
});

describe('InvitesTab load errors', () => {
  it('shows the load error with retry instead of the empty state on HTTP 500', async () => {
    let failGet = true;
    const fetchMock = vi.fn(() => {
      if (failGet) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve([]) });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(serverInvites) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<InvitesTab apiBase="/api" />);

    expect(await screen.findByText('tenant.invitesLoadFailed')).toBeTruthy();
    expect(screen.getByText('tenant.retry')).toBeTruthy();
    expect(screen.queryByText('tenant.noInvites')).toBeNull();

    failGet = false;
    fireEvent.click(screen.getByText('tenant.retry'));

    expect(await screen.findByText('pending@example.test')).toBeTruthy();
    expect(screen.queryByText('tenant.invitesLoadFailed')).toBeNull();
  });

  it('shows the load error with retry on a network error and reloads on retry', async () => {
    let failGet = true;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      if (failGet) return Promise.reject(new TypeError('offline'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(serverInvites) });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<InvitesTab apiBase="/api" />);

    expect(await screen.findByText('tenant.invitesLoadFailed')).toBeTruthy();
    expect(screen.queryByText('tenant.noInvites')).toBeNull();

    failGet = false;
    fireEvent.click(screen.getByText('tenant.retry'));

    expect(await screen.findByText('pending@example.test')).toBeTruthy();
    expect(screen.queryByText('tenant.invitesLoadFailed')).toBeNull();
  });
});

describe('InvitesTab empty list', () => {
  it('shows the empty state only for a successfully loaded empty list', async () => {
    serverInvites = [];
    stubApi();
    render(<InvitesTab apiBase="/api" />);

    expect(await screen.findByText('tenant.noInvites')).toBeTruthy();
    expect(screen.queryByText('tenant.invitesLoadFailed')).toBeNull();
  });
});
