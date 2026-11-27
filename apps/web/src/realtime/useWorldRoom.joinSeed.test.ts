import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UseWorldRoomArgs } from './types';
import type { WorldRoom } from '../types/colyseus';

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

function track(name: string) {
  return () => {
    calls.push(name);
  };
}

vi.mock('./handlers/playerHandlers', () => ({ setupPlayerHandlers: track('setupPlayerHandlers') }));
vi.mock('./handlers/bubbleHandlers', () => ({ setupBubbleHandlers: track('setupBubbleHandlers') }));
vi.mock('./handlers/editorHandlers', () => ({ setupEditorHandlers: track('setupEditorHandlers') }));
vi.mock('./handlers/remoteControlHandlers', () => ({
  setupRemoteControlHandlers: track('setupRemoteControlHandlers'),
}));
vi.mock('./handlers/presenceHandlers', () => ({
  setupPresenceHandlers: track('setupPresenceHandlers'),
  createRosterRefresher: () => () => {},
}));
vi.mock('./handlers/zoneLockHandlers', () => ({ setupZoneLockHandlers: track('setupZoneLockHandlers') }));
vi.mock('./handlers/audioZonePermissionsHandler', () => ({
  setupAudioZonePermissionsHandler: track('setupAudioZonePermissionsHandler'),
}));
vi.mock('./handlers/sessionDialogs', () => ({
  showServerRestartDialog: track('showServerRestartDialog'),
}));
vi.mock('./handlers/initialSync', () => ({ forceInitialPlayerSync: track('forceInitialPlayerSync') }));
vi.mock('./handlers/rosterStateChange', () => ({
  setupRosterOnStateChange: track('setupRosterOnStateChange'),
}));

import { setupRoomHandlers } from './useWorldRoom';

function makeRef<T>(initial: T) {
  return { current: initial };
}

function makeFakeRoom(): WorldRoom {
  return {
    sessionId: 'session-local',
    send: (type: string) => {
      calls.push(`send:${type}`);
    },
    onMessage: vi.fn(),
    onError: vi.fn(),
    onLeave: vi.fn(),
  } as unknown as WorldRoom;
}

function makeArgs(room: WorldRoom): UseWorldRoomArgs {
  return {
    apiBase: '',
    me: { id: 'local-user', email: 'local@example.com', name: 'Local User' },
    avRef: makeRef(null),
    colyseusRef: makeRef(room),
    localPosRef: makeRef({ id: 'session-local', x: 0, y: 0 }),
    remotesRef: makeRef({}),
    colyseusToLivekitMap: makeRef({}),
    identityToNameMap: makeRef({}),
    gameBridge: { forceReloadMap: vi.fn() },
    editor: { zones: [] },
    setEditor: vi.fn(),
    zoneRef: makeRef(null),
    buildParticipantList: vi.fn(),
    applyVolumesToUi: vi.fn(),
    setBubbleUi: vi.fn(),
    bubbleMembersRef: makeRef(new Set()),
    bubbleGroupsRef: makeRef({}),
    dndRef: makeRef(false),
    setAvState: vi.fn(),
    rosterByIdentityRef: makeRef({}),
    setRoster: vi.fn(),
    disposedRef: makeRef(false),
  } as unknown as UseWorldRoomArgs;
}

describe('setupRoomHandlers join seed', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends join_seed_ready once after the one-shot handler setups', () => {
    const room = makeFakeRoom();
    const args = makeArgs(room);
    const scope = {
      buildListTimer: null as ReturnType<typeof setTimeout> | null,
      buildListRaf: null as number | null,
      rosterTimer: null as ReturnType<typeof setTimeout> | null,
      rosterRaf: null as number | null,
      heartbeatInterval: null as ReturnType<typeof setInterval> | null,
      disposed: false,
    };

    setupRoomHandlers({
      room,
      scope,
      args,
      connectionRefs: {
        reconnectAttemptsRef: makeRef(0),
        reconnectTimerRef: makeRef(null),
        lastCloseInfoRef: makeRef({}),
        connectingRef: makeRef(false),
        coolDownUntilRef: makeRef(0),
        hasReceivedFullStateRef: makeRef(false),
        terminalOverlayRef: makeRef(false),
      },
      recentPresenceRef: makeRef([]),
      scheduleBuildParticipantList: vi.fn(),
      scheduleRefreshRosterFromRemotes: vi.fn(),
      handleError: vi.fn(),
      handleLeave: vi.fn(),
      attemptConnect: vi.fn(async () => {}),
    });

    const readyIdx = calls.indexOf('send:join_seed_ready');
    expect(calls.filter((c) => c === 'send:join_seed_ready')).toHaveLength(1);
    expect(calls.indexOf('setupPlayerHandlers')).toBeLessThan(readyIdx);
    expect(calls.indexOf('setupBubbleHandlers')).toBeLessThan(readyIdx);
    expect(calls.indexOf('setupPresenceHandlers')).toBeLessThan(readyIdx);
  });
});
