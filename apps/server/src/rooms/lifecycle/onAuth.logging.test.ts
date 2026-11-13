/**
 * The auth hook runs before any authentication, so every client-supplied join
 * value it logs must stay bounded however long the client makes it. Each case
 * sends 900,000 characters through one logging path and asserts that nothing
 * the logger received grows with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_ZONE_PRIVACY_CLIENT_VERSION } from '@meetropolis/shared';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));

const validateTenantSessionFreshMock = vi.fn();
vi.mock('../../api/utils/sessionAuth.js', () => ({
  validateTenantSessionFresh: (...args: unknown[]) => validateTenantSessionFreshMock(...args),
}));

import { authenticateWorldJoin } from './onAuth.js';
import { MAX_JOIN_IDENTITY_LENGTH } from './joinFields.js';
import type { RoomOptions } from '../WorldRoom.js';

type WorldJoinPrisma = Parameters<typeof authenticateWorldJoin>[2];
type AuthContext = Parameters<typeof authenticateWorldJoin>[1];

const HUGE = 'x'.repeat(900_000);
const LOG_BUDGET_CHARS = 1_000;
const ORIGINAL_ENV = { ...process.env };

const prisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve({ id: 'tenant-a-id', slug: 'auth-a' })) },
  session: { findUnique: vi.fn(), update: vi.fn() },
  // Joins in these tests come from members; the membership gate has its own tests.
  membership: { findUnique: vi.fn(() => Promise.resolve({ expiresAt: null })) },
  npc: { findUnique: vi.fn(() => Promise.resolve({ id: 'npc-id', identity: 'bob' })) },
} as unknown as WorldJoinPrisma;

function context(): AuthContext {
  return { headers: new Headers({ cookie: 'auth_token=jwt' }), ip: '127.0.0.1' };
}

function tokenless(): AuthContext {
  return { headers: new Headers(), ip: '127.0.0.1' };
}

/** Everything the logger received, as one string. */
function logged(): string {
  const calls = [log.debug, log.info, log.warn, log.error].flatMap((fn) => fn.mock.calls);
  return JSON.stringify(calls);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = 'test';
  process.env.NPC_SERVICE_SECRET = 'n'.repeat(40);
  delete process.env.ZONE_PRIVACY_AUTH_ENFORCE;
  delete process.env.ZONE_PRIVACY_TENANT_ENFORCE;
  validateTenantSessionFreshMock.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('onAuth logs stay bounded', () => {
  it('for the identity of an NPC join with a wrong service token', async () => {
    const options: RoomOptions = { identity: `npc-${HUGE}`, serviceToken: 'wrong' };

    await expect(authenticateWorldJoin(options, tokenless(), prisma)).rejects.toThrow();

    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
    expect(logged()).toContain('(900004 chars)');
  });

  it('for a token-less join refused without a valid session', async () => {
    // The refusal logs no client-supplied value at all (see onAuth.ts), so
    // even a huge client-supplied identity stays far below the budget.
    const options: RoomOptions = { identity: 'x'.repeat(MAX_JOIN_IDENTITY_LENGTH), zonePrivacyVersion: 0 };

    await expect(authenticateWorldJoin(options, tokenless(), prisma)).rejects.toThrow();

    expect(log.warn).toHaveBeenCalled();
    expect(logged()).not.toContain('x'.repeat(100));
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it.each([
    ['rejects', 'true'],
    ['admits', undefined],
  ])('for a mismatching options.tenant when the room match %s', async (_label, enforce) => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-1',
      tenantId: 'tenant-a-id',
    });
    if (enforce) process.env.ZONE_PRIVACY_TENANT_ENFORCE = enforce;
    const options: RoomOptions = { tenant: HUGE, zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };

    await authenticateWorldJoin(options, context(), prisma).catch(() => undefined);

    expect(log.warn).toHaveBeenCalled();
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it.each([
    ['enforcement on', 'true'],
    ['enforcement off', undefined],
  ])('for a zone-privacy version that is a long string, %s', async (_label, enforce) => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-1',
      tenantId: 'tenant-a-id',
    });
    if (enforce) process.env.ZONE_PRIVACY_AUTH_ENFORCE = enforce;
    // A client can send any JSON value; the wire type says number only in theory.
    const options = { zonePrivacyVersion: HUGE } as unknown as RoomOptions;

    await authenticateWorldJoin(options, context(), prisma).catch(() => undefined);

    expect(log.warn).toHaveBeenCalled();
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
    expect(logged()).toContain('<string>');
  });

  it('leaves short, ordinary values readable', async () => {
    validateTenantSessionFreshMock.mockResolvedValue({
      status: 'allowed',
      sessionId: 'db-session-1',
      access: 'member',
      userId: 'user-1',
      tenantId: 'tenant-a-id',
    });
    const options: RoomOptions = { tenant: 'spoof-b', zonePrivacyVersion: MIN_ZONE_PRIVACY_CLIENT_VERSION };

    await authenticateWorldJoin(options, context(), prisma);

    expect(logged()).toContain('spoof-b');
    expect(logged()).toContain('"zonePrivacyVersion":0');
  });
});
