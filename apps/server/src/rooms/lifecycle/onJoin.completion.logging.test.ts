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
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: { findFirst: vi.fn(() => Promise.resolve(null)), findUnique: vi.fn(() => Promise.resolve(null)) },
  membership: { findMany: vi.fn(() => Promise.resolve([])), findFirst: vi.fn(() => Promise.resolve(null)) },
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
const LOG_BUDGET_CHARS = 1_000;

function makeRoom(): WorldRoom {
  return {
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
}

function makeClient(identity: string): CompletionClient {
  return {
    sessionId: 'sid-1',
    send: vi.fn(),
    view: { add() {}, remove() {}, has: () => false },
    auth: { identity, isNpc: false, zonePrivacyVersion: 1 },
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

    await completePendingJoin(makeRoom(), makeClient(HUGE), options, HUGE, FakePlayer as unknown as typeof PlayerCtor);

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
    await completePendingJoin(
      makeRoom(),
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
      expect.stringContaining('(900015 chars)'),
      'map:',
      expect.any(String),
      'at',
      expect.any(Number),
      expect.any(Number),
    );
    expect(logged().length).toBeLessThan(LOG_BUDGET_CHARS);
  });

  it('and leave an ordinary name and identity readable', async () => {
    await completePendingJoin(
      makeRoom(),
      makeClient('user-1'),
      { name: 'Jörg Müller' },
      'user-1',
      FakePlayer as unknown as typeof PlayerCtor,
    );

    expect(logged()).toContain('user-1');
  });
});
