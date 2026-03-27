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
import { useMapStore } from '../state/mapStore';
import i18n from '../app/providers/i18n';

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
      // Session conflict detection — registered first so the message is caught before any other setup
      room.onMessage('session_conflict', () => {
        logger.info('[useWorldRoom] Session conflict detected — showing takeover dialog');
        if (typeof window !== 'undefined') {
          (window as any).__sessionConflictPending = true;
        }

        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);';
        host.innerHTML = `
          <div style="min-width:320px;max-width:480px;padding:24px;border-radius:12px;border:1px solid rgba(59,130,246,0.5);background:rgba(30,41,59,0.95);backdrop-filter:blur(8px);color:#fff;box-shadow:0 8px 32px rgba(0,0,0,0.4);text-align:center;">
            <div style="font-size:48px;margin-bottom:12px;">🔄</div>
            <div style="font-weight:700;font-size:18px;margin-bottom:8px;">${i18n.t('sessionConflict.title')}</div>
            <div style="font-size:14px;color:#94a3b8;margin-bottom:20px;">${i18n.t('sessionConflict.description')}</div>
            <div style="display:flex;gap:12px;justify-content:center;">
              <button data-session-cancel style="padding:10px 20px;border-radius:8px;border:1px solid rgba(255,255,255,0.2);background:transparent;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.cancel')}</button>
              <button data-session-takeover style="padding:10px 20px;border-radius:8px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:600;font-size:14px;">${i18n.t('sessionConflict.takeover')}</button>
            </div>
          </div>`;
        document.body.appendChild(host);

        host.querySelector('[data-session-takeover]')?.addEventListener('click', () => {
          try { host.remove(); } catch {}
          try { delete (window as any).__sessionConflictPending; } catch {}
          room.send('session_takeover', { identity: me.id });
        }, { once: true });

        host.querySelector('[data-session-cancel]')?.addEventListener('click', () => {
          try { host.remove(); } catch {}
          try { delete (window as any).__sessionConflictPending; } catch {}
          room.send('session_takeover_cancel', {});
        }, { once: true });
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

      // Setup all message handlers
      setupPlayerHandlers(room, args, scheduleBuildParticipantList, scheduleRefreshRosterFromRemotes);
      setupBubbleHandlers(room, args);
      setupEditorHandlers(room, args, scheduleBuildParticipantList);
      setupRemoteControlHandlers(room, args);
      setupPresenceHandlers(room, args, recentPresenceRef);
      setupZoneLockHandlers(room);

      // Force initial state sync - onStateChange doesn't fire for the initial state,
      // and full_state message might arrive before handlers are registered
      try {
        if (room.state?.players) {
          const currentMap = useMapStore.getState().currentMapName;
          const players: Record<string, any> = {};
          const iteratePlayers = (value: any, key: string) => {
            if (key === room.sessionId) return; // skip local player
            // Only render players on the same map (matches playerHandlers filter)
            if (value.mapName && value.mapName !== currentMap) return;
            players[key] = {
              x: value.x, y: value.y, direction: value.direction,
              name: value.name, dnd: value.dnd, avatarId: value.avatarId,
              isNpc: value.isNpc, identity: value.identity
            };
            if (value.identity && value.name) {
              identityToNameMap.current[value.identity] = value.name;
            }
            if (value.identity) {
              colyseusToLivekitMap.current[key] = value.identity;
            }
          };
          if (typeof room.state.players.forEach === 'function') {
            room.state.players.forEach(iteratePlayers);
          } else if (typeof room.state.players.entries === 'function') {
            for (const [key, value] of room.state.players.entries()) {
              iteratePlayers(value, key);
            }
          }

          // Build the filtered map with proper name resolution
          const filtered = Object.fromEntries(
            Object.entries(players).map(([id, p]: [string, any]) => {
              const livekitIdentity = p.identity || colyseusToLivekitMap.current[id] || id;
              const name = identityToNameMap.current[livekitIdentity] || p.name || livekitIdentity;
              return [id, { ...p, name, identity: livekitIdentity }];
            })
          );

          if (Object.keys(filtered).length > 0) {
            gameBridge.syncRemotePlayers(filtered);
            // Also update remotesRef
            args.remotesRef.current = Object.fromEntries(
              Object.entries(filtered).map(([id, p]: [string, any]) => [id, { x: p.x, y: p.y, dnd: p.dnd, avatarId: p.avatarId }])
            );
            scheduleBuildParticipantList(0);
            scheduleRefreshRosterFromRemotes(0);
          }
        }
      } catch (e) {
        // Non-critical - full_state or onStateChange will handle it eventually
      }

      // Add roster update as additional onStateChange callback
      // In modern Colyseus, onStateChange is a method that registers callbacks, not a property
      room.onStateChange((state: any) => {
        // Update roster
        try {
          const { colyseusToLivekitMap, localPosRef } = args;
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
