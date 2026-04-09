import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TenantUsersPanel } from '../TenantUsersPanel';

describe('TenantUsersPanel', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            userId: 'u1',
            email: 'alice@example.com',
            name: 'Alice',
            imageUrl: null,
            role: 'owner',
            createdAt: '2024-01-01T00:00:00.000Z',
            emailVerifiedAt: null,
            memberSince: '2024-01-01T00:00:00.000Z',
          },
          {
            userId: 'u2',
            email: 'bob@example.com',
            name: null,
            imageUrl: null,
            role: 'member',
            createdAt: '2024-02-01T00:00:00.000Z',
            emailVerifiedAt: null,
            memberSince: '2024-02-01T00:00:00.000Z',
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders without crashing and shows the section title', async () => {
    render(<TenantUsersPanel apiBase="https://api.example.com" tenantId="tenant-1" />);
    expect(screen.getByRole('heading', { name: 'Benutzer' })).toBeInTheDocument();
  });

  it('loads and displays users from the API', async () => {
    render(<TenantUsersPanel apiBase="https://api.example.com" tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.example.com/admin/tenants/tenant-1/users',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('shows an error alert when the API request fails', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;

    render(<TenantUsersPanel apiBase="https://api.example.com" tenantId="tenant-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Fehler beim Laden/i)).toBeInTheDocument();
    });
  });
});
