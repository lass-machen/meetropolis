/**
 * Unit tests for onJoin.limiter.ts helpers.
 *
 * All external dependencies (tenancyLoader, billingLoader, db, logger) are
 * mocked so no real database or enterprise module is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// vi.mock factories are hoisted to top of file by Vitest. Variables referenced
// inside them must be defined inside the factory (no outer-variable captures).
// Async factory functions without 'await' trigger @typescript-eslint/require-await,
// so factories that only return values use plain (non-async) functions.
// ---------------------------------------------------------------------------

vi.mock('../../tenancyLoader.js', () => ({
  OSS_USER_LIMIT: 25,
  getTenancyModule: vi.fn(() =>
    Promise.resolve({
      version: 1,
      isMultiTenantEnabled: () => false,
      bypassOssLimit: () => false,
    }),
  ),
}));

vi.mock('../../billingLoader.js', () => ({
  getBillingModuleSync: vi.fn(() => null),
}));

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../db.js', () => ({
  createPrismaClient: vi.fn(() => ({
    tenant: { findUnique: vi.fn(() => Promise.resolve(null)) },
    $disconnect: vi.fn(() => Promise.resolve()),
  })),
}));

// ---------------------------------------------------------------------------
// Imports - must come after vi.mock() calls.
// ---------------------------------------------------------------------------

import {
  countTotalActivePlayers,
  countActiveForTenant,
  enforceOssLimit,
  enforceTenantSeatLimit,
  enforceTenantLimits,
  checkBillingStatus,
} from './onJoin.limiter.js';
import type { WorldRoom, RoomOptions } from '../WorldRoom.js';
import type { Client } from 'colyseus';

// Import the mocked modules so we can control return values per test.
import { getTenancyModule } from '../../tenancyLoader.js';
import { getBillingModuleSync } from '../../billingLoader.js';
import { createPrismaClient } from '../../db.js';
import type { PrismaClient } from '../../generated/prisma/index.js';

const mockGetTenancyModule = vi.mocked(getTenancyModule);
const mockGetBillingModuleSync = vi.mocked(getBillingModuleSync);
const mockCreatePrismaClient = vi.mocked(createPrismaClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal WorldRoom-shaped object for testing. The limiter only reads
 * `state.players.size` and `metadata.tenant`.
 */
function makeRoom(playerCount: number, tenant?: string): WorldRoom {
  return {
    state: {
      players: { size: playerCount },
    },
    metadata: tenant ? { tenant } : {},
  } as unknown as WorldRoom;
}

/** Build a minimal Client stub that satisfies the parts used by the limiter. */
function makeClient(): Pick<Client, 'error' | 'leave'> {
  return {
    error: vi.fn(),
    leave: vi.fn(),
  };
}

/** Build a minimal Prisma stub with a configurable tenant findUnique result. */
function makePrisma(tenantRow: unknown = null): Pick<PrismaClient, 'tenant' | '$disconnect'> {
  return {
    tenant: { findUnique: vi.fn(() => Promise.resolve(tenantRow)) } as any,
    $disconnect: vi.fn(() => Promise.resolve()),
  };
}

/** Configure the tenancy module mock to behave as OSS (no enterprise bypass). */
function setTenancyOss(): void {
  mockGetTenancyModule.mockReturnValue(
    Promise.resolve({
      version: 1 as const,
      isMultiTenantEnabled: () => false,
      bypassOssLimit: () => false,
    }),
  );
}

/** Configure the tenancy module mock to behave as enterprise (OSS limit bypassed). */
function setTenancyEnterprise(): void {
  mockGetTenancyModule.mockReturnValue(
    Promise.resolve({
      version: 1 as const,
      isMultiTenantEnabled: () => true,
      bypassOssLimit: () => true,
    }),
  );
}

// ---------------------------------------------------------------------------
// countTotalActivePlayers
// ---------------------------------------------------------------------------

describe('countTotalActivePlayers', () => {
  it('returns 0 for an empty room set', () => {
    expect(countTotalActivePlayers(new Set())).toBe(0);
  });

  it('counts players from a single room', () => {
    const rooms = new Set([makeRoom(3)]);
    expect(countTotalActivePlayers(rooms)).toBe(3);
  });

  it('sums players across multiple rooms', () => {
    const rooms = new Set([makeRoom(2), makeRoom(5), makeRoom(1)]);
    expect(countTotalActivePlayers(rooms)).toBe(8);
  });

  it('handles rooms with zero players', () => {
    const rooms = new Set([makeRoom(0), makeRoom(4)]);
    expect(countTotalActivePlayers(rooms)).toBe(4);
  });

  it('handles a room whose state is null gracefully without throwing', () => {
    const broken = { state: null, metadata: {} } as unknown as WorldRoom;
    const rooms = new Set([broken, makeRoom(2)]);
    // Should not throw; the broken room contributes 0.
    expect(countTotalActivePlayers(rooms)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// countActiveForTenant
// ---------------------------------------------------------------------------

describe('countActiveForTenant', () => {
  it('returns 0 when no rooms match the tenant slug', () => {
    const rooms = new Set([makeRoom(3, 'acme'), makeRoom(2, 'beta')]);
    expect(countActiveForTenant(rooms, 'gamma')).toBe(0);
  });

  it('counts only rooms belonging to the specified tenant slug', () => {
    const rooms = new Set([makeRoom(3, 'acme'), makeRoom(2, 'acme'), makeRoom(5, 'beta')]);
    expect(countActiveForTenant(rooms, 'acme')).toBe(5);
  });

  it('returns 0 for an empty room set', () => {
    expect(countActiveForTenant(new Set(), 'acme')).toBe(0);
  });

  it('ignores rooms without tenant metadata', () => {
    const noTenant = makeRoom(4);
    const rooms = new Set([noTenant, makeRoom(2, 'acme')]);
    expect(countActiveForTenant(rooms, 'acme')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// enforceOssLimit
// ---------------------------------------------------------------------------

describe('enforceOssLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false and allows join when below the OSS limit', async () => {
    setTenancyOss();
    const rooms = new Set([makeRoom(10)]);
    const client = makeClient();
    const aborted = await enforceOssLimit(rooms, client as unknown as Client);
    expect(aborted).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
    expect(client.leave).not.toHaveBeenCalled();
  });

  it('returns true and kicks client with 4002 when at the OSS limit (25)', async () => {
    setTenancyOss();
    const rooms = new Set([makeRoom(25)]);
    const client = makeClient();
    const aborted = await enforceOssLimit(rooms, client as unknown as Client);
    expect(aborted).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4002, 'oss_limit_reached');
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('returns false when enterprise bypass is active regardless of player count', async () => {
    setTenancyEnterprise();
    const rooms = new Set([makeRoom(100)]);
    const client = makeClient();
    const aborted = await enforceOssLimit(rooms, client as unknown as Client);
    expect(aborted).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// checkBillingStatus
// ---------------------------------------------------------------------------

describe('checkBillingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBillingModuleSync.mockReturnValue(null);
  });

  it('returns false when no billing module is loaded', async () => {
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { id: 'tid', bypassLimits: false };
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      tenant,
      'acme',
    );
    expect(result).toBe(false);
  });

  it('returns false when tenant is null', async () => {
    mockGetBillingModuleSync.mockReturnValue({ getTrialStatus: vi.fn(), getDunningStatus: vi.fn() } as any);
    const client = makeClient();
    const prisma = makePrisma();
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      null,
      'acme',
    );
    expect(result).toBe(false);
  });

  it('returns false when tenant.bypassLimits is true without calling billing module', async () => {
    const billingMod = { getTrialStatus: vi.fn(), getDunningStatus: vi.fn() };
    mockGetBillingModuleSync.mockReturnValue(billingMod as any);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { id: 'tid', bypassLimits: true };
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      tenant,
      'acme',
    );
    expect(result).toBe(false);
    expect(billingMod.getTrialStatus).not.toHaveBeenCalled();
  });

  it('kicks client with 4005 trial_expired when trial has expired', async () => {
    const billingMod = {
      getTrialStatus: vi.fn(() =>
        Promise.resolve({
          status: 'expired',
          startedAt: null,
          endsAt: null,
          daysRemaining: null,
          convertedAt: null,
        }),
      ),
      getDunningStatus: vi.fn(() => Promise.resolve({ status: 'ok' })),
    };
    mockGetBillingModuleSync.mockReturnValue(billingMod as any);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { id: 'tid', bypassLimits: false };
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      tenant,
      'acme',
    );
    expect(result).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4005, 'trial_expired');
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('kicks client with 4004 subscription_suspended when dunning status is suspended', async () => {
    const billingMod = {
      getTrialStatus: vi.fn(() =>
        Promise.resolve({
          status: 'active',
          startedAt: null,
          endsAt: null,
          daysRemaining: 10,
          convertedAt: null,
        }),
      ),
      getDunningStatus: vi.fn(() =>
        Promise.resolve({
          status: 'suspended',
          failedAt: null,
          gracePeriodEndsAt: null,
          dunningStep: 3,
          lastEmailAt: null,
          daysUntilCancellation: null,
        }),
      ),
    };
    mockGetBillingModuleSync.mockReturnValue(billingMod as any);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { id: 'tid', bypassLimits: false };
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      tenant,
      'acme',
    );
    expect(result).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4004, 'subscription_suspended');
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('returns false when trial is active and dunning status is ok', async () => {
    const billingMod = {
      getTrialStatus: vi.fn(() =>
        Promise.resolve({
          status: 'active',
          startedAt: null,
          endsAt: null,
          daysRemaining: 5,
          convertedAt: null,
        }),
      ),
      getDunningStatus: vi.fn(() =>
        Promise.resolve({
          status: 'ok',
          failedAt: null,
          gracePeriodEndsAt: null,
          dunningStep: 0,
          lastEmailAt: null,
          daysUntilCancellation: null,
        }),
      ),
    };
    mockGetBillingModuleSync.mockReturnValue(billingMod as any);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { id: 'tid', bypassLimits: false };
    const result = await checkBillingStatus(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      tenant,
      'acme',
    );
    expect(result).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// enforceTenantSeatLimit
// ---------------------------------------------------------------------------

describe('enforceTenantSeatLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: enterprise mode so the OSS global limit does not interfere.
    setTenancyEnterprise();
  });

  it('allows join when active count is below the effective seat limit', async () => {
    const rooms = new Set([makeRoom(2, 'acme')]);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { concurrentLimit: 10, freeSeats: 5 };
    const aborted = await enforceTenantSeatLimit(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      rooms,
      tenant,
      'acme',
    );
    expect(aborted).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it('kicks client with 4001 tenant_limit_reached when at the seat limit', async () => {
    const rooms = new Set([makeRoom(10, 'acme')]);
    const client = makeClient();
    const prisma = makePrisma();
    // active(10) >= effectiveLimit(max(10, 5) = 10)
    const tenant = { concurrentLimit: 10, freeSeats: 5 };
    const aborted = await enforceTenantSeatLimit(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      rooms,
      tenant,
      'acme',
    );
    expect(aborted).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4001, 'tenant_limit_reached');
    expect(client.leave).toHaveBeenCalledWith(1000);
  });

  it('uses freeSeats as effective limit when it exceeds concurrentLimit', async () => {
    const rooms = new Set([makeRoom(6, 'acme')]);
    const client = makeClient();
    const prisma = makePrisma();
    // effectiveLimit = max(3, 10) = 10; active = 6 -> allow
    const tenant = { concurrentLimit: 3, freeSeats: 10 };
    const aborted = await enforceTenantSeatLimit(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      rooms,
      tenant,
      'acme',
    );
    expect(aborted).toBe(false);
  });

  it('kicks client with 4002 when OSS global limit is reached and enterprise bypass is disabled', async () => {
    setTenancyOss();
    // 25 players globally -> hits OSS_USER_LIMIT before per-tenant seat check
    const rooms = new Set([makeRoom(25, 'acme')]);
    const client = makeClient();
    const prisma = makePrisma();
    const tenant = { concurrentLimit: 50, freeSeats: 50 };
    const aborted = await enforceTenantSeatLimit(
      client as unknown as Client,
      prisma as unknown as PrismaClient,
      rooms,
      tenant,
      'acme',
    );
    expect(aborted).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4002, 'oss_limit_reached');
  });
});

// ---------------------------------------------------------------------------
// enforceTenantLimits (integration-level, all sub-dependencies mocked)
// ---------------------------------------------------------------------------

describe('enforceTenantLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBillingModuleSync.mockReturnValue(null);
    setTenancyEnterprise();
  });

  it('returns false when no tenant record exists in the database', async () => {
    const prisma = makePrisma(null);
    mockCreatePrismaClient.mockReturnValue(prisma as unknown as PrismaClient);
    const room = makeRoom(0, 'acme');
    const rooms = new Set([room]);
    const client = makeClient();
    const options: RoomOptions = { tenant: 'acme' };
    const aborted = await enforceTenantLimits(room, rooms, options, client as unknown as Client);
    expect(aborted).toBe(false);
  });

  it('returns false when tenant has bypassLimits set to true', async () => {
    const tenantRow = { id: 'tid', slug: 'acme', bypassLimits: true, concurrentLimit: 5, freeSeats: 5 };
    const prisma = makePrisma(tenantRow);
    mockCreatePrismaClient.mockReturnValue(prisma as unknown as PrismaClient);
    const room = makeRoom(100, 'acme');
    const rooms = new Set([room]);
    const client = makeClient();
    const options: RoomOptions = { tenant: 'acme' };
    const aborted = await enforceTenantLimits(room, rooms, options, client as unknown as Client);
    expect(aborted).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it('aborts join with 4001 when tenant seat limit is exceeded', async () => {
    const tenantRow = { id: 'tid', slug: 'acme', bypassLimits: false, concurrentLimit: 2, freeSeats: 0 };
    const prisma = makePrisma(tenantRow);
    mockCreatePrismaClient.mockReturnValue(prisma as unknown as PrismaClient);
    // 2 players already in the acme room -> at limit
    const room = makeRoom(2, 'acme');
    const rooms = new Set([room]);
    const client = makeClient();
    const options: RoomOptions = { tenant: 'acme' };
    const aborted = await enforceTenantLimits(room, rooms, options, client as unknown as Client);
    expect(aborted).toBe(true);
    expect(client.error).toHaveBeenCalledWith(4001, 'tenant_limit_reached');
  });
});
