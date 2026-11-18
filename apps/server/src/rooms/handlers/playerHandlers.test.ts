import type { Client } from '@colyseus/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, type WorldRoom } from '../WorldRoom.js';
import { createZoneCatalog } from '../audioZones/zoneCatalog.js';
import { handleChangeMap } from './mapSwitchHandler.js';
import { createMoveHandler } from './playerHandlers.js';
import { createZoneLockState } from './zoneLockHandler.js';

function spawn(x: number, y: number): Player {
  return Object.assign(new Player(), { x, y, mapId: 'office', mapName: 'Office', direction: 'down' });
}

function setup() {
  const player = spawn(100, 100);
  const players = new Map([
    ['actor', player],
    ['peer', spawn(100, 100)],
  ]);
  const actor = { sessionId: 'actor', send: vi.fn() };
  const peer = { sessionId: 'peer', send: vi.fn() };
  const map = { widthTiles: 32, heightTiles: 32, tileWidthPx: 32, tileHeightPx: 32, defaultSpawn: null };
  const catalog = createZoneCatalog();
  catalog.zones.set('other', []);
  const room = {
    state: { players },
    clients: [actor, peer],
    lastSeen: new Map(),
    mapCache: new Map([
      ['office', map],
      ['other', { ...map, defaultSpawn: { x: 500, y: 100 } }],
    ]),
    zoneLockState: createZoneLockState(),
    bubbleGroups: {},
    audioZones: { catalog },
    prismaForPresence: {
      map: { findFirst: () => Promise.resolve({ id: 'other', name: 'Other', tenant: { slug: 'test' } }) },
      presence: { updateMany: () => Promise.resolve({ count: 1 }) },
    },
  } as unknown as WorldRoom;
  const handleMove = createMoveHandler(room);
  return {
    changeMap: () => handleChangeMap(room, actor as unknown as Client, { mapId: 'other' }),
    actor,
    peer,
    player,
    players,
    move: (x: number, y = 100) => handleMove(actor as unknown as Client, { x, y, direction: 'right' }),
  };
}

describe('move plausibility', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('keeps the accepted position on a jump and corrects only its sender', () => {
    const { move, actor, peer, player } = setup();
    move(105);
    peer.send.mockClear();
    vi.advanceTimersByTime(100);

    move(300);

    expect(player.x).toBe(105);
    expect(actor.send).toHaveBeenCalledWith('move_correction', { x: 105, y: 100, mapId: 'office' });
    expect(peer.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    move(121);
    expect(player.x).toBe(121);
  });

  it('accepts normal walking and publishes it to peers', () => {
    const { move, player, actor, peer } = setup();
    move(105);
    vi.advanceTimersByTime(100);
    move(113);

    expect(player.x).toBe(113);
    expect(actor.send).not.toHaveBeenCalled();
    expect(peer.send).toHaveBeenLastCalledWith('player_moved', expect.objectContaining({ x: 113 }));
  });

  it('accepts the missing distance after delayed and bunched movement updates', () => {
    const { move, player, actor } = setup();
    move(105);
    vi.advanceTimersByTime(1000);
    move(185);
    move(193);
    vi.advanceTimersByTime(80);
    move(204);

    expect(player.x).toBe(204);
    expect(actor.send).not.toHaveBeenCalled();
  });

  it('checks the first move against the spawn', () => {
    const { move, actor, player } = setup();
    move(400);

    expect(player.x).toBe(100);
    expect(actor.send).toHaveBeenCalledWith('move_correction', { x: 100, y: 100, mapId: 'office' });
  });

  it('starts at the confirmed map spawn without inheriting the old throttle', async () => {
    const { move, changeMap, actor, player } = setup();
    move(105);
    vi.advanceTimersByTime(20);

    await changeMap();
    move(504);

    expect(player).toMatchObject({ mapId: 'other', x: 504, y: 100 });
    expect(actor.send).not.toHaveBeenCalledWith('move_correction', expect.anything());
  });

  it('starts at the new player position after reconnect without inheriting the old throttle', () => {
    const { move, players, actor } = setup();
    move(105);
    vi.advanceTimersByTime(20);
    const rejoined = spawn(500, 100);
    players.set('actor', rejoined);

    move(504);

    expect(rejoined.x).toBe(504);
    expect(actor.send).not.toHaveBeenCalled();
  });
});
