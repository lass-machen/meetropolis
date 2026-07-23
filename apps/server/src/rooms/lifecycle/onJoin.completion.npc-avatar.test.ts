/**
 * Tenant-boundary regression: an NPC must never enter the room state wearing a
 * custom avatar.
 *
 * NPC players are the ONE class of player that the per-client tenant StateView
 * deliberately exempts (tenantView.ts `isPlayerVisibleToTenant` returns true for
 * NPCs unconditionally), and on the apex domain several tenants share one
 * WorldRoom instance. A `custom:<uuid>` id on an NPC would therefore be synced
 * and broadcast to clients of FOREIGN tenants, and the uuid is the whole
 * protection of the sprite bytes: `/packs/avatars/custom/<uuid>.png` is served
 * without any session (see services/avatarComposer.ts `customSpriteUrl`).
 *
 * api/routes/npcs.ts refuses to persist such an id, but the NPC service reads
 * `Npc.avatarId` straight from the DB and passes it as a join option, so rows
 * written before that check existed still arrive here. This path is the last
 * gate and has to hold on its own.
 *
 * DB collaborators are mocked; the test asserts on the resulting Player and on
 * the player_joined payload, which is the actual leak vector.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

type FindArgs = { where?: { id?: string; name?: string; slug?: string } };
const fakePrisma = {
  tenant: {
    findUnique: vi.fn((args: FindArgs) => Promise.resolve(args?.where?.id ? { defaultMapName: 'office' } : null)),
  },
  map: {
    findFirst: vi.fn(() => Promise.resolve({ id: 'map-1', name: 'office' })),
  },
  // Present but never consulted on this path: the join does NOT re-validate the
  // avatar against the DB, which is precisely why the prefix guard has to be
  // structural rather than a lookup.
  user: { findUnique: vi.fn(() => Promise.resolve(null)) },
};
vi.mock('../../db.js', () => ({ createPrismaClient: () => fakePrisma }));

const broadcastToMapMock = vi.fn();
vi.mock('../utils/broadcastHelpers.js', () => ({
  broadcastToMap: (...args: unknown[]) => broadcastToMapMock(...args),
}));

vi.mock('../utils/mapBoundsHelpers.js', () => ({
  sanitizePosition: (_room: unknown, x: number, y: number) => ({ x, y }),
  sanitizePositionForMap: (_room: unknown, x: number, y: number) => ({ x, y }),
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

/** No-op StateView double, see onJoin.completion.dnd.test.ts. */
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

// The uuid of a custom avatar composed inside tenant A. Whoever learns it can
// GET the PNG with no session at all.
const LEAKED_ID = 'custom:90579cc0-b608-4dc0-a4e4-cb8e4495fe70';
const DEFAULT_ID = 'default-characters:business_man';

function baseOptions(extra: Partial<RoomOptions>): RoomOptions {
  return { mapId: 'map-1', mapName: 'office', name: 'Bob', ...extra };
}

function npcClient(sessionId: string): Client {
  return {
    sessionId,
    send: vi.fn(),
    view: fakeView(),
    // How onAuth marks an NPC join: secret-gated, no verified tenant.
    auth: { identity: 'npc-bob', isNpc: true, zonePrivacyVersion: 1 },
  } as unknown as Client;
}

beforeEach(() => {
  broadcastToMapMock.mockClear();
  fakePrisma.tenant.findUnique.mockClear();
  fakePrisma.map.findFirst.mockClear();
});

describe('completePendingJoin: NPCs never carry a custom avatar', () => {
  it('drops a custom avatarId from an NPC join and falls back to the default', async () => {
    const { room, players } = makeRoom();
    const client = npcClient('sid-npc');

    await completePendingJoin(room, client, baseOptions({ avatarId: LEAKED_ID }), 'npc-bob', fakePlayerClass);

    const player = players.get('sid-npc');
    expect(player?.isNpc).toBe(true);
    expect(player?.avatarId).toBe(DEFAULT_ID);
    // And the uuid never reaches the wire, where every tenant in the shared room
    // would receive it.
    expect(broadcastToMapMock).toHaveBeenCalledWith(
      room,
      'map-1',
      'player_joined',
      expect.objectContaining({ id: 'sid-npc', isNpc: true, avatarId: DEFAULT_ID }),
      client,
    );
    const payloads = broadcastToMapMock.mock.calls.map((c) => JSON.stringify(c[3]));
    for (const payload of payloads) expect(payload).not.toContain('90579cc0');
  });

  it('leaves a pack/default avatarId on an NPC join untouched', async () => {
    const { room, players } = makeRoom();
    const client = npcClient('sid-npc-2');

    await completePendingJoin(room, client, baseOptions({ avatarId: 'shared-pack:hero' }), 'npc-bob', fakePlayerClass);

    expect(players.get('sid-npc-2')?.avatarId).toBe('shared-pack:hero');
  });

  it('does NOT touch a human player wearing a custom avatar', async () => {
    const { room, players } = makeRoom();
    const client = {
      sessionId: 'sid-human',
      send: vi.fn(),
      view: fakeView(),
      auth: { identity: 'user-a', isNpc: false, zonePrivacyVersion: 1, tenantId: 'tenant-a' },
    } as unknown as Client;

    // A real member of the owning tenant: the id was validated where it was put
    // on (api/routes/meAvatar.ts, handlers/avatarHandler.ts) and the player is
    // only ever synced to same-tenant clients, so the guard must not fire here.
    await completePendingJoin(room, client, baseOptions({ avatarId: LEAKED_ID }), 'user-a', fakePlayerClass);

    const player = players.get('sid-human');
    expect(player?.isNpc).toBe(false);
    expect(player?.avatarId).toBe(LEAKED_ID);
  });
});
