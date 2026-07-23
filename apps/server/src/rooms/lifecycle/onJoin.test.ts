/**
 * Unit tests for onJoin.ts.
 *
 * Covers:
 * - H4 identity binding: the joining identity comes from client.auth (set by
 *   onAuth), never from client-supplied options.identity.
 * - Gate order (E3.3): identity first, NPCs skip every limiter.
 * - Newest-wins (E3.4): a live existing session is taken over automatically —
 *   the new client's join is completed first, then the old session is kicked.
 *
 * completePendingJoin, enforceOssLimit, enforceTenantLimits, findExistingSession
 * and takeOverExistingSessions are mocked so this exercises only performOnJoin's
 * own decision logic and ordering.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../metrics.js', () => ({
  colyseusPlayers: { inc: vi.fn(), dec: vi.fn() },
}));

vi.mock('./onJoin.limiter.js', () => ({
  enforceOssLimit: vi.fn(() => Promise.resolve(false)),
  enforceTenantLimits: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('./ghostDetection.js', () => ({
  findExistingSession: vi.fn(() => null),
}));

vi.mock('../handlers/sessionHandlers.js', () => ({
  takeOverExistingSessions: vi.fn(),
}));

const completePendingJoinMock = vi.fn(() => Promise.resolve());
vi.mock('./onJoin.completion.js', () => ({
  completePendingJoin: (...args: unknown[]) => completePendingJoinMock(...args),
}));

import { performOnJoin } from './onJoin.js';
import { enforceOssLimit, enforceTenantLimits } from './onJoin.limiter.js';
import { findExistingSession } from './ghostDetection.js';
import { takeOverExistingSessions } from '../handlers/sessionHandlers.js';
import type { WorldRoom, RoomOptions, Player as PlayerCtor } from '../WorldRoom.js';
import type { Client } from 'colyseus';

const mockEnforceOssLimit = vi.mocked(enforceOssLimit);
const mockEnforceTenantLimits = vi.mocked(enforceTenantLimits);
const mockFindExistingSession = vi.mocked(findExistingSession);
const mockTakeOverExistingSessions = vi.mocked(takeOverExistingSessions);

function makeRoom(): WorldRoom {
  return {
    pendingLeaves: new Map(),
    lastSeen: new Map(),
    state: { players: new Map() },
    ghostThresholdMs: 60_000,
  } as unknown as WorldRoom;
}

const fakePlayerClass = class {} as unknown as typeof PlayerCtor;

beforeEach(() => {
  vi.clearAllMocks();
  mockEnforceOssLimit.mockResolvedValue(false);
  mockEnforceTenantLimits.mockResolvedValue(false);
  mockFindExistingSession.mockReturnValue(null);
});

describe('performOnJoin: identity binding + gate order', () => {
  it('completes the join using client.auth.identity, ignoring a spoofed options.identity', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 's1',
      auth: { identity: 'user-real', isNpc: false, zonePrivacyVersion: 1 },
    } as unknown as Client;
    const options: RoomOptions = { identity: 'user-victim' };

    await performOnJoin(room, activeRooms, client, options, fakePlayerClass);

    expect(completePendingJoinMock).toHaveBeenCalledWith(room, client, options, 'user-real', fakePlayerClass);
    // No existing session -> no takeover.
    expect(mockTakeOverExistingSessions).not.toHaveBeenCalled();
  });

  it('NPCs skip every limiter and the takeover path, going straight to completion', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 's-npc',
      auth: { identity: 'npc-bob', isNpc: true, zonePrivacyVersion: 1 },
    } as unknown as Client;
    const options: RoomOptions = { identity: 'npc-bob' };

    await performOnJoin(room, activeRooms, client, options, fakePlayerClass);

    expect(mockEnforceOssLimit).not.toHaveBeenCalled();
    expect(mockEnforceTenantLimits).not.toHaveBeenCalled();
    expect(mockFindExistingSession).not.toHaveBeenCalled();
    expect(mockTakeOverExistingSessions).not.toHaveBeenCalled();
    expect(completePendingJoinMock).toHaveBeenCalledWith(room, client, options, 'npc-bob', fakePlayerClass);
  });

  it('passes the resolved identity to enforceTenantLimits (seat-cap self-exempt)', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 's1',
      auth: { identity: 'user-real', isNpc: false, zonePrivacyVersion: 1 },
    } as unknown as Client;

    await performOnJoin(room, activeRooms, client, {}, fakePlayerClass);

    expect(mockEnforceTenantLimits).toHaveBeenCalledWith(room, activeRooms, {}, client, 'user-real');
  });

  it('aborts before completion when a limiter rejects the join', async () => {
    mockEnforceTenantLimits.mockResolvedValue(true);
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 's1',
      auth: { identity: 'user-real', isNpc: false, zonePrivacyVersion: 1 },
    } as unknown as Client;

    await performOnJoin(room, activeRooms, client, {}, fakePlayerClass);

    expect(completePendingJoinMock).not.toHaveBeenCalled();
  });

  it('fails closed when client.auth is missing (onAuth did not run for this client)', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = { sessionId: 's2' } as unknown as Client;
    const options: RoomOptions = { identity: 'user-x' };

    await expect(performOnJoin(room, activeRooms, client, options, fakePlayerClass)).rejects.toThrow();
    expect(completePendingJoinMock).not.toHaveBeenCalled();
  });
});

describe('performOnJoin: newest-wins takeover (E3.4)', () => {
  it('completes the new join first, then takes over the live existing session', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 'new-sid',
      auth: { identity: 'user-real', isNpc: false, zonePrivacyVersion: 1 },
    } as unknown as Client;
    // A live existing session is found.
    mockFindExistingSession.mockReturnValue({
      room,
      sessionId: 'old-sid',
      client: { sessionId: 'old-sid' } as unknown as Client,
    });
    // completePendingJoin actually materializes the new player in room state.
    completePendingJoinMock.mockImplementation(() => {
      room.state.players.set('new-sid', { identity: 'user-real' });
      return Promise.resolve();
    });

    await performOnJoin(room, activeRooms, client, {}, fakePlayerClass);

    expect(completePendingJoinMock).toHaveBeenCalledWith(room, client, {}, 'user-real', fakePlayerClass);
    expect(mockTakeOverExistingSessions).toHaveBeenCalledWith(activeRooms, 'user-real', 'new-sid');
  });

  it('does NOT take over when the new join failed to materialize (e.g. expired guest)', async () => {
    const room = makeRoom();
    const activeRooms = new Set<WorldRoom>([room]);
    const client = {
      sessionId: 'new-sid',
      auth: { identity: 'user-real', isNpc: false, zonePrivacyVersion: 1 },
    } as unknown as Client;
    mockFindExistingSession.mockReturnValue({
      room,
      sessionId: 'old-sid',
      client: { sessionId: 'old-sid' } as unknown as Client,
    });
    // completePendingJoin aborts early: no player added to state.
    completePendingJoinMock.mockImplementation(() => Promise.resolve());

    await performOnJoin(room, activeRooms, client, {}, fakePlayerClass);

    expect(mockTakeOverExistingSessions).not.toHaveBeenCalled();
  });
});
