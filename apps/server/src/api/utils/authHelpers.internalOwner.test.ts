import { describe, it, expect, vi } from 'vitest';

// Mocks must be defined before the module import.
vi.mock('../../logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Import after the mocks are set up.
import { requireInternalOwner } from './authHelpers.js';

function prismaStub(tenantResult: unknown, membershipResult: unknown) {
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue(tenantResult) },
    membership: { findUnique: vi.fn().mockResolvedValue(membershipResult) },
  } as any;
}

describe('requireInternalOwner', () => {
  const req = {} as any;

  it('rejects when the membership lookup fails instead of reporting no access', async () => {
    const prisma = prismaStub({ id: 'internal-tenant' }, null);
    prisma.membership.findUnique.mockRejectedValue(new Error('database unavailable'));

    await expect(requireInternalOwner(req, 'user-1', prisma)).rejects.toThrow('database unavailable');
  });

  it('rejects when the internal tenant lookup fails', async () => {
    const prisma = prismaStub(null, null);
    prisma.tenant.findUnique.mockRejectedValue(new Error('connection refused'));

    await expect(requireInternalOwner(req, 'user-1', prisma)).rejects.toThrow('connection refused');
  });

  it('returns true for an active owner of the internal tenant', async () => {
    const prisma = prismaStub(
      { id: 'internal-tenant' },
      { role: 'owner', expiresAt: null, inviteVerificationRequired: false },
    );

    await expect(requireInternalOwner(req, 'user-1', prisma)).resolves.toBe(true);
  });

  it('returns false for a non-owner member of the internal tenant', async () => {
    const prisma = prismaStub(
      { id: 'internal-tenant' },
      { role: 'admin', expiresAt: null, inviteVerificationRequired: false },
    );

    await expect(requireInternalOwner(req, 'user-1', prisma)).resolves.toBe(false);
  });

  it('returns false when there is no internal tenant', async () => {
    const prisma = prismaStub(null, null);

    await expect(requireInternalOwner(req, 'user-1', prisma)).resolves.toBe(false);
  });
});
