import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionManagement } from './SessionManagement';

// SessionManagement pulls in the real i18n bootstrap via apiErrors, so only
// `useTranslation` is stubbed (keys pass through).
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const session = (id: string, isCurrent = false) => ({
  id,
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/120',
  ipAddress: '203.0.113.7',
  lastActiveAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  isCurrent,
});

const SESSIONS = [session('s-current', true), session('s-other')];

function stubApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body =
      method === 'GET' ? { sessions: SESSIONS } : url.endsWith('/auth/sessions') ? { revokedCount: 1 } : { ok: true };
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const deletes = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');

beforeEach(() => {
  // The desktop shell has no usable native dialogs; none may be called.
  vi.stubGlobal('confirm', vi.fn());
  vi.stubGlobal('alert', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SessionManagement confirmations', () => {
  it('revokes one session only after the in-app confirmation', async () => {
    const fetchMock = stubApi();
    render(<SessionManagement onClose={() => {}} />);

    fireEvent.click(await screen.findByText('sessions.revoke'));
    expect(screen.getByText('sessions.confirmRevoke')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByText('confirmDialog.confirm'));

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    expect(String(deletes(fetchMock)[0][0])).toContain('/auth/sessions/s-other');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('sends nothing when the revoke is cancelled', async () => {
    const fetchMock = stubApi();
    render(<SessionManagement onClose={() => {}} />);

    fireEvent.click(await screen.findByText('sessions.revoke'));
    fireEvent.click(screen.getByText('confirmDialog.cancel'));

    await waitFor(() => expect(screen.queryByText('sessions.confirmRevoke')).toBeNull());
    expect(deletes(fetchMock)).toHaveLength(0);
  });

  it('logs out all others after confirmation and reports the result inline instead of alert()', async () => {
    const fetchMock = stubApi();
    render(<SessionManagement onClose={() => {}} />);

    fireEvent.click(await screen.findByText('sessions.logoutAllOther'));
    expect(screen.getByText('sessions.confirmRevokeAll')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(0);
    fireEvent.click(screen.getByText('confirmDialog.confirm'));

    expect(await screen.findByText('sessions.revokedSuccess')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
  });

  it('sends nothing when logging out all others is cancelled', async () => {
    const fetchMock = stubApi();
    render(<SessionManagement onClose={() => {}} />);

    fireEvent.click(await screen.findByText('sessions.logoutAllOther'));
    fireEvent.click(screen.getByText('confirmDialog.cancel'));

    await waitFor(() => expect(screen.queryByText('sessions.confirmRevokeAll')).toBeNull());
    expect(deletes(fetchMock)).toHaveLength(0);
  });
});
