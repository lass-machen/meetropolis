/**
 * Where the display name in the room state comes from, and how long it may be.
 *
 * The name of a player is synchronised to every peer, so a 900 KB `options.name`
 * (or a 900 KB name stored on the account) must not reach the state. A real
 * account is the authority on its own name; the client-supplied name only
 * counts for joins the server knows no account for, and for NPCs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../../logger.js', () => ({ logger: log }));
vi.mock('../../metrics.js', () => ({ colyseusPlayers: { inc: vi.fn(), dec: vi.fn() } }));

const fakePrisma = {
  tenant: { findUnique: vi.fn(() => Promise.resolve({ defaultMapName: 'office' })) },
  map: {
    findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', name: 'office' })),
    findUnique: vi.fn(() => Promise.resolve({ tenantId: 'tenant-1' })),
  },
  membership: { findMany: vi.fn(() => Promise.resolve([])), findFirst: vi.fn(() => Promise.resolve(null)) },
  presence: { findMany: vi.fn(() => Promise.resolve([])) },
  user: { findUnique: vi.fn() },
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

interface AccountRow {
  name: string | null;
  email: string;
  avatarId: string | null;
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

function clientWith(auth: Record<string, unknown>): CompletionClient {
  return {
    sessionId: 'sid-1',
    send: vi.fn(),
    view: { add() {}, remove() {}, has: () => false },
    auth,
  } as unknown as CompletionClient;
}

/** A join of a verified account (the identity and tenant come from the token). */
async function joinAsAccount(options: RoomOptions, account: AccountRow | null, identity = 'user-1'): Promise<string> {
  fakePrisma.user.findUnique.mockResolvedValue(account);
  const { room, players } = makeRoom();
  const client = clientWith({ identity, isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-1' });
  await completePendingJoin(room, client, options, identity, FakePlayer as unknown as typeof PlayerCtor);
  return players.get('sid-1')?.name ?? '';
}

/** A join without a verified account: a token-less join (staged mode) or an NPC. */
async function joinWithoutAccount(options: RoomOptions, identity: string, isNpc = false): Promise<string> {
  fakePrisma.user.findUnique.mockResolvedValue(null);
  const { room, players } = makeRoom();
  const client = clientWith({ identity, isNpc, zonePrivacyVersion: 1 });
  await completePendingJoin(room, client, options, identity, FakePlayer as unknown as typeof PlayerCtor);
  return players.get('sid-1')?.name ?? '';
}

const alice: AccountRow = { name: 'Alice', email: 'alice@example.test', avatarId: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the display name of a verified account', () => {
  it('is the account name when the client sends a 900,000 character name', async () => {
    expect(await joinAsAccount({ name: HUGE }, alice)).toBe('Alice');
  });

  it('is the account name even when the client sends a different short name', async () => {
    expect(await joinAsAccount({ name: 'Mallory' }, alice)).toBe('Alice');
  });

  it('is the account name when the client sends the name its own client sends', async () => {
    expect(await joinAsAccount({ name: 'Alice' }, alice)).toBe('Alice');
  });

  it('is the account name when the client sends no name at all (the mobile bridge)', async () => {
    expect(await joinAsAccount({}, alice)).toBe('Alice');
  });

  it('is the e-mail address when the account has no name', async () => {
    expect(await joinAsAccount({ name: 'alice@example.test' }, { ...alice, name: null })).toBe('alice@example.test');
  });

  it('keeps an account name with umlauts and a sharp s unchanged', async () => {
    const name = 'Jörg Müller-Lüdenscheidt, Straße ß';
    expect(await joinAsAccount({ name }, { ...alice, name })).toBe(name);
  });

  it('is cut to the limit when the account itself holds a 900,000 character name', async () => {
    // PATCH /me puts no upper bound on the name, so the account can hold one.
    const name = await joinAsAccount({}, { ...alice, name: HUGE });
    expect(name).toHaveLength(MAX_JOIN_TEXT_LENGTH);
  });

  it('is the identity, not the client name, when the account lookup fails', async () => {
    fakePrisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));
    const { room, players } = makeRoom();
    const client = clientWith({ identity: 'user-1', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-1' });

    await completePendingJoin(room, client, { name: HUGE }, 'user-1', FakePlayer as unknown as typeof PlayerCtor);

    expect(players.get('sid-1')?.name).toBe('user-1');
  });

  it('is the identity when the account lookup fails and the client names a short name of its own', async () => {
    fakePrisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));
    const { room, players } = makeRoom();
    const client = clientWith({ identity: 'user-1', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-1' });

    await completePendingJoin(room, client, { name: 'Mallory' }, 'user-1', FakePlayer as unknown as typeof PlayerCtor);

    expect(players.get('sid-1')?.name).toBe('user-1');
  });
});

describe('the display name of a join the server knows no account for', () => {
  it('is the client name', async () => {
    expect(await joinWithoutAccount({ name: 'Bot 7' }, 'bot-7')).toBe('Bot 7');
  });

  it('keeps a client name with umlauts unchanged', async () => {
    expect(await joinWithoutAccount({ name: 'Jörg Müller' }, 'bot-7')).toBe('Jörg Müller');
  });

  it('is cut to the limit when the client sends 900,000 characters', async () => {
    const name = await joinWithoutAccount({ name: HUGE }, 'bot-7');
    expect(name).toHaveLength(MAX_JOIN_TEXT_LENGTH);
  });

  it('is the identity when the client sends no name', async () => {
    expect(await joinWithoutAccount({}, 'bot-7')).toBe('bot-7');
  });

  it('is still the client name, cut to the limit, when the lookup fails and there is no verified tenant', async () => {
    fakePrisma.user.findUnique.mockRejectedValue(new Error('database unavailable'));
    const { room, players } = makeRoom();
    const client = clientWith({ identity: 'bot-7', isNpc: false, zonePrivacyVersion: 1 });

    await completePendingJoin(room, client, { name: HUGE }, 'bot-7', FakePlayer as unknown as typeof PlayerCtor);

    expect(players.get('sid-1')?.name).toBe('x'.repeat(MAX_JOIN_TEXT_LENGTH));
  });

  it.each([[7], [{ a: 1 }], [['a']], [true]])('is the identity when the client sends %j as the name', async (name) => {
    const options = { name } as unknown as RoomOptions;
    expect(await joinWithoutAccount(options, 'bot-7')).toBe('bot-7');
  });
});

describe('the display name of an NPC', () => {
  it('is the name the npc-service sends', async () => {
    expect(await joinWithoutAccount({ name: 'Greeter' }, 'npc-greeter', true)).toBe('Greeter');
  });

  it('keeps the longest name the NPC API accepts unchanged', async () => {
    const name = 'n'.repeat(200);
    expect(await joinWithoutAccount({ name }, 'npc-greeter', true)).toBe(name);
  });

  it('is cut to the limit when 900,000 characters arrive', async () => {
    const name = await joinWithoutAccount({ name: HUGE }, 'npc-greeter', true);
    expect(name).toHaveLength(MAX_JOIN_TEXT_LENGTH);
  });

  it('is the identity when no name arrives', async () => {
    expect(await joinWithoutAccount({}, 'npc-greeter', true)).toBe('npc-greeter');
  });
});
