/**
 * Unit tests for dndHandler.ts. The live DND toggle path (dnd_status
 * message) must update the in-memory Player.dnd and broadcast player_dnd
 * to the same-map peers; an unknown sessionId must warn and broadcast
 * nothing. This path is unchanged by the join-option resync work and is
 * covered here as a regression guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const broadcastToMapMock = vi.fn();
vi.mock('../utils/broadcastHelpers.js', () => ({
  broadcastToMap: (...args: unknown[]) => broadcastToMapMock(...args),
}));

import { handleDndStatus } from './dndHandler.js';
import { logger } from '../../logger.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';

interface FakePlayer {
  dnd: boolean;
  mapId: string;
}

function makeRoom(players: Map<string, FakePlayer>): WorldRoom {
  return {
    state: { players },
  } as unknown as WorldRoom;
}

beforeEach(() => {
  broadcastToMapMock.mockClear();
  vi.mocked(logger.warn).mockClear();
});

describe('handleDndStatus', () => {
  it('sets player.dnd and broadcasts player_dnd to same-map peers (except the sender)', () => {
    const player: FakePlayer = { dnd: false, mapId: 'map-1' };
    const players = new Map<string, FakePlayer>([['sid-1', player]]);
    const room = makeRoom(players);
    const client = { sessionId: 'sid-1' } as unknown as Client;

    handleDndStatus(room, client, { dnd: true });

    expect(player.dnd).toBe(true);
    expect(broadcastToMapMock).toHaveBeenCalledWith(room, 'map-1', 'player_dnd', { id: 'sid-1', dnd: true }, client);
  });

  it('propagates a false toggle (clearing DND) as well', () => {
    const player: FakePlayer = { dnd: true, mapId: 'map-2' };
    const players = new Map<string, FakePlayer>([['sid-2', player]]);
    const room = makeRoom(players);
    const client = { sessionId: 'sid-2' } as unknown as Client;

    handleDndStatus(room, client, { dnd: false });

    expect(player.dnd).toBe(false);
    expect(broadcastToMapMock).toHaveBeenCalledWith(room, 'map-2', 'player_dnd', { id: 'sid-2', dnd: false }, client);
  });

  it('warns and broadcasts nothing for an unknown sessionId', () => {
    const room = makeRoom(new Map());
    const client = { sessionId: 'ghost' } as unknown as Client;

    handleDndStatus(room, client, { dnd: true });

    expect(logger.warn).toHaveBeenCalled();
    expect(broadcastToMapMock).not.toHaveBeenCalled();
  });
});
