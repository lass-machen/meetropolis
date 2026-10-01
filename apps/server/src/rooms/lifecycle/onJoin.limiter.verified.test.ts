/**
 * Billing and seat limits are computed for the tenant the JWT verified onto
 * client.auth, never for the slug the client sent in options.tenant.
 *
 * The scenarios are the ones measured against a real server before the change
 * (a member of a full tenant joining under an unknown slug was admitted; a
 * member of tenant A claiming tenant B's slug took B's only seat and locked B's
 * own member out), plus an expired tenant, a join without any tenant, NPCs and
 * the token-less staged join. Everything outside the limiter is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tenants = vi.hoisted(() => {
  type Row = { id: string; slug: string; concurrentLimit: number; freeSeats: number; bypassLimits: boolean };
  const row = (id: string, slug: string, seats: number, bypassLimits = false): Row => ({
    id,
    slug,
    concurrentLimit: seats,
    freeSeats: seats,
    bypassLimits,
  });
  return {
    acme: row('tid-acme', 'acme', 50),
    beta: row('tid-beta', 'beta', 1),
    expired: row('tid-expired', 'expired-co', 50),
    vip: row('tid-vip', 'vip', 1, true),
  };
});

vi.mock('../../tenancyLoader.js', () => ({
  OSS_USER_LIMIT: 25,
  getTenancyModule: vi.fn(() =>
    Promise.resolve({ version: 1, isMultiTenantEnabled: () => true, bypassOssLimit: () => true }),
  ),
}));

vi.mock('../../billingLoader.js', () => ({
  getBillingModuleSync: vi.fn(() => ({
    getTrialStatus: vi.fn((_prisma: unknown, tenantId: string) =>
      Promise.resolve({ status: tenantId === 'tid-expired' ? 'expired' : 'active' }),
    ),
    getDunningStatus: vi.fn(() => Promise.resolve({ status: 'ok' })),
  })),
}));

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const findUnique = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({
  createPrismaClient: vi.fn(() => ({ tenant: { findUnique }, $disconnect: vi.fn(() => Promise.resolve()) })),
}));

vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));
vi.mock('./ghostDetection.js', () => ({ findExistingSession: vi.fn(() => null) }));
vi.mock('../handlers/sessionHandlers.js', () => ({ takeOverExistingSessions: vi.fn() }));
const completePendingJoin = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('./onJoin.completion.js', () => ({ completePendingJoin }));

import type { Client } from 'colyseus';
import { collectActiveIdentitiesForVerifiedTenant, enforceTenantLimits, type RoomMetadata } from './onJoin.limiter.js';
import { performOnJoin } from './onJoin.js';
import { createPrismaClient } from '../../db.js';
import { NO_TENANT_KEY } from './tenantView.js';
import type { WorldRoom, RoomOptions, Player } from '../WorldRoom.js';
import type { WorldAuth } from './onAuth.js';

type Row = (typeof tenants)[keyof typeof tenants];

interface SeatedPlayer {
  identity: string;
  /** Verified owner (tenant id), the sentinel for an unverified join, or undefined. */
  key?: string;
  isNpc?: boolean;
}

/** A room that holds `players`, partitioned under the room slug `roomTenant`. */
function makeRoom(roomTenant: string | undefined, players: SeatedPlayer[] = []): WorldRoom {
  const state = new Map<string, { identity: string; isNpc: boolean }>();
  const playerTenantKey = new Map<string, string>();
  players.forEach((p, i) => {
    state.set(`s${i}`, { identity: p.identity, isNpc: p.isNpc ?? false });
    if (p.key !== undefined) playerTenantKey.set(`s${i}`, p.key);
  });
  const metadata: RoomMetadata = roomTenant ? { tenant: roomTenant } : {};
  return { state: { players: state }, playerTenantKey, metadata } as unknown as WorldRoom;
}

/** A client whose JWT verified `tenant` (or none: a token-less staged join). */
function makeClient(tenant: Row | null, identity = 'joiner'): Client {
  const auth: WorldAuth = { identity, isNpc: false, zonePrivacyVersion: 1 };
  if (tenant) {
    auth.tenantId = tenant.id;
    auth.tenantSlug = tenant.slug;
  }
  return { error: vi.fn(), leave: vi.fn(), auth } as unknown as Client;
}

/** `n` distinct verified members of `tenant`. */
function members(tenant: Row, n: number, prefix = tenant.slug): SeatedPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ identity: `${prefix}-user-${i}`, key: tenant.id }));
}

function errorCode(client: Client): number | undefined {
  const calls = vi.mocked(client.error).mock.calls;
  return calls.length > 0 ? calls[0]?.[0] : undefined;
}

const join = (
  room: WorldRoom,
  rooms: WorldRoom[],
  options: RoomOptions | undefined,
  client: Client,
  identity: string,
) => enforceTenantLimits(room, new Set(rooms), options, client, identity);

beforeEach(() => {
  vi.clearAllMocks();
  const byId = new Map(Object.values(tenants).map((t) => [t.id, t]));
  const bySlug = new Map(Object.values(tenants).map((t) => [t.slug, t]));
  findUnique.mockImplementation(({ where }: { where: { id?: string; slug?: string } }) =>
    Promise.resolve((where.id ? byId.get(where.id) : bySlug.get(where.slug ?? '')) ?? null),
  );
});

describe('which tenant the limits are computed for', () => {
  it('looks the verified tenant up by id and a token-less joiner by the slug it sent', async () => {
    const room = makeRoom('beta');
    await join(room, [room], { tenant: 'whatever' }, makeClient(tenants.acme), 'u1');
    expect(findUnique).toHaveBeenLastCalledWith({ where: { id: tenants.acme.id } });

    await join(room, [room], { tenant: 'acme' }, makeClient(null), 'u2');
    expect(findUnique).toHaveBeenLastCalledWith({ where: { slug: 'acme' } });
  });

  it('applies the seat cap of a full tenant when its member sends an UNKNOWN slug (measured: was admitted)', async () => {
    const full = makeRoom('beta', members(tenants.beta, 1));
    const client = makeClient(tenants.beta, 'beta-user-9');
    const aborted = await join(full, [full], { tenant: 'zz-unknown' }, client, 'beta-user-9');
    expect(aborted).toBe(true);
    expect(errorCode(client)).toBe(4001);
  });

  it("does not charge another tenant's seats when a member sends that tenant's slug (measured: was refused)", async () => {
    // Beta has its single seat taken. An acme member claims beta's slug: acme's
    // 50 seats apply, beta's count is irrelevant.
    const betaRoom = makeRoom('beta', members(tenants.beta, 1));
    const client = makeClient(tenants.acme, 'acme-user-0');
    expect(await join(betaRoom, [betaRoom], { tenant: 'beta' }, client, 'acme-user-0')).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it("does not let a foreign member take a tenant's only seat (measured: locked beta's own member out)", async () => {
    // acme-user-0 sits in beta's room because it sent beta's slug. Its player is
    // owned by acme, so beta still has its seat for its own member.
    const betaRoom = makeRoom('beta', [{ identity: 'acme-user-0', key: tenants.acme.id }]);
    const client = makeClient(tenants.beta, 'beta-user-0');
    expect(await join(betaRoom, [betaRoom], { tenant: 'beta' }, client, 'beta-user-0')).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it("computes a join without any tenant for the member's own tenant, not for the room Colyseus picked", async () => {
    // No options.tenant: Colyseus put the joiner into the first room, acme's.
    // The joiner belongs to full tenant beta, so beta's cap decides.
    const acmeRoom = makeRoom('acme', [...members(tenants.acme, 2), ...members(tenants.beta, 1)]);
    const client = makeClient(tenants.beta, 'beta-user-9');
    expect(await join(acmeRoom, [acmeRoom], undefined, client, 'beta-user-9')).toBe(true);
    expect(errorCode(client)).toBe(4001);
  });

  it('rejects the member of an expired tenant whatever slug it sends (billing was skipped for unknown slugs)', async () => {
    const room = makeRoom('acme', members(tenants.acme, 1));
    for (const options of [{ tenant: 'zz-unknown' }, { tenant: 'acme' }, undefined]) {
      const client = makeClient(tenants.expired, 'exp-user-0');
      expect(await join(room, [room], options, client, 'exp-user-0')).toBe(true);
      expect(errorCode(client)).toBe(4005);
    }
  });

  it("does not apply another tenant's expired billing state to a member who claims its slug", async () => {
    const expiredRoom = makeRoom('expired-co');
    const client = makeClient(tenants.acme, 'acme-user-0');
    expect(await join(expiredRoom, [expiredRoom], { tenant: 'expired-co' }, client, 'acme-user-0')).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it('keeps the unlimited-tenant exemption', async () => {
    const room = makeRoom('vip', members(tenants.vip, 3));
    const client = makeClient(tenants.vip, 'vip-user-9');
    expect(await join(room, [room], { tenant: 'zz-unknown' }, client, 'vip-user-9')).toBe(false);
  });

  it('keeps the reconnect self-exemption at the cap', async () => {
    const room = makeRoom('beta', members(tenants.beta, 1));
    const client = makeClient(tenants.beta, 'beta-user-0');
    expect(await join(room, [room], { tenant: 'beta' }, client, 'beta-user-0')).toBe(false);
  });
});

describe('seats are counted per verified owner', () => {
  it('counts one tenant separately from another in a room both share (apex clients all send "default")', () => {
    const shared = makeRoom('default', [...members(tenants.acme, 3), ...members(tenants.beta, 2)]);
    const rooms = new Set([shared]);
    expect(collectActiveIdentitiesForVerifiedTenant(rooms, tenants.acme.id, 'acme').size).toBe(3);
    expect(collectActiveIdentitiesForVerifiedTenant(rooms, tenants.beta.id, 'beta').size).toBe(2);
  });

  it('counts a tenant across rooms, once per identity, without NPCs', () => {
    const one = makeRoom('acme', [...members(tenants.acme, 2), { identity: 'npc-1', key: NO_TENANT_KEY, isNpc: true }]);
    const two = makeRoom('beta', [{ identity: 'acme-user-0', key: tenants.acme.id }, ...members(tenants.acme, 1, 'x')]);
    const ids = collectActiveIdentitiesForVerifiedTenant(new Set([one, two]), tenants.acme.id, 'acme');
    expect([...ids].sort()).toEqual(['acme-user-0', 'acme-user-1', 'x-user-0']);
  });

  it('charges an unverified player to the tenant of the room it joined, and to nobody else', () => {
    const room = makeRoom('beta', [{ identity: 'legacy-1', key: NO_TENANT_KEY }, { identity: 'legacy-2' }]);
    const rooms = new Set([room]);
    expect(collectActiveIdentitiesForVerifiedTenant(rooms, tenants.beta.id, 'beta').size).toBe(2);
    expect(collectActiveIdentitiesForVerifiedTenant(rooms, tenants.acme.id, 'acme').size).toBe(0);
  });
});

describe('a join without a verified tenant (token-less staged join)', () => {
  it('still resolves the slug it sent against the database and applies that tenant’s cap', async () => {
    const full = makeRoom('beta', [{ identity: 'legacy-1', key: NO_TENANT_KEY }]);
    const client = makeClient(null, 'legacy-2');
    expect(await join(full, [full], { tenant: 'beta' }, client, 'legacy-2')).toBe(true);
    expect(errorCode(client)).toBe(4001);
  });

  it('admits an unknown slug as before: there is no tenant to bill', async () => {
    const room = makeRoom('zz-unknown');
    const client = makeClient(null, 'legacy-1');
    expect(await join(room, [room], { tenant: 'zz-unknown' }, client, 'legacy-1')).toBe(false);
    expect(client.error).not.toHaveBeenCalled();
  });

  it('treats auth without a tenant id the same way', async () => {
    const full = makeRoom('beta', [{ identity: 'legacy-1', key: NO_TENANT_KEY }]);
    const client = {
      error: vi.fn(),
      leave: vi.fn(),
      auth: { identity: 'legacy-2', isNpc: false, zonePrivacyVersion: 0 },
    };
    expect(await join(full, [full], { tenant: 'beta' }, client as unknown as Client, 'legacy-2')).toBe(true);
  });
});

describe('NPCs', () => {
  it('never reach the tenant limiter, whatever slug they send', async () => {
    const npc = {
      auth: { identity: 'npc-guide', isNpc: true, zonePrivacyVersion: 1 },
      sessionId: 's1',
    } as unknown as Client;
    const room = makeRoom('beta', members(tenants.beta, 1));
    await performOnJoin(room, new Set([room]), npc, { tenant: 'beta' }, class {} as unknown as typeof Player);
    expect(createPrismaClient).not.toHaveBeenCalled();
    expect(completePendingJoin).toHaveBeenCalledTimes(1);
  });
});
