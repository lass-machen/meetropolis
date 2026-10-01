/**
 * The presence_recent seed lists the name and e-mail address of every member of
 * the tenant to each joiner. A stored name can be older than the limit the
 * write routes apply, so the seed bounds what it sends whatever the database
 * holds: one member with a huge stored name must not make every join huge.
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
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: {
    findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', name: 'office' })),
    findUnique: vi.fn(() => Promise.resolve(null)),
  },
  membership: {
    findMany: vi.fn((): Promise<MemberRow[]> => Promise.resolve([])),
    findFirst: vi.fn(() => Promise.resolve(null)),
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
import { MAX_JOIN_TEXT_LENGTH } from './joinFields.js';
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

interface SeededMember {
  userId: string;
  user: { id?: string; email?: string | null; name?: string | null };
}

const HUGE = 'x'.repeat(900_000);

/** Joins as a verified member and returns the presence_recent list the client is sent. */
async function seededList(members: MemberRow[]): Promise<SeededMember[]> {
  fakePrisma.membership.findMany.mockResolvedValue(members);
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
  const client = {
    sessionId: 'sid-1',
    send,
    view: { add() {}, remove() {}, has: () => false },
    auth: { identity: 'user-1', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-1' },
  } as unknown as CompletionClient;

  await completePendingJoin(room, client, {}, 'user-1', FakePlayer as unknown as typeof PlayerCtor);
  await vi.advanceTimersByTimeAsync(500);

  const call = send.mock.calls.find(([type]) => type === 'presence_recent');
  if (!call) throw new Error('presence_recent was not sent');
  return call[1] as SeededMember[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('presence_recent seed', () => {
  it('cuts a stored name and e-mail address of 900,000 characters', async () => {
    const list = await seededList([
      { userId: 'u-huge', user: { id: 'u-huge', email: HUGE, name: HUGE } },
      { userId: 'u-ok', user: { id: 'u-ok', email: 'ok@example.test', name: 'Ok' } },
    ]);

    const huge = list.find((entry) => entry.userId === 'u-huge');
    expect(huge?.user.name).toBe('x'.repeat(MAX_JOIN_TEXT_LENGTH));
    expect(huge?.user.email).toBe('x'.repeat(MAX_JOIN_TEXT_LENGTH));
    expect(JSON.stringify(list).length).toBeLessThan(2_000);
  });

  it('leaves ordinary names, umlauts and addresses unchanged', async () => {
    const list = await seededList([
      { userId: 'u-1', user: { id: 'u-1', email: 'jörg@example.test', name: 'Jörg Müller-Lüdenscheidt' } },
    ]);

    expect(list[0]?.user).toEqual({ id: 'u-1', email: 'jörg@example.test', name: 'Jörg Müller-Lüdenscheidt' });
  });

  it('keeps a missing name null and a missing user empty, as before', async () => {
    const list = await seededList([
      { userId: 'u-noname', user: { id: 'u-noname', email: 'noname@example.test', name: null } },
      { userId: 'u-gone', user: null },
    ]);

    expect(list.find((entry) => entry.userId === 'u-noname')?.user.name).toBeNull();
    expect(list.find((entry) => entry.userId === 'u-gone')?.user).toEqual({
      id: undefined,
      email: undefined,
      name: undefined,
    });
  });
});
