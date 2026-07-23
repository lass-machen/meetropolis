/**
 * Finding 7: when no real map can be resolved for the tenant (transient DB
 * error, or a tenant with zero maps), the player's mapId must be a NON-EMPTY,
 * tenant-namespaced placeholder — never a bare '' that would collide across
 * tenants and cross-deliver map-scoped broadcasts (player_joined etc.) between
 * two tenants sharing a room.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

// Every map lookup misses → resolveInitialMap must fall through to the
// namespaced placeholder. tenant.findUnique returns a default map name only.
const fakePrisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: { findFirst: vi.fn(() => Promise.resolve(null)) },
  membership: { findMany: vi.fn(() => Promise.resolve([])), findFirst: vi.fn(() => Promise.resolve(null)) },
  presence: { findMany: vi.fn(() => Promise.resolve([])) },
};
vi.mock('../../db.js', () => ({ createPrismaClient: () => fakePrisma }));

vi.mock('../utils/broadcastHelpers.js', () => ({ broadcastToMap: vi.fn() }));
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
import type { WorldRoom, Player as PlayerCtor } from '../WorldRoom.js';
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
    mapWidthTiles: 100,
    mapHeightTiles: 100,
    tileWidthPx: 32,
    tileHeightPx: 32,
    defaultSpawn: { x: 10, y: 10 },
  } as unknown as WorldRoom;
  return { room, players };
}

function makeClient(sessionId: string, tenantId: string): Client {
  return {
    sessionId,
    send: vi.fn(),
    view: fakeView(),
    auth: { identity: sessionId, isNpc: false, zonePrivacyVersion: 1, tenantId },
  } as unknown as Client;
}

beforeEach(() => {
  fakePrisma.tenant.findUnique.mockClear();
  fakePrisma.map.findFirst.mockClear();
});

describe('completePendingJoin: unresolvable map falls back to a tenant-namespaced non-empty mapId', () => {
  it('never leaves player.mapId empty and namespaces distinct tenants distinctly', async () => {
    const { room: roomA, players: pa } = makeRoom();
    const { room: roomB, players: pb } = makeRoom();

    await completePendingJoin(roomA, makeClient('sid-a', 'tid-a'), {}, 'user-a', fakePlayerClass);
    await completePendingJoin(roomB, makeClient('sid-b', 'tid-b'), {}, 'user-b', fakePlayerClass);

    const mapA = pa.get('sid-a')?.mapId;
    const mapB = pb.get('sid-b')?.mapId;

    expect(mapA).toBeTruthy();
    expect(mapB).toBeTruthy();
    expect(mapA).toMatch(/^__unresolved__:/);
    expect(mapB).toMatch(/^__unresolved__:/);
    // Two different tenants get DIFFERENT placeholders → no cross-tenant collision.
    expect(mapA).not.toBe(mapB);
    expect(mapA).toContain('tid-a');
    expect(mapB).toContain('tid-b');
  });
});
