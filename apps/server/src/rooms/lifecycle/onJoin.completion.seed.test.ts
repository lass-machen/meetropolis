/**
 * Join-seed handshake: one-shot join messages must wait for the client ready
 * signal when joinSeedProtocol is announced, and keep the legacy delay otherwise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));

interface MemberRow {
  userId: string;
  user: { id: string; email: string; name: string | null } | null;
}

const fakePrisma = {
  session: {
    findMany: vi.fn((args: { where?: { id?: { in?: string[] }; userId?: string } }) =>
      Promise.resolve([
        {
          id: args.where?.id?.in?.[0] ?? 'db-session',
          userId: args.where?.userId ?? 'user-1',
          expiresAt: new Date(Date.now() + 60_000),
        },
      ]),
    ),
  },
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: {
    findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', name: 'office' })),
    findUnique: vi.fn(() => Promise.resolve(null)),
  },
  membership: {
    findMany: vi.fn((): Promise<MemberRow[]> => Promise.resolve([])),
    findFirst: vi.fn(() => Promise.resolve(null)),
    findUnique: vi.fn(() => Promise.resolve({ role: 'member', expiresAt: null })),
  },
  presence: { findMany: vi.fn(() => Promise.resolve([])) },
  user: { findUnique: vi.fn(() => Promise.resolve({ name: 'Alice', email: 'alice@example.test', avatarId: null })) },
  avatarPack: { findFirst: vi.fn(() => Promise.resolve({ avatars: [{ key: 'business_man' }] })) },
  customAvatar: { findFirst: vi.fn(() => Promise.resolve(null)) },
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
import { markJoinSeedReady } from './joinSeed.js';
import { WorldAccessRegistry } from './worldAccess.js';
import type { WorldRoom, Player as PlayerCtor } from '../WorldRoom.js';

type CompletionClient = Parameters<typeof completePendingJoin>[1];

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

type SeedType = 'full_state' | 'bubble_state' | 'zone_lock_state' | 'presence_recent';

function isSeedType(type: unknown): type is SeedType {
  return type === 'full_state' || type === 'bubble_state' || type === 'zone_lock_state' || type === 'presence_recent';
}

function countSeedSends(send: ReturnType<typeof vi.fn>): Record<SeedType, number> {
  const counts: Record<SeedType, number> = {
    full_state: 0,
    bubble_state: 0,
    zone_lock_state: 0,
    presence_recent: 0,
  };
  for (const [type] of send.mock.calls) {
    if (isSeedType(type)) {
      counts[type] += 1;
    }
  }
  return counts;
}

function makeRoomAndClient(sessionId = 'sid-1'): {
  room: WorldRoom;
  client: CompletionClient;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn();
  const room = {
    prismaForPresence: fakePrisma,
    state: { players: new Map<string, FakePlayer>() },
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
  room.worldAccess = new WorldAccessRegistry(room);
  room.worldAccess.register(sessionId, {
    identity: 'user-1',
    sessionId: 'db-session',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    isNpc: false,
    zonePrivacyVersion: 1,
  });
  const client = {
    sessionId,
    send,
    view: { add() {}, remove() {}, has: () => false },
    auth: { identity: 'user-1', sessionId: 'db-session', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-1' },
  } as unknown as CompletionClient;
  return { room, client, send };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('join seed delivery', () => {
  it('holds one-shot seeds until markJoinSeedReady when joinSeedProtocol is 1', async () => {
    const { room, client, send } = makeRoomAndClient();
    await completePendingJoin(
      room,
      client,
      { joinSeedProtocol: 1 },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(countSeedSends(send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });

    markJoinSeedReady(client);
    expect(countSeedSends(send)).toEqual({
      full_state: 1,
      bubble_state: 1,
      zone_lock_state: 0,
      presence_recent: 1,
    });
  });

  it('ignores a second markJoinSeedReady for the same client', async () => {
    const { room, client, send } = makeRoomAndClient();
    await completePendingJoin(
      room,
      client,
      { joinSeedProtocol: 1 },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );
    markJoinSeedReady(client);
    const afterFirst = send.mock.calls.length;
    markJoinSeedReady(client);
    expect(send.mock.calls.length).toBe(afterFirst);
  });

  it('delivers after the legacy 200 ms delay when joinSeedProtocol is absent', async () => {
    const { room, client, send } = makeRoomAndClient();
    await completePendingJoin(room, client, {}, 'user-1', FakePlayer as unknown as typeof PlayerCtor);

    expect(countSeedSends(send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });

    await vi.advanceTimersByTimeAsync(200);
    expect(countSeedSends(send)).toEqual({
      full_state: 1,
      bubble_state: 1,
      zone_lock_state: 0,
      presence_recent: 1,
    });
  });

  it('never delivers on a protocol client without ready, and ignores ready on another client', async () => {
    const first = makeRoomAndClient('sid-1');
    await completePendingJoin(
      first.room,
      first.client,
      { joinSeedProtocol: 1 },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );

    const otherSend = vi.fn();
    const otherClient = {
      sessionId: 'sid-other',
      send: otherSend,
      view: { add() {}, remove() {}, has: () => false },
      auth: {
        identity: 'user-other',
        sessionId: 'db-other',
        isNpc: false,
        zonePrivacyVersion: 1,
        tenantId: 'tenant-1',
      },
    } as unknown as CompletionClient;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(countSeedSends(first.send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });

    markJoinSeedReady(otherClient);
    expect(countSeedSends(first.send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });
  });

  it('delivers immediately when ready arrives before the protocol join', async () => {
    const { room, client, send } = makeRoomAndClient();
    markJoinSeedReady(client);
    await completePendingJoin(
      room,
      client,
      { joinSeedProtocol: 1 },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );

    expect(countSeedSends(send)).toEqual({
      full_state: 1,
      bubble_state: 1,
      zone_lock_state: 0,
      presence_recent: 1,
    });

    const afterFirst = send.mock.calls.length;
    markJoinSeedReady(client);
    expect(send.mock.calls.length).toBe(afterFirst);
  });

  it('keeps the legacy 200 ms delay when ready arrives before a non-protocol join', async () => {
    const { room, client, send } = makeRoomAndClient();
    markJoinSeedReady(client);
    await completePendingJoin(room, client, {}, 'user-1', FakePlayer as unknown as typeof PlayerCtor);

    expect(countSeedSends(send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(countSeedSends(send)).toEqual({
      full_state: 0,
      bubble_state: 0,
      zone_lock_state: 0,
      presence_recent: 0,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(countSeedSends(send)).toEqual({
      full_state: 1,
      bubble_state: 1,
      zone_lock_state: 0,
      presence_recent: 1,
    });
  });
});
