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

  const connectionRefs: ConnectionRefs = {
    reconnectAttemptsRef,
    reconnectTimerRef,
    lastCloseInfoRef,
    connectingRef,
    coolDownUntilRef,
  };

  // Use connection hook
  const { connect, scheduleReconnect, handleError, handleLeave } = useColyseusConnection(args, connectionRefs);

  React.useEffect(() => {
    if (!me) return;
    let disposed = false;
    try { if (args.disposedRef) args.disposedRef.current = false; } catch {}

    // Debounce-Timer/RAF-Handles im Effekt-Scope halten, damit Cleanup sie erreicht
    let buildListTimer: any = null;
    let buildListRaf: number | null = null;
    let rosterTimer: any = null;
    let rosterRaf: number | null = null;

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
      const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
      const colyseusSessionId = room.sessionId;
      colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
      localPosRef.current.id = colyseusSessionId;
      if (typeof window !== 'undefined') { (window as any).__localSessionId = colyseusSessionId; }

      // Force full map reload on join/reconnect to ensure consistency
      try { gameBridge.forceReloadMap?.(); } catch (e) { logger.error('Failed to force reload map on join', e); }

      // Vor neuem Session-Lauf evtl. hängende Handles räumen und zurücksetzen
      if (buildListTimer) { try { clearTimeout(buildListTimer); } catch {} buildListTimer = null; }
      if (buildListRaf !== null) { try { cancelAnimationFrame(buildListRaf); } catch {} buildListRaf = null; }
      if (rosterTimer) { try { clearTimeout(rosterTimer); } catch {} rosterTimer = null; }
      if (rosterRaf !== null) { try { cancelAnimationFrame(rosterRaf); } catch {} rosterRaf = null; }

      // Setup all message handlers
      setupPlayerHandlers(room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes);
      setupBubbleHandlers(room, args);
      setupEditorHandlers(room, args, scheduleBuildParticipantList);
      setupRemoteControlHandlers(room, args);
      setupPresenceHandlers(room, args, recentPresenceRef);

      // Add roster update as additional onStateChange callback
      // In modern Colyseus, onStateChange is a method that registers callbacks, not a property
      room.onStateChange((state: any) => {
        // Update roster
        try {
          const { remotesRef, colyseusToLivekitMap, identityToNameMap, localPosRef } = args;
          const online: Record<string, { name: string; x: number; y: number }> = {};

          // Build online map from state.players
          const players: Record<string, { x: number; y: number; identity?: string; name?: string }> = {};
          if (state.players) {
            if (typeof state.players.forEach === 'function') {
              state.players.forEach((value: any, key: string) => {
                if (key !== localPosRef.current.id) {
                  players[key] = { x: value.x, y: value.y, identity: value.identity, name: value.name };
                }
              });
            } else if (typeof state.players.entries === 'function') {
              for (const [key, value] of state.players.entries()) {
                if (key !== localPosRef.current.id) {
                  players[key] = { x: value.x, y: value.y, identity: value.identity, name: value.name };
                }
              }
            } else if ((state.players as any)[Symbol.iterator]) {
              for (const [key, value] of (state.players as any)) {
                if (key !== localPosRef.current.id) {
                  players[key] = { x: value.x, y: value.y, identity: value.identity, name: value.name };
                }
              }
            }
          }

          for (const [sid, p] of Object.entries(players) as any) {
            const livekitIdentity = (p as any).identity || (colyseusToLivekitMap.current as any)[sid] || sid;
            const name = (p as any).name || livekitIdentity;
            online[livekitIdentity] = { name, x: (p as any).x, y: (p as any).y };
          }

          // Include local user via stable userId so presence merge marks self online
          try {
            if (me?.id) {
              const lp = localPosRef.current as any;
              online[me.id] = { name: me.name || me.email || me.id, x: lp?.x ?? 0, y: lp?.y ?? 0 };
            }
          } catch {}

          args.rosterByIdentityRef.current = online;
          setRoster(prev => {
            const map = new Map<string, { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>();
            for (const r of prev) map.set(r.identity, { ...r, online: false });
            for (const [ident, v] of Object.entries(online)) {
              if (map.has(ident)) {
                map.set(ident, { ...(map.get(ident) as any), name: v.name, online: true, x: v.x, y: v.y });
              } else {
                let matchedKey: string | undefined;
                for (const [k, val] of map.entries()) {
                  if ((val.name || '').toLowerCase() === (v.name || '').toLowerCase()) { matchedKey = k; break; }
                }
                if (matchedKey) {
                  const cur = map.get(matchedKey)!;
                  map.set(matchedKey, { ...cur, online: true, x: v.x, y: v.y });
                } else {
                  map.set(ident, { identity: ident, name: v.name, online: true, x: v.x, y: v.y });
                }
              }
            }
            return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
          });
        } catch {}
        setTimeout(buildParticipantList, 0);
      });

      // Setup error and leave handlers
      room.onError?.((...ev: any[]) => {
        handleError(ev, disposed, () => scheduleReconnect(disposed));
      });

      room.onLeave?.((code?: number) => {
        handleLeave(code, disposed);
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
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [apiBase, me?.id]);
}
