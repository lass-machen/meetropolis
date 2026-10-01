/**
 * The direction, map name and placeholder map id a join puts into the room
 * state. Each of them is synchronised to every peer, and each can come
 * straight from a client option, so none may take whatever the client sends.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));

interface MapWhere {
  name?: string;
  id?: string;
}

const fakePrisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: {
    findFirst: vi.fn((_args: { where: MapWhere }) => Promise.resolve<{ id: string; name: string } | null>(null)),
    findUnique: vi.fn(() => Promise.resolve(null)),
  },
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
import { MAX_JOIN_TEXT_LENGTH } from './joinFields.js';
import type { WorldRoom, Player as PlayerCtor, RoomOptions } from '../WorldRoom.js';

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

/** A token-less human join (staged mode): no verified tenant on client.auth. */
async function join(options: RoomOptions): Promise<FakePlayer> {
  const { room, players } = makeRoom();
  const client = {
    sessionId: 'sid-1',
    send: vi.fn(),
    view: { add() {}, remove() {}, has: () => false },
    auth: { identity: 'user-1', isNpc: false, zonePrivacyVersion: 1 },
  } as unknown as CompletionClient;
  await completePendingJoin(room, client, options, 'user-1', FakePlayer as unknown as typeof PlayerCtor);
  const player = players.get('sid-1');
  if (!player) throw new Error('the join did not create a player');
  return player;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakePrisma.map.findFirst.mockImplementation(() => Promise.resolve(null));
});

describe('the direction of a joining player', () => {
  it.each(['up', 'down', 'left', 'right'])('keeps %s', async (direction) => {
    expect((await join({ direction })).direction).toBe(direction);
  });

  it('is down when the client names none', async () => {
    expect((await join({})).direction).toBe('down');
  });

  it('is down for a 900,000 character direction', async () => {
    expect((await join({ direction: HUGE })).direction).toBe('down');
  });

  it.each([['diagonal'], ['UP'], [' up'], [''], [7], [{ a: 1 }], [['up']]])(
    'is down for the invalid direction %j',
    async (direction) => {
      const options = { direction } as unknown as RoomOptions;
      expect((await join(options)).direction).toBe('down');
    },
  );
});

describe('the map name of a joining player', () => {
  it('is the name of the map row when the lookup by name succeeds', async () => {
    fakePrisma.map.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(where.name === 'Büro 2. Etage' ? { id: 'map-9', name: 'Büro 2. Etage' } : null),
    );

    const player = await join({ mapName: 'Büro 2. Etage' });

    expect(player.mapId).toBe('map-9');
    expect(player.mapName).toBe('Büro 2. Etage');
  });

  it('still finds a map whose name is longer than the display limit', async () => {
    const longName = 'm'.repeat(MAX_JOIN_TEXT_LENGTH + 50);
    fakePrisma.map.findFirst.mockImplementation(({ where }) =>
      Promise.resolve(where.name === longName ? { id: 'map-long', name: longName } : null),
    );

    const player = await join({ mapName: longName });

    expect(player.mapId).toBe('map-long');
    expect(player.mapName).toBe(longName);
  });

  it('is the requested name, unchanged, when the lookup fails and the name is short', async () => {
    fakePrisma.map.findFirst.mockRejectedValue(new Error('database unavailable'));

    expect((await join({ mapName: 'Büro' })).mapName).toBe('Büro');
  });

  it('is cut to the limit when the lookup fails and the client sent 900,000 characters', async () => {
    fakePrisma.map.findFirst.mockRejectedValue(new Error('database unavailable'));

    const player = await join({ mapName: HUGE });

    expect(player.mapName).toBe('x'.repeat(MAX_JOIN_TEXT_LENGTH));
  });

  it('is the default name when the lookup fails and the client sent no usable name', async () => {
    fakePrisma.map.findFirst.mockRejectedValue(new Error('database unavailable'));
    const options = { mapName: { a: 1 } } as unknown as RoomOptions;

    expect((await join(options)).mapName).toBe('office');
    expect((await join({})).mapName).toBe('office');
  });
});

describe('the placeholder map id of a join with no resolvable map', () => {
  it('names a short client tenant unchanged', async () => {
    expect((await join({ tenant: 'acme' })).mapId).toBe('__unresolved__:acme');
  });

  it('is bounded when the client names a 900,000 character tenant', async () => {
    const player = await join({ tenant: HUGE });

    expect(player.mapId).toBe(`__unresolved__:${'x'.repeat(MAX_JOIN_TEXT_LENGTH)}`);
  });

  it('is bounded when the lookup fails as well', async () => {
    fakePrisma.map.findFirst.mockRejectedValue(new Error('database unavailable'));

    const player = await join({ tenant: HUGE, mapName: HUGE });

    expect(player.mapId.length).toBeLessThan(MAX_JOIN_TEXT_LENGTH + 20);
    expect(player.mapName.length).toBeLessThanOrEqual(MAX_JOIN_TEXT_LENGTH);
  });
});
