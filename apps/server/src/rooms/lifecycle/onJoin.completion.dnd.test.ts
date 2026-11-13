/**
 * Unit tests for completePendingJoin's DND resync: the joining client's
 * local DND state, passed as the `dnd` join option, must be re-asserted
 * onto the freshly created Player before the player_joined broadcast, so
 * peers never briefly see a reconnecting DND user as available. Only a
 * literal boolean `true` enables DND; anything else (absent, a string,
 * etc.) resolves to false.
 *
 * The DB-touching collaborators are mocked so the test exercises only the
 * completion path's own field-assignment and broadcast order.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

// Arg-aware stubs so the same mock serves the guest-expiry short-circuit AND
// resolveInitialMap's tenant-scoped lookups.
type FindArgs = { where?: { id?: string; name?: string; slug?: string } };
const fakePrisma = {
  session: {
    findMany: vi.fn((args: { where?: { id?: { in?: string[] }; userId?: string } }) =>
      Promise.resolve([{
        id: args.where?.id?.in?.[0] ?? 'db-session',
        userId: args.where?.userId ?? 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      }]),
    ),
  },
  tenant: {
    // checkGuestExpired + seedPresenceRecent look up by slug and short-circuit
    // on null. resolveInitialMap looks up the tenant's defaultMapName by id.
    findUnique: vi.fn((args: FindArgs) => Promise.resolve(args?.where?.id ? { defaultMapName: 'office' } : null)),
  },
  map: {
    // Ownership check: only 'map-1' is owned; any other id (e.g. a cross-tenant
    // 'map-b') resolves to null. Name/default lookups return the tenant's own
    // office map.
    findFirst: vi.fn((args: FindArgs) => {
      const where = args?.where ?? {};
      if (where.id) return Promise.resolve(where.id === 'map-1' ? { id: 'map-1', name: 'office' } : null);
      return Promise.resolve({ id: 'tenant-a-office', name: 'office' });
    }),
  },
  user: { findUnique: vi.fn(() => Promise.resolve(null)) },
  membership: {
    findMany: vi.fn(() => Promise.resolve([])),
    findFirst: vi.fn(() => Promise.resolve(null)),
    // The admit gate re-proves the verified tenant; the double stays a member.
    findUnique: vi.fn(() => Promise.resolve({ role: 'member', expiresAt: null })),
  },
  avatarPack: {
    findFirst: vi.fn(() => Promise.resolve({ avatars: [{ key: 'business_man' }] })),
  },
  customAvatar: { findFirst: vi.fn(() => Promise.resolve(null)) },
};
vi.mock('../../db.js', () => ({
  createPrismaClient: () => fakePrisma,
}));

const broadcastToMapMock = vi.fn();
vi.mock('../utils/broadcastHelpers.js', () => ({
  broadcastToMap: (...args: unknown[]) => broadcastToMapMock(...args),
}));

vi.mock('../utils/mapBoundsHelpers.js', () => ({
  sanitizePosition: (_room: unknown, x: number, y: number) => ({ x, y }),
  sanitizePositionForMap: (_room: unknown, x: number, y: number) => ({ x, y }),
  getMapCenter: () => ({ x: 100, y: 100 }),
}));

vi.mock('../utils/bubbleHelpers.js', () => ({
  getAllBubbleMembers: () => [],
}));

vi.mock('../audioZones/runtime.js', () => ({
  warmZoneCatalog: vi.fn(() => Promise.resolve()),
  trackMove: vi.fn(),
}));

import { completePendingJoin } from './onJoin.completion.js';
import { WorldAccessRegistry } from './worldAccess.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import type { Client } from 'colyseus';

// Minimal stand-in for the Colyseus schema Player: plain fields with the
// same defaults completePendingJoin relies on.
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

// Minimal StateView stand-in: completePendingJoin now wires the per-client
// tenant view (tenantView.ts), which calls client.view.add(player). The real
// StateView.add requires a rooted Colyseus schema; these tests use FakePlayer,
// so a no-op double keeps the call harmless. Visibility filtering itself has its
// own dedicated test (tenantView.test.ts) with real schema instances.
function fakeView(): unknown {
  return { add() {}, remove() {}, has: () => false };
}

function makeRoom(): { room: WorldRoom; players: Map<string, FakePlayer> } {
  const players = new Map<string, FakePlayer>();
  const room = {
    prismaForPresence: fakePrisma,
    state: { players },
    lastSeen: new Map(),
    playerTenantKey: new Map<string, string>(),
    clients: [],
    bubbleGroups: {},
    zoneLockState: { locks: new Map() },
    metadata: { tenant: 'default' },
    // Pre-loaded map metadata so ensureRoomMapMetadata skips its DB path.
    mapWidthTiles: 100,
    mapHeightTiles: 100,
    tileWidthPx: 32,
    tileHeightPx: 32,
    defaultSpawn: { x: 10, y: 10 },
  } as unknown as WorldRoom;
  room.worldAccess = new WorldAccessRegistry(room);
  return { room, players };
}

/** The onAuth entry the admit gate needs for a human session. */
function registerJoin(room: WorldRoom, sessionId: string, identity: string): void {
  room.worldAccess.register(sessionId, {
    identity,
    sessionId: 'db-session',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    isNpc: false,
    zonePrivacyVersion: 1,
  });
}

// Common options that keep every DB-backed resolver on its short-circuit
// path (explicit mapId, name and avatarId).
function baseOptions(extra: Partial<RoomOptions>): RoomOptions {
  return { mapId: 'map-1', mapName: 'office', name: 'Alice', avatarId: 'avatar-x', ...extra };
}

beforeEach(() => {
  broadcastToMapMock.mockClear();
  fakePrisma.tenant.findUnique.mockClear();
  fakePrisma.map.findFirst.mockClear();
});

describe('completePendingJoin: dnd resync via join option', () => {
  it('sets player.dnd = true and broadcasts player_joined with dnd:true when options.dnd === true', async () => {
    const { room, players } = makeRoom();
    const client = { sessionId: 'sid-1', send: vi.fn(), view: fakeView() } as unknown as Client;
    registerJoin(room, 'sid-1', 'user-1');

    await completePendingJoin(room, client, baseOptions({ dnd: true }), 'user-1', fakePlayerClass);

    expect(players.get('sid-1')?.dnd).toBe(true);
    expect(broadcastToMapMock).toHaveBeenCalledWith(
      room,
      'map-1',
      'player_joined',
      expect.objectContaining({ id: 'sid-1', dnd: true }),
      client,
    );
  });

  it('defaults player.dnd to false when the dnd option is absent', async () => {
    const { room, players } = makeRoom();
    const client = { sessionId: 'sid-2', send: vi.fn(), view: fakeView() } as unknown as Client;
    registerJoin(room, 'sid-2', 'user-2');

    await completePendingJoin(room, client, baseOptions({}), 'user-2', fakePlayerClass);

    expect(players.get('sid-2')?.dnd).toBe(false);
    expect(broadcastToMapMock).toHaveBeenCalledWith(
      room,
      'map-1',
      'player_joined',
      expect.objectContaining({ id: 'sid-2', dnd: false }),
      client,
    );
  });

  it('does not enable DND for a non-boolean truthy value (string "true")', async () => {
    const { room, players } = makeRoom();
    const client = { sessionId: 'sid-3', send: vi.fn(), view: fakeView() } as unknown as Client;
    registerJoin(room, 'sid-3', 'user-3');
    // A spoofed/legacy client could send a string; only a real boolean true counts.
    const options = baseOptions({ dnd: 'true' as unknown as boolean });

    await completePendingJoin(room, client, options, 'user-3', fakePlayerClass);

    expect(players.get('sid-3')?.dnd).toBe(false);
    expect(broadcastToMapMock).toHaveBeenCalledWith(
      room,
      'map-1',
      'player_joined',
      expect.objectContaining({ id: 'sid-3', dnd: false }),
      client,
    );
  });
});

// ---------------------------------------------------------------------------
// completePendingJoin: cross-tenant mapId is rejected (tenant-scoping security)
//
// resolveInitialMap must scope map resolution to the tenant that onAuth
// verified onto client.auth.tenantId, NOT to the client-supplied options. A
// mapId belonging to another tenant (e.g. a stale localStorage id after a
// tenant switch) must be ignored in favour of the authenticated tenant's map.
// ---------------------------------------------------------------------------

describe('completePendingJoin: cross-tenant mapId rejection', () => {
  it("ignores another tenant's mapId and resolves the authenticated tenant's map", async () => {
    const { room, players } = makeRoom();
    const client = {
      sessionId: 'sid-A',
      send: vi.fn(),
      view: fakeView(),
      // WorldAuth attached by onAuth: the JWT-verified tenant is 'tenant-a'.
      auth: { identity: 'user-b', sessionId: 'db-session', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-a' },
    } as unknown as Client;
    room.worldAccess.register('sid-A', {
      identity: 'user-b',
      sessionId: 'db-session',
      tenantId: 'tenant-a',
      tenantSlug: 'auth-a',
      isNpc: false,
      zonePrivacyVersion: 1,
    });
    // 'map-b' belongs to another tenant (not owned by tenant-a in the mock).
    const options = baseOptions({ mapId: 'map-b' });

    await completePendingJoin(room, client, options, 'user-b', fakePlayerClass);

    const player = players.get('sid-A');
    expect(player?.mapId).not.toBe('map-b');
    expect(player?.mapId).toBe('tenant-a-office');
    expect(broadcastToMapMock).toHaveBeenCalledWith(
      room,
      'tenant-a-office',
      'player_joined',
      expect.objectContaining({ id: 'sid-A' }),
      client,
    );
    // The ownership check was scoped to the authenticated tenantId, not the slug.
    expect(fakePrisma.map.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'map-b', tenantId: 'tenant-a' }) }),
    );
  });
});
