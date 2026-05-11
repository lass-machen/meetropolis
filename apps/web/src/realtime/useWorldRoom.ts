import React from 'react';
import { logger } from '../lib/logger';
import type { UseWorldRoomArgs, ConnectionRefs } from './types';
import type { ApiPresence } from '../features/participants/presence';
import type { WorldRoom } from '../types/colyseus';
import { useColyseusConnection, type ColyseusErrorPayload } from './hooks/useColyseusConnection';
import { setupPlayerHandlers } from './handlers/playerHandlers';
import { setupBubbleHandlers } from './handlers/bubbleHandlers';
import { setupEditorHandlers } from './handlers/editorHandlers';
import { setupRemoteControlHandlers } from './handlers/remoteControlHandlers';
import { setupPresenceHandlers, createRosterRefresher } from './handlers/presenceHandlers';
import { setupZoneLockHandlers } from './handlers/zoneLockHandlers';
import { showSessionConflictDialog, showServerRestartDialog } from './handlers/sessionDialogs';
import { forceInitialPlayerSync } from './handlers/initialSync';
import { setupRosterOnStateChange } from './handlers/rosterStateChange';
import { readTimeoutMs } from '../lib/runtimeConfig';

const HEARTBEAT_INTERVAL_MS = readTimeoutMs('VITE_HEARTBEAT_INTERVAL_MS', 15_000);

export type { UseWorldRoomArgs } from './types';

type EffectScope = {
  buildListTimer: ReturnType<typeof setTimeout> | null;
  buildListRaf: number | null;
  rosterTimer: ReturnType<typeof setTimeout> | null;
  rosterRaf: number | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  disposed: boolean;
};

function makeScheduleBuildParticipantList(scope: EffectScope, buildParticipantList: () => void) {
  return (delay: number = 100) => {
    if (scope.buildListTimer || scope.buildListRaf !== null) return;
    scope.buildListTimer = setTimeout(
      () => {
        scope.buildListTimer = null;
        scope.buildListRaf = requestAnimationFrame(() => {
          scope.buildListRaf = null;
          try {
            buildParticipantList();
          } catch {}
        });
      },
      Math.max(0, delay),
    );
  };
}

function makeScheduleRefreshRosterFromRemotes(scope: EffectScope, refreshRosterFromRemotes: () => void) {
  return (delay: number = 0) => {
    if (scope.rosterTimer || scope.rosterRaf !== null) return;
    scope.rosterTimer = setTimeout(
      () => {
        scope.rosterTimer = null;
        scope.rosterRaf = requestAnimationFrame(() => {
          scope.rosterRaf = null;
          try {
            refreshRosterFromRemotes();
          } catch {}
        });
      },
      Math.max(0, delay),
    );
  };
}

function clearEffectScope(scope: EffectScope): void {
  if (scope.buildListTimer) {
    try {
      clearTimeout(scope.buildListTimer);
    } catch {}
    scope.buildListTimer = null;
  }
  if (scope.buildListRaf !== null) {
    try {
      cancelAnimationFrame(scope.buildListRaf);
    } catch {}
    scope.buildListRaf = null;
  }
  if (scope.rosterTimer) {
    try {
      clearTimeout(scope.rosterTimer);
    } catch {}
    scope.rosterTimer = null;
  }
  if (scope.rosterRaf !== null) {
    try {
      cancelAnimationFrame(scope.rosterRaf);
    } catch {}
    scope.rosterRaf = null;
  }
  if (scope.heartbeatInterval) {
    try {
      clearInterval(scope.heartbeatInterval);
    } catch {}
    scope.heartbeatInterval = null;
  }
}

type SetupRoomHandlersArgs = {
  room: WorldRoom;
  scope: EffectScope;
  args: UseWorldRoomArgs;
  hasReceivedFullStateRef: React.MutableRefObject<boolean>;
  recentPresenceRef: { current: ApiPresence[] };
  scheduleBuildParticipantList: (delay?: number) => void;
  scheduleRefreshRosterFromRemotes: (delay?: number) => void;
  handleError: (ev: readonly ColyseusErrorPayload[], disposed: boolean, onReconnect: () => void) => void;
  handleLeave: (code: number | undefined, disposed: boolean, onReconnect?: () => void) => void;
  attemptConnect: () => Promise<void>;
};

function setupRoomHandlers(setup: SetupRoomHandlersArgs): void {
  const {
    room,
    scope,
    args,
    hasReceivedFullStateRef,
    recentPresenceRef,
    scheduleBuildParticipantList,
    scheduleRefreshRosterFromRemotes,
    handleError,
    handleLeave,
    attemptConnect,
  } = setup;
  const {
    apiBase,
    me,
    avRef,
    colyseusRef,
    localPosRef,
    colyseusToLivekitMap,
    identityToNameMap,
    gameBridge,
    setRoster,
  } = args;
  if (!me) return;

  // Session conflict detection: registered first so the message is caught before any other setup.
  room.onMessage('session_conflict', () => {
    showSessionConflictDialog({ room, meId: me.id });
  });

  // Server restart notification: show overlay and auto-reload when server is back.
  room.onMessage('server_restart', () => {
    showServerRestartDialog({
      apiBase,
      onRestartDetected: () => {
        scope.disposed = true;
      },
    });
  });

  const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
  const colyseusSessionId = room.sessionId;
  colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
  // Ensure local user's display name is in identityToNameMap so UserCard shows name, not UUID
  identityToNameMap.current[localLivekitIdentity] = me.name || me.email || me.id;
  localPosRef.current.id = colyseusSessionId;
  if (typeof window !== 'undefined') {
    window.__localSessionId = colyseusSessionId;
  }

  // Connect ZoneManager to Colyseus room for portal support
  try {
    args.zoneRef?.current?.setRoom?.(room);
  } catch (e) {
    logger.error('Failed to set room on ZoneManager', e);
  }

  // Force full map reload on join/reconnect to ensure consistency
  try {
    gameBridge.forceReloadMap?.();
  } catch (e) {
    logger.error('Failed to force reload map on join', e);
  }

  // Clear any stale handles before starting a new session run.
  clearEffectScope(scope);

  // Heartbeat: the server-side ghost detection needs periodic liveness signals.
  // Idle clients without movement would otherwise be kicked after
  // GHOST_THRESHOLD_MS (60s).
  scope.heartbeatInterval = setInterval(() => {
    try {
      const activeRoom = colyseusRef.current;
      if (!activeRoom || activeRoom !== room) return;
      activeRoom.send('heartbeat');
    } catch {}
  }, HEARTBEAT_INTERVAL_MS);

  // Setup all message handlers
  setupPlayerHandlers(room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, {
    onFullStateReceived: () => {
      hasReceivedFullStateRef.current = true;
    },
  });
  setupBubbleHandlers(room, args);
  setupEditorHandlers(room, args, scheduleBuildParticipantList);
  setupRemoteControlHandlers(room, args);
  setupPresenceHandlers(room, args, recentPresenceRef);
  setupZoneLockHandlers(room);

  forceInitialPlayerSync({ room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes });

  setupRosterOnStateChange(room, args, setRoster, me);

  // Setup error and leave handlers.
  // Colyseus invokes the callback as `(code: number, message?: string)`;
  // see node_modules/@colyseus/sdk/build/Room.d.ts. The payload is forwarded
  // as a positional tuple; `extractErrorInfo` decodes the `number | object`
  // first slot so the close-code reaches the billing/limit classifier below.
  room.onError?.((code: number, message?: string) => {
    const ev: ColyseusErrorPayload[] = message !== undefined ? [code, message] : [code];
    handleError(ev, scope.disposed, () => void attemptConnect());
  });

  room.onLeave?.((code?: number) => {
    handleLeave(code, scope.disposed, () => void attemptConnect());
  });
}

function performCleanup(
  scope: EffectScope,
  args: UseWorldRoomArgs,
  reconnectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
): void {
  scope.disposed = true;
  try {
    if (args.disposedRef) args.disposedRef.current = true;
  } catch {}
  try {
    args.setConnectionStatus?.({ reconnecting: false });
  } catch {}
  try {
    const room = args.colyseusRef.current;
    type ConnectionInternals = {
      ws?: WebSocket;
      transport?: { ws?: WebSocket };
      _transport?: { ws?: WebSocket };
      isOpen?: boolean;
    };
    const conn = room?.connection as unknown as ConnectionInternals | undefined;
    const wsReadyState = conn?.ws?.readyState ?? conn?.transport?.ws?.readyState ?? conn?._transport?.ws?.readyState;
    const isOpen = conn?.isOpen === true || wsReadyState === 1;
    if (isOpen && room) void room.leave();
  } catch {}
  clearEffectScope(scope);
  if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
}

export function useWorldRoom(args: UseWorldRoomArgs) {
  const { apiBase, me, buildParticipantList } = args;

  // Connection state refs
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloseInfoRef = React.useRef<{ code?: number; reason?: string }>({});
  const connectingRef = React.useRef<boolean>(false);
  const coolDownUntilRef = React.useRef<number>(0);
  // True from the first 'full_state' of the current session; reset to false
  // when the connection drops (see useColyseusConnection.handleLeave/handleError).
  // Serves as a loading gate to avoid the "flash of empty roster" during reconnects.
  const hasReceivedFullStateRef = React.useRef<boolean>(false);

  const connectionRefs: ConnectionRefs = {
    reconnectAttemptsRef,
    reconnectTimerRef,
    lastCloseInfoRef,
    connectingRef,
    coolDownUntilRef,
    hasReceivedFullStateRef,
  };

  // Use connection hook
  const { connect, handleError, handleLeave } = useColyseusConnection(args, connectionRefs);

  React.useEffect(() => {
    if (!me) return;
    const scope: EffectScope = {
      buildListTimer: null,
      buildListRaf: null,
      rosterTimer: null,
      rosterRaf: null,
      heartbeatInterval: null,
      disposed: false,
    };
    try {
      if (args.disposedRef) args.disposedRef.current = false;
    } catch {}

    // Presence (most recently online): local cache scoped to this effect.
    const recentPresenceRef = { current: [] as ApiPresence[] };
    const refreshRosterFromRemotes = createRosterRefresher(args);
    const scheduleBuildParticipantList = makeScheduleBuildParticipantList(scope, buildParticipantList);
    const scheduleRefreshRosterFromRemotes = makeScheduleRefreshRosterFromRemotes(scope, refreshRosterFromRemotes);

    const attemptConnect = async () => {
      const result = await connect(scope.disposed, (room: WorldRoom) => {
        setupRoomHandlers({
          room,
          scope,
          args,
          hasReceivedFullStateRef,
          recentPresenceRef,
          scheduleBuildParticipantList,
          scheduleRefreshRosterFromRemotes,
          handleError,
          handleLeave,
          attemptConnect,
        });
      });
      if (result && 'needsReconnect' in result && result.needsReconnect && result.delay !== undefined) {
        // Reconnect was already scheduled by connect()
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          void attemptConnect();
        }, result.delay);
      }
    };

    void attemptConnect();

    return () => {
      performCleanup(scope, args, reconnectTimerRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: apiBase + me?.id gate the Colyseus session correctly; capturing the full callback args or me object would trigger reconnect storms on every auth refresh and kill session isolation
  }, [apiBase, me?.id]);
}
