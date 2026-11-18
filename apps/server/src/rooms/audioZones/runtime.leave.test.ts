import type { Client } from '@colyseus/core';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { WorldRoom } from '../WorldRoom.js';

vi.mock('../../transcriptionLoader.js', () => ({
  getTranscriptionModuleSync: () => null,
}));

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { trackLeave } from './runtime.js';
import { createPermissionOrchestrator } from './permissionOrchestrator.js';
import { createMembershipTracker, onMove } from './membershipTracker.js';

function fakeRoom() {
  return {
    state: { players: new Map<string, { identity: string }>() },
    clients: [] as Client[],
    audioZones: {
      tracker: createMembershipTracker(),
      orchestrator: createPermissionOrchestrator(),
    },
  };
}

type FakeRoom = ReturnType<typeof fakeRoom>;

function asWorldRoom(room: FakeRoom): WorldRoom {
  return room as unknown as WorldRoom;
}

function addMember(room: FakeRoom, identity: string, island: string) {
  const sessionId = `session-${identity}`;
  const send = vi.fn();
  const client = { sessionId, auth: undefined, send } as unknown as Client;
  room.state.players.set(sessionId, { identity });
  room.clients.push(client);
  onMove(room.audioZones.tracker, identity, island, 0);
  return send;
}

function lastAllow(send: ReturnType<typeof vi.fn>): string[] {
  const call = send.mock.calls[send.mock.calls.length - 1];
  if (!call) throw new Error('Expected an av_zone_permissions push');
  expect(call[0]).toBe('av_zone_permissions');
  return (call[1] as { allow: string[] }).allow;
}

describe('trackLeave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a leaving participant is removed from the lists of former island mates', async () => {
    const room = fakeRoom();
    const alice = addMember(room, 'alice', 'map-1:zone:kitchen');
    const bob = addMember(room, 'bob', 'map-1:zone:kitchen');
    const carol = addMember(room, 'carol', 'map-1:zone:kitchen');

    trackLeave(asWorldRoom(room), 'carol');
    await vi.advanceTimersByTimeAsync(100);

    expect(lastAllow(alice)).toEqual(['bob']);
    expect(lastAllow(bob)).toEqual(['alice']);
    expect(lastAllow(alice)).not.toContain('carol');
    expect(lastAllow(bob)).not.toContain('carol');
    expect(carol).not.toHaveBeenCalled();
  });
});
