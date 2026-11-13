/**
 * The "Player joined" line of completePendingJoin carries identity, name and
 * map of the joining client. A long value from any of them must not make the
 * log line long.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));

// The map lookups miss, so the player ends up on the unresolved placeholder map
// and the requested map name is what the fallback keeps.
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
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: { findFirst: vi.fn(() => Promise.resolve(null)), findUnique: vi.fn(() => Promise.resolve(null)) },
  membership: {
    findMany: vi.fn(() => Promise.resolve([])),
    findFirst: vi.fn(() => Promise.resolve(null)),
    // The admit gate re-proves the verified tenant; the double stays a member.
    findUnique: vi.fn(() => Promise.resolve({ role: 'member', expiresAt: null })),
  },
  presence: { findMany: vi.fn(() => Promise.resolve([])) },
  user: { findUnique: vi.fn(() => Promise.resolve(null)) },
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
import { MAX_JOIN_TEXT_LENGTH } from './joinFields.js';
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

const HUGE = 'x'.repeat(900_000);
// The placeholder map id carries the client's tenant, which is itself bounded (see joinFields.ts).
const PLACEHOLDER_PREFIX = '__unresolved__:';
const LOG_BUDGET_CHARS = 1_000;

function makeRoom(): WorldRoom {
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
  return room;
}

/** The onAuth entry the admit gate needs for a human session. */
function registerJoin(room: WorldRoom, identity: string): void {
  room.worldAccess.register('sid-1', {
    identity,
    sessionId: 'db-session',
    tenantId: 'tenant-1',
    tenantSlug: 'tenant-1',
    isNpc: false,
    zonePrivacyVersion: 1,
  });
}

function makeClient(identity: string): CompletionClient {
  return {
    sessionId: 'sid-1',
    send: vi.fn(),
    view: { add() {}, remove() {}, has: () => false },
    auth: { identity, sessionId: 'db-session', isNpc: false, zonePrivacyVersion: 1 },
  } as unknown as CompletionClient;
}

/** Everything the logger received, as one string. */
function logged(): string {
  return JSON.stringify([log.debug, log.info, log.warn, log.error].flatMap((fn) => fn.mock.calls));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('completePendingJoin logs stay bounded', () => {
  it('for a long identity, name and map name', async () => {
    const options = { name: HUGE, mapName: HUGE, mapId: HUGE };
    const room = makeRoom();
    registerJoin(room, HUGE);

    await completePendingJoin(room, makeClient(HUGE), options, HUGE, FakePlayer as unknown as typeof PlayerCtor);

    expect(log.info).toHaveBeenCalledWith(
      '[WorldRoom] Player joined:',
      'sid-1',
      'identity:',
      expect.stringContaining('(900000 chars)'),
      'name:',
      expect.any(String),
      'mapId:',
      expect.any(String),
      'map:',
      expect.any(String),
      'at',
      expect.any(Number),
      expect.any(Number),
    );
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('for a long tenant that names the unresolved placeholder map', async () => {
    const room = makeRoom();
    registerJoin(room, 'user-1');
    await completePendingJoin(
      room,
      makeClient('user-1'),
      { tenant: HUGE },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );

    expect(log.info).toHaveBeenCalledWith(
      '[WorldRoom] Player joined:',
      'sid-1',
      'identity:',
      'user-1',
      'name:',
      expect.any(String),
      'mapId:',
      expect.stringContaining(`(${PLACEHOLDER_PREFIX.length + MAX_JOIN_TEXT_LENGTH} chars)`),
      'map:',
      expect.any(String),
      'at',
      expect.any(Number),
      expect.any(Number),
    );
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('and leave an ordinary name and identity readable', async () => {
    const room = makeRoom();
    registerJoin(room, 'user-1');
    await completePendingJoin(
      room,
      makeClient('user-1'),
      { name: 'J\u00f6rg M\u00fcller' },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );

    expect(logged()).toContain('user-1');
  });
});
