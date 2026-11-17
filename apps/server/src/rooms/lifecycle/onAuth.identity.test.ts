/**
 * A join without a token is refused regardless of the version setting:
 * the client-supplied identity never reaches the room state, however short.
 * The verified token subject is the only identity a human join can carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));

const validateTenantSessionFreshMock = vi.fn();
const verifyAuthJwtMock = vi.fn();
vi.mock('../../api/utils/authHelpers.js', () => ({
  verifyAuthJwt: (...args: unknown[]) => verifyAuthJwtMock(...args),
}));
vi.mock('../../api/utils/sessionAuth.js', () => ({
  validateTenantSessionFresh: (...args: unknown[]) => validateTenantSessionFreshMock(...args),
}));

import { authenticateWorldJoin, AUTH_REJECTED_CODE } from './onAuth.js';
import { MAX_JOIN_IDENTITY_LENGTH } from './joinFields.js';
import type { RoomOptions } from '../WorldRoom.js';

type WorldJoinPrisma = Parameters<typeof authenticateWorldJoin>[2];
type AuthContext = Parameters<typeof authenticateWorldJoin>[1];

const ORIGINAL_ENV = { ...process.env };

const tenantFindUnique = vi.fn(() => Promise.resolve({ id: 'tenant-1', slug: 'tenant-1' }));
const prisma = {
  tenant: { findUnique: tenantFindUnique },
  session: { findUnique: vi.fn(), update: vi.fn() },
  // Joins in these tests come from members; the membership gate has its own tests.
  membership: { findUnique: vi.fn(() => Promise.resolve({ expiresAt: null })) },
  npc: { findUnique: vi.fn(() => Promise.resolve({ id: 'npc-id', identity: 'bob' })) },
} as unknown as WorldJoinPrisma;

const tokenless: AuthContext = { headers: new Headers(), ip: '127.0.0.1' };

beforeEach(() => {
  vi.clearAllMocks();
  verifyAuthJwtMock.mockReset();
  verifyAuthJwtMock.mockReturnValue({ userId: 'user-real', tenantId: 'tenant-1' });
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
  delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('identity of a token-less join without version enforcement', () => {
  it.each(['legacy-user', 'clx0a1b2c3d4e5f6g7h8i9j0k', 'loadtest-bot-0042', 'J\u00f6rg'])(
    'rejects %s without a valid session',
    async (identity) => {
      const options: RoomOptions = { identity, zonePrivacyVersion: 0 };

      await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
        code: AUTH_REJECTED_CODE,
        message: 'unauthorized',
      });
    },
  );

  it('rejects an identity of exactly the limit without a valid session', async () => {
    const options: RoomOptions = { identity: 'u'.repeat(MAX_JOIN_IDENTITY_LENGTH), zonePrivacyVersion: 0 };

    await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });
  });

  it('rejects an identity one above the limit without a valid session', async () => {
    const options: RoomOptions = { identity: 'u'.repeat(MAX_JOIN_IDENTITY_LENGTH + 1), zonePrivacyVersion: 0 };

    await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });
  });

  it('refuses a 900,000 character identity and logs only a bounded line', async () => {
    const options: RoomOptions = { identity: 'x'.repeat(900_000), zonePrivacyVersion: 1 };

    await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'unauthorized',
    });

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls).length).toBeLessThan(1_000);
  });

  it('does not touch a verified join, whose identity is the token subject', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-real',
      tenantId: 'tenant-1',
    });
    tenantFindUnique.mockResolvedValueOnce({ id: 'tenant-1', slug: 'tenant-1' });
    const options: RoomOptions = { identity: 'x'.repeat(900_000), zonePrivacyVersion: 1 };
    const context: AuthContext = { headers: new Headers({ cookie: 'auth_token=jwt' }), ip: '127.0.0.1' };

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth.identity).toBe('user-real');
  });
});
