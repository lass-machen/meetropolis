/**
 * Skeptic follow-up (player_map_changed, MAJOR): the map-switch announcement was
 * a room-wide broadcast carrying name (= email when no display name) + identity
 * (userId) of the switching player. In a shared apex/'default' room every foreign
 * tenant received that PII. The fix routes it through two broadcastToMap calls
 * (old + new mapId — both tenant-unique), so only same-tenant peers on those maps
 * get it and cross-tenant peers (on a different mapId) never do. Uses the REAL
 * broadcastToMap so the recipient filtering is exercised end-to-end.
 *
 * Also covers the tenant-scoped map resolution (side-finding): the target map is
 * looked up by the verified auth.tenantId, not room.metadata.tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Where = { where?: { id?: string; tenantId?: string; tenant?: { slug?: string } } };
const mapFindFirst = vi.fn((args: Where) => {
  // Target map 'mapA-new' belongs to tenant A; resolvable by tenantId 'tid-a'.
  if (args?.where?.tenantId === 'tid-a' || args?.where?.tenant?.slug === 'tenant-a') {
    return Promise.resolve({ id: 'mapA-new', name: 'office-new', tenant: { slug: 'tenant-a' } });
  }
  return Promise.resolve(null);
});
const presenceUpdateMany = vi.fn(() => Promise.resolve({ count: 1 }));
const fakePrisma = { map: { findFirst: mapFindFirst }, presence: { updateMany: presenceUpdateMany } };
vi.mock('../../db.js', () => ({ createPrismaClient: () => fakePrisma }));

vi.mock('../utils/mapBoundsHelpers.js', () => ({
  ensureMapMeta: vi.fn(() =>
    Promise.resolve({
      widthTiles: 32,
      heightTiles: 32,
      tileWidthPx: 16,
      tileHeightPx: 16,
      defaultSpawn: { x: 5, y: 5 },
    }),
  ),
  sanitizePositionForMap: (_r: unknown, x: number, y: number) => ({ x, y }),
}));
vi.mock('../utils/bubbleHelpers.js', () => ({ broadcastBubbleState: vi.fn() }));
vi.mock('../audioZones/runtime.js', () => ({
  warmZoneCatalog: vi.fn(() => Promise.resolve()),
  trackMove: vi.fn(),
}));
// NOTE: broadcastHelpers (broadcastToMap) and onAuth (isWorldAuth) are REAL.

import { handleChangeMap } from './mapSwitchHandler.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';

type P = {
  mapId: string;
  mapName: string;
  x: number;
  y: number;
  name: string;
  identity: string;
  avatarId: string;
  dnd: boolean;
  isNpc: boolean;
};
function player(mapId: string, identity: string, name: string): P {
  return { mapId, mapName: mapId, x: 0, y: 0, name, identity, avatarId: 'av', dnd: false, isNpc: false };
}
function makeClient(sessionId: string, tenantId?: string): Client & { send: ReturnType<typeof vi.fn> } {
  return {
    sessionId,
    send: vi.fn(),
    auth: { identity: sessionId, isNpc: false, zonePrivacyVersion: 1, ...(tenantId ? { tenantId } : {}) },
  } as unknown as Client & { send: ReturnType<typeof vi.fn> };
}
function sentTypes(c: { send: ReturnType<typeof vi.fn> }): string[] {
  return c.send.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  mapFindFirst.mockClear();
  presenceUpdateMany.mockClear();
});

describe('handleChangeMap: player_map_changed is tenant-scoped via broadcastToMap', () => {
  it('reaches same-tenant peers on old+new map, never a cross-tenant peer', async () => {
    const players = new Map<string, P>();
    players.set('sid-switch', player('mapA-old', 'user-a', 'Alice A'));
    players.set('sid-old', player('mapA-old', 'user-a2', 'Anna A2'));
    players.set('sid-new', player('mapA-new', 'user-a3', 'Amir A3'));
    players.set('sid-foreign', player('mapB', 'user-b', 'secret@tenant-b.test'));

    const switchC = makeClient('sid-switch', 'tid-a');
    const oldC = makeClient('sid-old', 'tid-a');
    const newC = makeClient('sid-new', 'tid-a');
    const foreignC = makeClient('sid-foreign', 'tid-b');

    const room = {
      state: { players },
      clients: [switchC, oldC, newC, foreignC],
      prismaForPresence: fakePrisma,
      metadata: { tenant: 'default' }, // shared room slug
      bubbleGroups: {},
      mapCache: new Map(),
      playerTenantKey: new Map(),
    } as unknown as WorldRoom;

    await handleChangeMap(room, switchC, { mapId: 'mapA-new' });

    // Same-tenant peers on the old and new map get the switch.
    expect(sentTypes(oldC)).toContain('player_map_changed');
    expect(sentTypes(newC)).toContain('player_map_changed');
    // The cross-tenant peer (different mapId) never receives it → no PII leak.
    expect(sentTypes(foreignC)).not.toContain('player_map_changed');
    // The switcher gets its own confirmation, not the peer broadcast.
    expect(sentTypes(switchC)).toContain('map_changed');
    expect(sentTypes(switchC)).not.toContain('player_map_changed');

    // The payload the peers received carries the switcher's identity/name (which
    // is exactly why the foreign tenant must not receive it).
    const payload = oldC.send.mock.calls.find((c) => c[0] === 'player_map_changed')?.[1] as {
      identity: string;
      name: string;
    };
    expect(payload.identity).toBe('user-a');
    expect(payload.name).toBe('Alice A');
  });

  it('resolves the target map by the verified auth.tenantId, not room.metadata.tenant', async () => {
    const players = new Map<string, P>();
    players.set('sid-switch', player('mapA-old', 'user-a', 'Alice A'));
    const switchC = makeClient('sid-switch', 'tid-a');
    const room = {
      state: { players },
      clients: [switchC],
      prismaForPresence: fakePrisma,
      metadata: { tenant: 'default' },
      bubbleGroups: {},
      mapCache: new Map(),
      playerTenantKey: new Map(),
    } as unknown as WorldRoom;

    await handleChangeMap(room, switchC, { mapId: 'mapA-new' });

    // Looked up under the auth tenantId 'tid-a', never the room slug 'default'.
    expect(mapFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'mapA-new', tenantId: 'tid-a' }) }),
    );
    // Presence persisted scoped to the verified tenant.
    expect(presenceUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user-a', tenantId: 'tid-a' }) }),
    );
  });
});
