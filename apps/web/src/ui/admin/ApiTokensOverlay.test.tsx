import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ApiTokensOverlay } from './ApiTokensOverlay';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

type Token = { id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null };

const TOKEN: Token = { id: 't1', name: 'ci-token', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null };

/** Holds the list/fresh-token state the way WorldApp does. */
function Harness() {
  const [apiTokens, setApiTokens] = React.useState<Token[]>([]);
  const [newTokenName, setNewTokenName] = React.useState('');
  const [freshToken, setFreshToken] = React.useState<string | null>(null);
  return (
    <ApiTokensOverlay
      open
      onClose={() => {}}
      apiBase="/api"
      apiTokens={apiTokens}
      setApiTokens={setApiTokens}
      newTokenName={newTokenName}
      setNewTokenName={setNewTokenName}
      freshToken={freshToken}
      setFreshToken={setFreshToken}
    />
  );
}

function stubFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => Promise.resolve(response.body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiTokensOverlay token list', () => {
  it('loads the list exactly once when opened', async () => {
    const fetchMock = stubFetch({ ok: true, body: [TOKEN] });

    render(<Harness />);

    await screen.findByText('ci-token');
    const listCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/api-tokens');
    expect(listCalls).toHaveLength(1);
  });

  it('shows an error and an empty list instead of crashing when the load is rejected', async () => {
    stubFetch({ ok: false, status: 401, body: { error: 'unauthorized' } });

    render(<Harness />);

    expect(await screen.findByText('admin.api.loadError')).toBeTruthy();
    expect(screen.getByText('admin.api.noneYet')).toBeTruthy();
  });

  it('treats a 2xx payload that is not a list the same way', async () => {
    stubFetch({ ok: true, body: { error: 'oops' } });

    render(<Harness />);

    await waitFor(() => expect(screen.getByText('admin.api.loadError')).toBeTruthy());
    expect(screen.getByText('admin.api.noneYet')).toBeTruthy();
  });
});
