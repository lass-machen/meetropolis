/**
 * Security regression (M2 + skeptic Finding 1, fail-open PII): the presence seed
 * and guest-expiry check must be scoped by the JWT-VERIFIED auth.tenantId, never
 * by the client-supplied options.tenant. A logged-in user of tenant A joining
 * with options.tenant='spoof-b' must NOT receive tenant B's member list
 * (names/emails) or live presence via `presence_recent`.
 *
 * Finding 1 specifically: scoping by the verified tenantId (straight off the
 * token) instead of a DB-resolved slug closes a FAIL-OPEN hole — if the slug
 * resolution failed (transient DB error, or a deleted tenant with a still-valid
 * JWT) the old slug path fell back to the spoofable options.tenant. The victim
 * tenant B is fully resolvable in the mock, so any regression back to the slug
 * fallback would immediately query tenant B and fail the test.
 *
 * DB collaborators are mocked; the test asserts on the tenant/membership query
 * scope, which is the leak vector.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

// Arg-aware Prisma. Tenant A is the AUTHENTICATED tenant; tenant B is the VICTIM
// the client tries to reach via a spoofed options.tenant='spoof-b'. B resolves
// fully (slug + members) so a regression to the spoofable slug path would leak.
const A = { id: 'tenant-a-id', slug: 'auth-a', defaultMapName: 'office' };
const B = { id: 'tenant-b-id', slug: 'spoof-b', defaultMapName: 'office' };
type Where = { where?: { id?: string; slug?: string; tenantId?: string; name?: string } };
const fakePrisma = {
  tenant: {
    findUnique: vi.fn((args: Where) => {
      const w = args?.where ?? {};
      if (w.slug === 'auth-a' || w.id === 'tenant-a-id') return Promise.resolve(A);
      if (w.slug === 'spoof-b' || w.id === 'tenant-b-id') return Promise.resolve(B);
      return Promise.resolve(null);
    }),
  },
  map: {
    findFirst: vi.fn((args: Where) => {
      const tid = args?.where?.tenantId;
      if (tid === 'tenant-a-id') return Promise.resolve({ id: 'a-office', name: 'office' });
      if (tid === 'tenant-b-id') return Promise.resolve({ id: 'b-office', name: 'office' });
      return Promise.resolve(null);
    }),
  },
  membership: {
    findMany: vi.fn((args: Where) => {
      const tid = args?.where?.tenantId;
      if (tid === 'tenant-a-id')
        return Promise.resolve([
          { userId: 'user-a', user: { id: 'user-a', email: 'a@tenant-a.test', name: 'Alice A' } },
        ]);
      if (tid === 'tenant-b-id')
        return Promise.resolve([
          { userId: 'victim-b', user: { id: 'victim-b', email: 'secret@tenant-b.test', name: 'Victim Bob' } },
        ]);
      return Promise.resolve([]);
    }),
    findFirst: vi.fn(() => Promise.resolve(null)), // not an expired guest
  },
  presence: {
    findMany: vi.fn(() => Promise.resolve([])),
  },
};
vi.mock('../../db.js', () => ({ createPrismaClient: () => fakePrisma }));

const broadcastToMapMock = vi.fn();
vi.mock('../utils/broadcastHelpers.js', () => ({
  broadcastToMap: (...args: unknown[]) => broadcastToMapMock(...args),
}));
vi.mock('../utils/mapBoundsHelpers.js', () => ({
  sanitizePosition: (_r: unknown, x: number, y: number) => ({ x, y }),
  sanitizePositionForMap: (_r: unknown, x: number, y: number) => ({ x, y }),
  getMapCenter: () => ({ x: 100, y: 100 }),
}));
vi.mock('../utils/bubbleHelpers.js', () => ({ getAllBubbleMembers: () => [] }));
vi.mock('../audioZones/runtime.js', () => ({
  warmZoneCatalog: vi.fn(() => Promise.resolve()),
  trackMove: vi.fn(),
}));

import { completePendingJoin } from './onJoin.completion.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import type { Client } from 'colyseus';

class FakePlayer {
  id = '';
  x = 0;
  y = 0;
  direction = 'down';
  identity = '';
  name = '';
  dnd = false;
  avatarId = '';
  isNpc = false;
  mapId = '';
  mapName = '';
}
const fakePlayerClass = FakePlayer as unknown as typeof PlayerCtor;

// No-op StateView double (see onJoin.completion.dnd.test.ts): the tenant view
// wiring calls client.view.add(player); real filtering is covered by
// tenantView.test.ts with real schema instances.
function fakeView(): unknown {
  return { add() {}, remove() {}, has: () => false };
}

function makeRoom(): WorldRoom {
  return {
    prismaForPresence: fakePrisma,
    state: { players: new Map<string, FakePlayer>() },
    lastSeen: new Map(),
    playerTenantKey: new Map<string, string>(),
    clients: [],
    bubbleGroups: {},
    zoneLockState: { locks: new Map() },
    metadata: { tenant: 'auth-a' },
    // Pre-loaded map metadata so ensureRoomMapMetadata skips its DB path.
    mapWidthTiles: 100,
    mapHeightTiles: 100,
    tileWidthPx: 32,
    tileHeightPx: 32,
    defaultSpawn: { x: 10, y: 10 },
  } as unknown as WorldRoom;
}

beforeEach(() => {
  broadcastToMapMock.mockClear();
  fakePrisma.tenant.findUnique.mockClear();
  fakePrisma.membership.findMany.mockClear();
  fakePrisma.presence.findMany.mockClear();
});

function membershipTenantIds(): (string | undefined)[] {
  return fakePrisma.membership.findMany.mock.calls.map((c) => c[0]?.where?.tenantId);
}
function presenceTenantIds(): (string | undefined)[] {
  return fakePrisma.presence.findMany.mock.calls.map((c) => (c[0] as Where)?.where?.tenantId);
}
function tenantSlugsQueried(): (string | undefined)[] {
  return fakePrisma.tenant.findUnique.mock.calls.map((c) => c[0]?.where?.slug);
}

describe('completePendingJoin: presence/guest scoped by the verified auth tenant', () => {
  it('ignores a spoofed options.tenant and seeds presence from the verified auth.tenantId', async () => {
    const room = makeRoom();
    const client = {
      sessionId: 'sid-1',
      send: vi.fn(),
      view: fakeView(),
      // Verified user of tenant A; the client SPOOFS options.tenant='spoof-b'.
      auth: { identity: 'user-a', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-a-id', tenantSlug: 'auth-a' },
    } as unknown as Client;
    const options = { tenant: 'spoof-b', mapName: 'office', name: 'Alice', avatarId: 'av' } as RoomOptions;

    await completePendingJoin(room, client, options, 'user-a', fakePlayerClass);

    // Member + presence reads scoped to tenant A's id only — never the victim.
    expect(membershipTenantIds()).toContain('tenant-a-id');
    expect(membershipTenantIds()).not.toContain('tenant-b-id');
    for (const tid of presenceTenantIds()) expect(tid).toBe('tenant-a-id');
    // The spoofed slug/id was never resolved anywhere.
    expect(tenantSlugsQueried()).not.toContain('spoof-b');
  });

  it('FAIL-OPEN closed: stays scoped to auth.tenantId even when the auth slug is unresolved', async () => {
    const room = makeRoom();
    const client = {
      sessionId: 'sid-2',
      send: vi.fn(),
      view: fakeView(),
      // Verified tenantId, but NO tenantSlug — mirrors resolveTenantSlug failing
      // (transient DB error, or a deleted tenant with a still-valid 30d JWT).
      auth: { identity: 'user-a', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-a-id' },
    } as unknown as Client;
    const options = { tenant: 'spoof-b', mapName: 'office', name: 'Attacker', avatarId: 'av' } as RoomOptions;

    await completePendingJoin(room, client, options, 'user-a', fakePlayerClass);

    // Even with the slug unresolved, the verified tenantId anchors the scope:
    // the victim tenant is never queried (no fall-back to options.tenant).
    expect(membershipTenantIds()).toContain('tenant-a-id');
    expect(membershipTenantIds()).not.toContain('tenant-b-id');
    for (const tid of presenceTenantIds()) expect(tid).toBe('tenant-a-id');
    expect(tenantSlugsQueried()).not.toContain('spoof-b');
  });
});
