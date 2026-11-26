import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AvatarSettings } from './AvatarSettings';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (k: string) => k }),
}));

const PROPS = { currentAvatarId: '', onAvatarChange: () => {} };

function packResponse() {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve([
        {
          uuid: 'pack-one',
          avatars: [{ key: 'scout', displayName: 'Scout' }],
        },
      ]),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AvatarSettings load failure', () => {
  it('shows the error message and keeps the fallback avatar on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 500 })),
    );
    render(<AvatarSettings {...PROPS} />);

    expect(await screen.findByText('avatarSettings.loadFailed')).toBeTruthy();
    expect(await screen.findByText('Business Man')).toBeTruthy();
  });

  it('shows the error message on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    render(<AvatarSettings {...PROPS} />);

    expect(await screen.findByText('avatarSettings.loadFailed')).toBeTruthy();
  });

  it('retries the request and hides the error on success', async () => {
    let failFirst = true;
    const fetchMock = vi.fn(() => {
      if (failFirst) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve(packResponse());
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<AvatarSettings {...PROPS} />);

    expect(await screen.findByText('avatarSettings.loadFailed')).toBeTruthy();

    failFirst = false;
    fireEvent.click(screen.getByText('avatarSettings.retry'));

    expect(await screen.findByText('Scout')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('avatarSettings.loadFailed')).toBeNull());
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('renders the loading text from translations', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    render(<AvatarSettings {...PROPS} />);

    expect(screen.getByText('avatarSettings.loading')).toBeTruthy();
    expect(screen.queryByText('Loading avatars...')).toBeNull();
  });
});
