/**
 * Unit tests for sessionHandlers.ts: takeOverExistingSessions (newest-wins).
 *
 * The helper removes every OTHER live session for an identity across all rooms
 * and MUST kick the old client with client.error(4007, 'session_taken_over')
 * (N4). The new session (newSid) is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

vi.mock('../utils/broadcastHelpers.js', () => ({
  broadcastToMap: vi.fn(),
}));

import { takeOverExistingSessions } from './sessionHandlers.js';
import { colyseusPlayers } from '../../metrics.js';
import { broadcastToMap } from '../utils/broadcastHelpers.js';
import type { WorldRoom } from '../WorldRoom.js';
import type { Client } from 'colyseus';

interface StatePlayer {
  identity: string;
  mapId?: string;
}

function makeRoom(players: Array<{ sid: string; identity: string; mapId?: string; client?: Client }>): WorldRoom {
  const map = new Map<string, StatePlayer>();
  const clients: Client[] = [];
  for (const p of players) {
    map.set(p.sid, { identity: p.identity, mapId: p.mapId });
    if (p.client) clients.push(p.client);
  }
  return {
    state: { players: map },
    lastSeen: new Map<string, number>(),
    pendingLeaves: new Map(),
    playerTenantKey: new Map<string, string>(),
    clients,
    broadcast: vi.fn(),
  } as unknown as WorldRoom;
}

function makeClient(sessionId: string): Client {
  return { sessionId, error: vi.fn(), leave: vi.fn() } as unknown as Client;
}

describe('takeOverExistingSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kicks the old client with 4007 and removes the old player, leaving newSid untouched', () => {
    const oldClient = makeClient('old-sid');
    const room = makeRoom([
      { sid: 'old-sid', identity: 'user-1', mapId: 'map-a', client: oldClient },
      { sid: 'new-sid', identity: 'user-1', mapId: 'map-a', client: makeClient('new-sid') },
    ]);
    const activeRooms = new Set<WorldRoom>([room]);

    takeOverExistingSessions(activeRooms, 'user-1', 'new-sid');

    // Old session removed, new session kept.
    expect(room.state.players.has('old-sid')).toBe(false);
    expect(room.state.players.has('new-sid')).toBe(true);
    // N4: terminal 4007 kick on the old client.
    expect(oldClient.error).toHaveBeenCalledWith(4007, 'session_taken_over');
    expect(oldClient.leave).toHaveBeenCalledWith(1000);
    // player_left broadcast on the old player's map.
    expect(broadcastToMap).toHaveBeenCalledWith(room, 'map-a', 'player_left', { id: 'old-sid' });
    expect(colyseusPlayers.dec).toHaveBeenCalledTimes(1);
  });

  it('does not kick or remove sessions of a DIFFERENT identity', () => {
    const otherClient = makeClient('other-sid');
    const room = makeRoom([
      { sid: 'other-sid', identity: 'user-2', mapId: 'map-a', client: otherClient },
      { sid: 'new-sid', identity: 'user-1', mapId: 'map-a', client: makeClient('new-sid') },
    ]);
    takeOverExistingSessions(new Set<WorldRoom>([room]), 'user-1', 'new-sid');

    expect(room.state.players.has('other-sid')).toBe(true);
    expect(otherClient.error).not.toHaveBeenCalled();
  });

  it('takes over old sessions of the identity across MULTIPLE rooms', () => {
    const oldA = makeClient('old-a');
    const oldB = makeClient('old-b');
    const roomA = makeRoom([
      { sid: 'old-a', identity: 'user-1', mapId: 'm1', client: oldA },
      { sid: 'new-sid', identity: 'user-1', mapId: 'm1', client: makeClient('new-sid') },
    ]);
    const roomB = makeRoom([{ sid: 'old-b', identity: 'user-1', mapId: 'm2', client: oldB }]);

    takeOverExistingSessions(new Set<WorldRoom>([roomA, roomB]), 'user-1', 'new-sid');

    expect(roomA.state.players.has('old-a')).toBe(false);
    expect(roomA.state.players.has('new-sid')).toBe(true);
    expect(roomB.state.players.has('old-b')).toBe(false);
    expect(oldA.error).toHaveBeenCalledWith(4007, 'session_taken_over');
    expect(oldB.error).toHaveBeenCalledWith(4007, 'session_taken_over');
  });

  it('is a no-op (no kicks) when only the new session exists', () => {
    const newClient = makeClient('new-sid');
    const room = makeRoom([{ sid: 'new-sid', identity: 'user-1', mapId: 'm1', client: newClient }]);
    takeOverExistingSessions(new Set<WorldRoom>([room]), 'user-1', 'new-sid');
    expect(room.state.players.has('new-sid')).toBe(true);
    expect(newClient.error).not.toHaveBeenCalled();
    expect(colyseusPlayers.dec).not.toHaveBeenCalled();
  });
});
