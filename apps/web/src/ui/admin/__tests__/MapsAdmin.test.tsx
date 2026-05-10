import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MapsAdmin } from '../MapsAdmin';

const TENANTS = [
  { id: 't1', slug: 'acme', name: 'Acme' },
  { id: 't2', slug: 'beta', name: 'Beta' },
];

const MAPS = [
  {
    id: 'm1',
    name: 'lobby-map',
    tenantId: 't1',
    tenantSlug: 'acme',
    tenantName: 'Acme',
    width: 64,
    height: 32,
    tileWidth: 16,
    tileHeight: 16,
    counts: { rooms: 2, tilesets: 3, layers: 4, objects: 5 },
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

function makeFetchMock(routes: Record<string, unknown>) {
  return vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const match = Object.keys(routes).find((key) => url.includes(key));
    if (!match) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'not_mocked' }), { status: 404 }));
    }
    return Promise.resolve(
      new Response(JSON.stringify(routes[match]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
}

describe('MapsAdmin', () => {
  beforeEach(() => {
    globalThis.fetch = makeFetchMock({
      '/admin/tenants': TENANTS,
      '/admin/maps': MAPS,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing and shows map rows', async () => {
    render(<MapsAdmin apiBase="http://test" />);
    await waitFor(() => {
      expect(screen.getByText('lobby-map')).toBeInTheDocument();
    });
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  it('shows the toolbar buttons', async () => {
    render(<MapsAdmin apiBase="http://test" />);
    expect(await screen.findByText('+ Neue Map')).toBeInTheDocument();
    expect(screen.getByText('Map importieren')).toBeInTheDocument();
  });

  it('renders empty state when no maps', async () => {
    globalThis.fetch = makeFetchMock({
      '/admin/tenants': TENANTS,
      '/admin/maps': [],
    });
    render(<MapsAdmin apiBase="http://test" />);
    await waitFor(() => {
      expect(screen.getByText('Keine Maps gefunden.')).toBeInTheDocument();
    });
  });
});
