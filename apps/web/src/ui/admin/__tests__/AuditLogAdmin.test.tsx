import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuditLogAdmin } from '../AuditLogAdmin';

const TENANTS = [
  { id: 't1', slug: 'acme', name: 'Acme' },
];

const SAMPLE_LOGS = {
  total: 1,
  logs: [
    {
      id: 'log1',
      tenantId: 't1',
      eventType: 'subscription_created',
      source: 'stripe',
      createdAt: '2026-01-15T10:00:00.000Z',
      metadata: { plan: 'pro', amount: 9900 },
    },
  ],
};

function makeFetchMock(routes: Array<{ match: string; status?: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      return new Response(JSON.stringify({ error: 'not_mocked' }), { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

describe('AuditLogAdmin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without crashing and shows audit log rows', async () => {
    globalThis.fetch = makeFetchMock([
      { match: '/admin/tenants', body: TENANTS },
      { match: '/admin/billing/audit-log', body: SAMPLE_LOGS },
    ]);
    render(<AuditLogAdmin apiBase="http://test" />);
    await waitFor(() => {
      expect(screen.getByText('subscription_created')).toBeInTheDocument();
    });
    expect(screen.getByText('acme')).toBeInTheDocument();
  });

  it('shows enterprise unavailable hint on 404', async () => {
    globalThis.fetch = makeFetchMock([
      { match: '/admin/tenants', body: TENANTS },
      { match: '/admin/billing/audit-log', status: 404, body: { error: 'not_found' } },
    ]);
    render(<AuditLogAdmin apiBase="http://test" />);
    await waitFor(() => {
      expect(
        screen.getByText(/Enterprise Billing nicht verfügbar/i),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no logs', async () => {
    globalThis.fetch = makeFetchMock([
      { match: '/admin/tenants', body: TENANTS },
      { match: '/admin/billing/audit-log', body: { total: 0, logs: [] } },
    ]);
    render(<AuditLogAdmin apiBase="http://test" />);
    await waitFor(() => {
      expect(screen.getByText('Keine Audit-Log-Einträge gefunden.')).toBeInTheDocument();
    });
  });
});
