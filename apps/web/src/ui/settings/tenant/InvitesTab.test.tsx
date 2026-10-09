import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvitesTab } from './InvitesTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const INVITES = [{ code: 'abc123', email: 'new@example.test', usedAt: null, createdAt: '2026-01-01T00:00:00.000Z' }];

function stubApi() {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve((init?.method ?? 'GET') === 'GET' ? INVITES : { ok: true }),
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const deletes = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');

beforeEach(() => {
  // The desktop shell has no usable window.confirm; the tab must not call it.
  vi.stubGlobal('confirm', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InvitesTab delete confirmation', () => {
  it('deletes an invite only after the in-app confirmation', async () => {
    const fetchMock = stubApi();
    render(<InvitesTab apiBase="/api" />);

    fireEvent.click(await screen.findByText('tenant.inviteDelete'));
    expect(screen.getByText('tenant.inviteDeleteConfirm')).toBeTruthy();
    expect(deletes(fetchMock)).toHaveLength(0);

    fireEvent.click(screen.getByText('confirmDialog.confirm'));

    await waitFor(() => expect(deletes(fetchMock)).toHaveLength(1));
    expect(String(deletes(fetchMock)[0][0])).toBe('/api/invites/abc123');
    await waitFor(() => expect(screen.queryByText('abc123')).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps the invite when the confirmation is cancelled', async () => {
    const fetchMock = stubApi();
    render(<InvitesTab apiBase="/api" />);

    fireEvent.click(await screen.findByText('tenant.inviteDelete'));
    fireEvent.click(screen.getByText('confirmDialog.cancel'));

    await waitFor(() => expect(screen.queryByText('tenant.inviteDeleteConfirm')).toBeNull());
    expect(deletes(fetchMock)).toHaveLength(0);
    expect(screen.getByText('abc123')).toBeTruthy();
  });
});
