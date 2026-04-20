import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setupPlayerHandlers } from './playerHandlers';
import { useMapStore } from '../../state/mapStore';
import type { UseWorldRoomArgs } from '../types';

interface MockMessageHandlers {
  [event: string]: (data: unknown) => void;
}
type StateChangeCb = (state: unknown) => void;

function makeMockRoom() {
  const handlers: MockMessageHandlers = {};
  const stateChangeCbs: StateChangeCb[] = [];
  return {
    onMessage: (event: string, cb: (data: unknown) => void) => {
      handlers[event] = cb;
    },
    onStateChange: (cb: StateChangeCb) => {
      stateChangeCbs.push(cb);
    },
    trigger: (event: string, data?: unknown) => {
      handlers[event]?.(data);
    },
    triggerStateChange: (state: unknown) => {
      for (const cb of stateChangeCbs) cb(state);
    },
    send: vi.fn(),
  };
}

function makeRef<T>(initial: T) {
  return { current: initial };
}

function makeArgs(overrides?: Partial<UseWorldRoomArgs>): UseWorldRoomArgs {
  return {
    apiBase: '',
    me: { id: 'local-user', email: 'local@example.com', name: 'Local User' },
    avRef: makeRef<unknown>(null),
    colyseusRef: makeRef<unknown>(null),
    localPosRef: makeRef<{ id: string; x?: number; y?: number }>({ id: 'session-local', x: 0, y: 0 }),
    remotesRef: makeRef<Record<string, { x: number; y: number; dnd?: boolean; avatarId?: string }>>({}),
    colyseusToLivekitMap: makeRef<Record<string, string>>({}),
    identityToNameMap: makeRef<Record<string, string>>({}),
    gameBridge: {
      syncRemotePlayers: vi.fn(),
      addRemotePlayer: vi.fn(),
      updateRemotePlayer: vi.fn(),
      removeRemotePlayer: vi.fn(),
      updateRemotePlayerDnd: vi.fn(),
    } as unknown as UseWorldRoomArgs['gameBridge'],
    editor: { zones: [] },
    setEditor: vi.fn(),
    zoneRef: makeRef<unknown>(null),
    buildParticipantList: vi.fn(),
    applyVolumesToUi: vi.fn(),
    setBubbleUi: vi.fn(),
    bubbleMembersRef: makeRef<Set<string>>(new Set()),
    bubbleGroupsRef: makeRef<Record<string, string>>({}),
    dndRef: makeRef<boolean>(false),
    setAvState: vi.fn(),
    rosterByIdentityRef: makeRef<Record<string, { name: string; x: number; y: number }>>({}),
    setRoster: vi.fn(),
    disposedRef: makeRef<boolean>(false),
    ...overrides,
  } as unknown as UseWorldRoomArgs;
}

describe('setupPlayerHandlers', () => {
  beforeEach(() => {
    // Deterministic map name so filtering doesn't skip players
    useMapStore.getState().setCurrentMap('map-1', 'office');
  });

  it('onStateChange populates remotesRef with all non-self players on current map', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    const scheduleBuildParticipantList = vi.fn();
    const scheduleRefreshRosterFromRemotes = vi.fn();
    setupPlayerHandlers(room as unknown as Parameters<typeof setupPlayerHandlers>[0], args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes);

    room.triggerStateChange({
      players: new Map<string, {
        x: number;
        y: number;
        direction: string;
        identity: string;
        name: string;
        mapName: string;
      }>([
        ['session-local', { x: 1, y: 1, direction: 'down', identity: 'local-user', name: 'Local User', mapName: 'office' }],
        ['session-a', { x: 10, y: 20, direction: 'down', identity: 'user-a', name: 'Alice', mapName: 'office' }],
        ['session-b', { x: 30, y: 40, direction: 'down', identity: 'user-b', name: 'Bob', mapName: 'office' }],
      ]),
    });

    // Exactly 2 remote entries (self excluded)
    expect(Object.keys(args.remotesRef.current)).toHaveLength(2);
    expect(args.remotesRef.current['session-a']).toEqual({ x: 10, y: 20, dnd: undefined, avatarId: undefined });
    expect(args.remotesRef.current['session-b']).toEqual({ x: 30, y: 40, dnd: undefined, avatarId: undefined });
    expect(args.remotesRef.current['session-local']).toBeUndefined();

    // Identity maps updated for all players (including self and remotes)
    expect(args.colyseusToLivekitMap.current['session-a']).toBe('user-a');
    expect(args.colyseusToLivekitMap.current['session-b']).toBe('user-b');
    expect(args.identityToNameMap.current['user-a']).toBe('Alice');
    expect(args.identityToNameMap.current['user-b']).toBe('Bob');
  });

  it('onStateChange shrinks remotesRef to reflect players that leave (no double-mutation artifacts)', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    setupPlayerHandlers(room as unknown as Parameters<typeof setupPlayerHandlers>[0], args, vi.fn(), vi.fn());

    // First state: 3 players (self + 2 remotes)
    room.triggerStateChange({
      players: new Map<string, {
        x: number;
        y: number;
        direction: string;
        identity: string;
        name: string;
        mapName: string;
      }>([
        ['session-local', { x: 1, y: 1, direction: 'down', identity: 'local-user', name: 'Local User', mapName: 'office' }],
        ['session-a', { x: 10, y: 20, direction: 'down', identity: 'user-a', name: 'Alice', mapName: 'office' }],
        ['session-b', { x: 30, y: 40, direction: 'down', identity: 'user-b', name: 'Bob', mapName: 'office' }],
      ]),
    });
    expect(Object.keys(args.remotesRef.current)).toHaveLength(2);

    // Second state: session-a left, only self + session-b remain
    room.triggerStateChange({
      players: new Map<string, {
        x: number;
        y: number;
        direction: string;
        identity: string;
        name: string;
        mapName: string;
      }>([
        ['session-local', { x: 1, y: 1, direction: 'down', identity: 'local-user', name: 'Local User', mapName: 'office' }],
        ['session-b', { x: 31, y: 41, direction: 'down', identity: 'user-b', name: 'Bob', mapName: 'office' }],
      ]),
    });

    expect(Object.keys(args.remotesRef.current)).toHaveLength(1);
    expect(args.remotesRef.current['session-a']).toBeUndefined();
    expect(args.remotesRef.current['session-b']).toEqual({ x: 31, y: 41, dnd: undefined, avatarId: undefined });
  });

  it('player_left is idempotent: double-firing does not crash and has no side-effects on empty ref', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    const scheduleBuild = vi.fn();
    const scheduleRoster = vi.fn();
    setupPlayerHandlers(room as unknown as Parameters<typeof setupPlayerHandlers>[0], args, scheduleBuild, scheduleRoster);

    // Pre-populate one remote, then fire player_left twice
    args.remotesRef.current['session-a'] = { x: 10, y: 20 };
    args.colyseusToLivekitMap.current['session-a'] = 'user-a';

    room.trigger('player_left', { id: 'session-a' });
    expect(args.remotesRef.current['session-a']).toBeUndefined();
    expect(scheduleBuild).toHaveBeenCalledTimes(1);

    scheduleBuild.mockClear();
    scheduleRoster.mockClear();

    // Second fire: already removed, should noop
    room.trigger('player_left', { id: 'session-a' });
    expect(scheduleBuild).not.toHaveBeenCalled();
    expect(scheduleRoster).not.toHaveBeenCalled();
  });

  it('onFullStateReceived callback fires on first full_state', () => {
    const room = makeMockRoom();
    const args = makeArgs();
    const onFullStateReceived = vi.fn();
    setupPlayerHandlers(room as unknown as Parameters<typeof setupPlayerHandlers>[0], args, vi.fn(), vi.fn(), { onFullStateReceived });

    room.trigger('full_state', { players: [] });
    expect(onFullStateReceived).toHaveBeenCalledTimes(1);
  });
});
