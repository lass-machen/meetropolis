/**
 * With ZONE_PRIVACY_AUTH_ENFORCE off, a join without a token is admitted under
 * the identity the client names, and that identity goes into the room state.
 * It must not be allowed to be as long as the client likes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));

const validateSessionTokenMock = vi.fn();
vi.mock('../../api/utils/sessionAuth.js', () => ({
  validateSessionToken: (...args: unknown[]) => validateSessionTokenMock(...args),
}));

import { WORLD_WIRE_PROTOCOL_VERSION } from '@meetropolis/shared';
import { authenticateWorldJoin, AUTH_REJECTED_CODE } from './onAuth.js';
import { MAX_JOIN_IDENTITY_LENGTH } from './joinFields.js';
import type { RoomOptions } from '../WorldRoom.js';

type WorldJoinPrisma = Parameters<typeof authenticateWorldJoin>[2];
type AuthContext = Parameters<typeof authenticateWorldJoin>[1];

const ORIGINAL_ENV = { ...process.env };

const prisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve(null)) },
  session: { findUnique: vi.fn(), update: vi.fn() },
} as unknown as WorldJoinPrisma;

const tokenless: AuthContext = { headers: new Headers(), ip: '127.0.0.1' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
  delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('identity of a token-less join in staged mode', () => {
  it.each(['legacy-user', 'clx0a1b2c3d4e5f6g7h8i9j0k', 'loadtest-bot-0042', 'Jörg'])(
    'admits %s unchanged',
    async (identity) => {
      const options: RoomOptions = {
        identity,
        zonePrivacyVersion: 0,
        wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION,
      };

      const auth = await authenticateWorldJoin(options, tokenless, prisma);

      expect(auth).toEqual({ identity, isNpc: false, zonePrivacyVersion: 0 });
    },
  );

  it('admits an identity of exactly the limit', async () => {
    const identity = 'u'.repeat(MAX_JOIN_IDENTITY_LENGTH);

    const auth = await authenticateWorldJoin(
      { identity, zonePrivacyVersion: 0, wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION },
      tokenless,
      prisma,
    );

    expect(auth.identity).toBe(identity);
  });

  it('refuses an identity one above the limit', async () => {
    const options: RoomOptions = {
      identity: 'u'.repeat(MAX_JOIN_IDENTITY_LENGTH + 1),
      zonePrivacyVersion: 0,
      wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION,
    };

    await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'identity_invalid',
    });
  });

  it('refuses a 900,000 character identity and logs only a bounded line', async () => {
    const options: RoomOptions = {
      identity: 'x'.repeat(900_000),
      zonePrivacyVersion: 0,
      wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION,
    };

    await expect(authenticateWorldJoin(options, tokenless, prisma)).rejects.toMatchObject({
      code: AUTH_REJECTED_CODE,
      message: 'identity_invalid',
    });

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warn.mock.calls).length).toBeLessThan(1_000);
  });

  it('does not touch a verified join, whose identity is the token subject', async () => {
    validateSessionTokenMock.mockResolvedValue({ userId: 'user-real', tenantId: 'tenant-1' });
    const options: RoomOptions = {
      identity: 'x'.repeat(900_000),
      zonePrivacyVersion: 0,
      wireProtocolVersion: WORLD_WIRE_PROTOCOL_VERSION,
    };
    const context: AuthContext = { headers: new Headers({ cookie: 'auth_token=jwt' }), ip: '127.0.0.1' };

    const auth = await authenticateWorldJoin(options, context, prisma);

    expect(auth.identity).toBe('user-real');
  });
});
