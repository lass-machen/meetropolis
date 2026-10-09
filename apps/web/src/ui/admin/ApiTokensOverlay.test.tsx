import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

type Reply = { ok: boolean; status?: number; body?: unknown };

function toResponse(reply: Reply) {
  return {
    ok: reply.ok,
    status: reply.status ?? (reply.ok ? 200 : 500),
    json: () => Promise.resolve(reply.body ?? {}),
  };
}

function stubFetch(reply: Reply) {
  const fetchMock = vi.fn().mockResolvedValue(toResponse(reply));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Routes by method. `list` is consumed in order (the last reply repeats), so a
 * test can answer the load and the reload that follows a change differently.
 */
function stubApi(routes: { list: Reply[]; post?: Reply; del?: Reply }) {
  let listCalls = 0;
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST') return Promise.resolve(toResponse(routes.post ?? { ok: true, body: {} }));
    if (method === 'DELETE') return Promise.resolve(toResponse(routes.del ?? { ok: true, body: { ok: true } }));
    const reply = routes.list[Math.min(listCalls, routes.list.length - 1)];
    listCalls += 1;
    return Promise.resolve(toResponse(reply));
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

  it('shows an error instead of crashing or claiming there are no tokens when the load is rejected', async () => {
    stubFetch({ ok: false, status: 401, body: { error: 'unauthorized' } });

    render(<Harness />);

    expect(await screen.findByText('admin.api.loadError')).toBeTruthy();
    // An empty list next to the error would claim "no tokens" when we do not know.
    expect(screen.queryByText('admin.api.noneYet')).toBeNull();
  });

  it('treats a 2xx payload that is not a list the same way', async () => {
    stubFetch({ ok: true, body: { error: 'oops' } });

    render(<Harness />);

    await waitFor(() => expect(screen.getByText('admin.api.loadError')).toBeTruthy());
    expect(screen.queryByText('admin.api.noneYet')).toBeNull();
  });
});

describe('ApiTokensOverlay messages', () => {
  it('shows the translated list state while loading and none-yet only after an empty load', async () => {
    stubApi({ list: [{ ok: true, body: [] }] });
    render(<Harness />);

    expect(screen.queryByText('admin.api.noneYet')).toBeNull();
    expect(await screen.findByText('admin.api.noneYet')).toBeTruthy();
  });

  it('shows the translated create error, not an internal message, when creation is rejected', async () => {
    stubApi({ list: [{ ok: true, body: [] }], post: { ok: false, status: 500, body: { error: 'boom' } } });
    render(<Harness />);
    await screen.findByText('admin.api.noneYet');

    fireEvent.click(screen.getByText('admin.api.createToken'));

    expect(await screen.findByText('admin.api.createError')).toBeTruthy();
  });
});

describe('ApiTokensOverlay delete', () => {
  const LIST = { ok: true, body: [TOKEN] };

  async function clickDelete() {
    fireEvent.click(await screen.findByText('admin.api.delete'));
  }

  it('reloads the list after a successful delete without an error', async () => {
    const fetchMock = stubApi({ list: [LIST, { ok: true, body: [] }] });
    render(<Harness />);

    await clickDelete();

    await screen.findByText('admin.api.noneYet');
    expect(screen.queryByText('admin.api.deleteError')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true);
  });

  it('reports a rejected delete instead of leaving the token listed silently', async () => {
    stubApi({ list: [LIST], del: { ok: false, status: 400, body: { error: 'delete failed' } } });
    render(<Harness />);

    await clickDelete();

    expect(await screen.findByText('admin.api.deleteError')).toBeTruthy();
    expect(screen.getByText('ci-token')).toBeTruthy();
  });

  it('treats a 404 as already deleted', async () => {
    stubApi({ list: [LIST, { ok: true, body: [] }], del: { ok: false, status: 404, body: { error: 'not found' } } });
    render(<Harness />);

    await clickDelete();

    await screen.findByText('admin.api.noneYet');
    expect(screen.queryByText('admin.api.deleteError')).toBeNull();
  });
});
