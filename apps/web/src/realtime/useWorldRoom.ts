import React from 'react';
import { logger } from '../lib/logger';
import type { UseWorldRoomArgs, ConnectionRefs } from './types';
import type { ApiPresence } from '../features/participants/presence';
import { useColyseusConnection } from './hooks/useColyseusConnection';
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

export function useWorldRoom(args: UseWorldRoomArgs) {
  const {
    apiBase,
    me,
    avRef,
    colyseusRef,
    localPosRef,
    colyseusToLivekitMap,
    identityToNameMap,
    gameBridge,
    buildParticipantList,
    setRoster,
  } = args;

  // Connection state refs
  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloseInfoRef = React.useRef<{ code?: number; reason?: string }>({});
  const connectingRef = React.useRef<boolean>(false);
  const coolDownUntilRef = React.useRef<number>(0);
  // true ab dem ersten 'full_state' der aktuellen Session; wird auf false zurueckgesetzt,
  // wenn die Verbindung verloren geht (siehe useColyseusConnection.handleLeave/handleError).
  // Dient als Lade-Gate gegen „Flash of Empty Roster" waehrend Reconnects.
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
    let disposed = false;
    try { if (args.disposedRef) args.disposedRef.current = false; } catch {}

    // Debounce-Timer/RAF-Handles im Effekt-Scope halten, damit Cleanup sie erreicht
    let buildListTimer: any = null;
    let buildListRaf: number | null = null;
    let rosterTimer: any = null;
    let rosterRaf: number | null = null;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    // Debounce: Teilnehmerliste/Roster nur 1x pro kurzem Intervall aktualisieren (rAF + Delay)
    const scheduleBuildParticipantList = (delay: number = 100) => {
      if (buildListTimer || buildListRaf !== null) return;
      buildListTimer = setTimeout(() => {
        buildListTimer = null;
        buildListRaf = requestAnimationFrame(() => {
          buildListRaf = null;
          try { buildParticipantList(); } catch {}
        });
      }, Math.max(0, delay));
    };

    const scheduleRefreshRosterFromRemotes = (delay: number = 0) => {
      if (rosterTimer || rosterRaf !== null) return;
      rosterTimer = setTimeout(() => {
        rosterTimer = null;
        rosterRaf = requestAnimationFrame(() => {
          rosterRaf = null;
          try { refreshRosterFromRemotes(); } catch {}
        });
      }, Math.max(0, delay));
    };

    // Präsenz (zuletzt online) – lokaler Cache im Effekt-Scope
    const recentPresenceRef = { current: [] as ApiPresence[] };

    // Create roster refresher
    const refreshRosterFromRemotes = createRosterRefresher(args);

    const setupRoomHandlers = (room: any) => {
      // Session conflict detection — registered first so the message is caught before any other setup.
      room.onMessage('session_conflict', () => {
        showSessionConflictDialog({ room, meId: me.id });
      });

      // Server restart notification — show overlay and auto-reload when server is back.
      room.onMessage('server_restart', () => {
        showServerRestartDialog({ apiBase, onRestartDetected: () => { disposed = true; } });
      });

      const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
      const colyseusSessionId = room.sessionId;
      colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
      // Ensure local user's display name is in identityToNameMap so UserCard shows name, not UUID
      identityToNameMap.current[localLivekitIdentity] = me.name || me.email || me.id;
      localPosRef.current.id = colyseusSessionId;
      if (typeof window !== 'undefined') { (window as any).__localSessionId = colyseusSessionId; }

      // Connect ZoneManager to Colyseus room for portal support
      try { args.zoneRef?.current?.setRoom?.(room); } catch (e) { logger.error('Failed to set room on ZoneManager', e); }

      // Force full map reload on join/reconnect to ensure consistency
      try { gameBridge.forceReloadMap?.(); } catch (e) { logger.error('Failed to force reload map on join', e); }

      // Vor neuem Session-Lauf evtl. hängende Handles räumen und zurücksetzen
      if (buildListTimer) { try { clearTimeout(buildListTimer); } catch {} buildListTimer = null; }
      if (buildListRaf !== null) { try { cancelAnimationFrame(buildListRaf); } catch {} buildListRaf = null; }
      if (rosterTimer) { try { clearTimeout(rosterTimer); } catch {} rosterTimer = null; }
      if (rosterRaf !== null) { try { cancelAnimationFrame(rosterRaf); } catch {} rosterRaf = null; }
      if (heartbeatInterval) { try { clearInterval(heartbeatInterval); } catch {} heartbeatInterval = null; }

      // Heartbeat: Server-side Ghost-Detection braucht periodische Lebenszeichen.
      // Idle-Clients ohne move würden sonst nach GHOST_THRESHOLD_MS (60s) als Ghost gekickt.
      heartbeatInterval = setInterval(() => {
        try {
          const activeRoom: any = colyseusRef.current;
          if (!activeRoom || activeRoom !== room) return;
          activeRoom.send?.('heartbeat');
        } catch {}
      }, HEARTBEAT_INTERVAL_MS);

      // Setup all message handlers
      setupPlayerHandlers(room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes, {
        onFullStateReceived: () => { hasReceivedFullStateRef.current = true; },
      });
      setupBubbleHandlers(room, args);
      setupEditorHandlers(room, args, scheduleBuildParticipantList);
      setupRemoteControlHandlers(room, args);
      setupPresenceHandlers(room, args, recentPresenceRef);
      setupZoneLockHandlers(room);

      forceInitialPlayerSync({ room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes });

      setupRosterOnStateChange(room, args, setRoster, me);

      // Setup error and leave handlers
      room.onError?.((...ev: any[]) => {
        handleError(ev, disposed, () => void attemptConnect());
      });

      room.onLeave?.((code?: number) => {
        handleLeave(code, disposed, () => void attemptConnect());
      });
    };

    const attemptConnect = async () => {
      const result = await connect(disposed, setupRoomHandlers);
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
      disposed = true;
      try { if (args.disposedRef) args.disposedRef.current = true; } catch {}
      try { args.setConnectionStatus?.({ reconnecting: false }); } catch {}
      try {
        const room: any = colyseusRef.current;
        const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
        const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
        if (isOpen) room.leave();
      } catch {}
      // Ausstehende Debounce-Timeouts/AnimationFrames sauber räumen
      try { if (buildListTimer) { clearTimeout(buildListTimer); buildListTimer = null; } } catch {}
      try { if (rosterTimer) { clearTimeout(rosterTimer); rosterTimer = null; } } catch {}
      try { if (buildListRaf !== null) { cancelAnimationFrame(buildListRaf); buildListRaf = null; } } catch {}
      try { if (rosterRaf !== null) { cancelAnimationFrame(rosterRaf); rosterRaf = null; } } catch {}
      try { if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; } } catch {}
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [apiBase, me?.id]);
}
