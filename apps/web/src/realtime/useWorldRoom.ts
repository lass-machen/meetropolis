import React from 'react';
import { joinWorld } from '../lib/colyseus';

type AnyRef<T> = React.MutableRefObject<T>;

interface UseWorldRoomArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  avRef: AnyRef<any>;
  colyseusRef: AnyRef<any>;
  localPosRef: AnyRef<{ id: string; x: number; y: number }>;
  remotesRef: AnyRef<Record<string, { x: number; y: number }>>;
  colyseusToLivekitMap: AnyRef<Record<string, string>>;
  identityToNameMap: AnyRef<Record<string, string>>;
  gameBridge: any;
  // editor/zone sync
  editor: any;
  setEditor: React.Dispatch<React.SetStateAction<any>>;
  zoneRef: AnyRef<any>;
  // UI & audio
  buildParticipantList: () => void;
  applyVolumesToUi: () => void;
  setBubbleUi: React.Dispatch<React.SetStateAction<{ active: boolean; members: string[] }>>;
  dndRef: AnyRef<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  // roster
  rosterByIdentityRef: AnyRef<Record<string, { name: string; x: number; y: number }>>;
  setRoster: React.Dispatch<React.SetStateAction<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>>;
  // lifetime
  disposedRef: AnyRef<boolean>;
}

export function useWorldRoom(args: UseWorldRoomArgs) {
  const {
    apiBase,
    me,
    avRef,
    colyseusRef,
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    gameBridge,
    editor,
    setEditor,
    zoneRef,
    buildParticipantList,
    applyVolumesToUi,
    setBubbleUi,
    dndRef,
    setAvState,
    rosterByIdentityRef,
    setRoster,
  } = args;

  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!me) return;
    let disposed = false;
    try { if (args.disposedRef) args.disposedRef.current = false; } catch {}

    const scheduleReconnect = () => {
      if (disposed) return;
      const attempt = ++reconnectAttemptsRef.current;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      try {
        // Falls kein valider lokaler Startpunkt vorhanden ist, Spawn aus LocalStorage verwenden
        try {
          const lp = localPosRef.current as any;
          const hasLocal = lp && typeof lp.x === 'number' && typeof lp.y === 'number' && (lp.x !== 0 || lp.y !== 0);
          if (!hasLocal && typeof window !== 'undefined') {
            const raw = localStorage.getItem('meetropolis.spawn');
            if (raw) {
              const sp = JSON.parse(raw);
              if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
                localPosRef.current = { ...(localPosRef.current as any), x: sp.x, y: sp.y } as any;
                try { (window as any).initialPlayerPosition = { x: sp.x, y: sp.y }; } catch {}
                try { (window as any).currentPhaserScene?.setSpawnMarker?.({ x: sp.x, y: sp.y }); } catch {}
              }
            }
          }
        } catch {}
        const positionToUse = localPosRef.current && (localPosRef.current.x !== undefined && localPosRef.current.y !== undefined)
          ? localPosRef.current
          : undefined;
        const room = await joinWorld(
          apiBase,
          me.id,
          me.name || me.email || me.id,
          positionToUse
        );
        if (disposed) { try { room.leave(); } catch {} return; }
        colyseusRef.current = room;
        reconnectAttemptsRef.current = 0;

        const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
        const colyseusSessionId = room.sessionId;
        colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
        localPosRef.current.id = colyseusSessionId;
        if (typeof window !== 'undefined') { (window as any).__localSessionId = colyseusSessionId; }

        room.onMessage('full_state', (data: any) => {
          if (!gameBridge?.syncRemotePlayers) return;
          if (data?.players) {
            const players: Record<string, { x: number; y: number; direction: any; name?: string; dnd?: boolean }> = {};
            for (const p of data.players) {
              if (p.id === localPosRef.current.id) continue;
              if (p.identity) {
                colyseusToLivekitMap.current[p.id] = p.identity;
                if (p.name) identityToNameMap.current[p.identity] = p.name;
              }
              players[p.id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd } as any;
            }
            if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(players);
            remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y }]));
            setTimeout(buildParticipantList, 0);
          }
        });

        room.onMessage('player_joined', (data: any) => {
          if (data.id === localPosRef.current.id) return;
          remotesRef.current[data.id] = { x: data.x, y: data.y };
          if (data.identity) {
            colyseusToLivekitMap.current[data.id] = data.identity;
            if (data.name) identityToNameMap.current[data.identity] = data.name;
          }
          if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd });
          setTimeout(buildParticipantList, 50);
          try {
            const currZones = (editor?.zones || []);
            if (Array.isArray(currZones) && currZones.length > 0) {
              colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: currZones });
            }
          } catch {}
        });

        room.onMessage('player_moved', (data: any) => {
          if (data.id === localPosRef.current.id) return;
          remotesRef.current[data.id] = { x: data.x, y: data.y };
          if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') gameBridge.updateRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction });
          setTimeout(buildParticipantList, 50);
        });

        room.onMessage('player_left', (data: any) => {
          delete remotesRef.current[data.id];
          delete colyseusToLivekitMap.current[data.id];
          if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
          setTimeout(buildParticipantList, 50);
        });

        room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => {
          if (gameBridge && typeof (gameBridge as any).updateRemotePlayerDnd === 'function') (gameBridge as any).updateRemotePlayerDnd(data.id, data.dnd);
          setTimeout(buildParticipantList, 50);
        });

        room.onMessage('editor_update', (data: any) => {
          if (data?.type === 'zone' && Array.isArray(data.polys)) {
            setEditor((s: any) => ({ ...s, zones: data.polys }));
            try { localStorage.setItem('meetropolis.zones', JSON.stringify(data.polys)); } catch {}
            if (gameBridge && typeof gameBridge.setZoneOverlay === 'function') gameBridge.setZoneOverlay(data.polys);
            if (zoneRef.current && typeof zoneRef.current.setZones === 'function') zoneRef.current.setZones(data.polys);
            setTimeout(buildParticipantList, 0);
            return;
          }
          if (data?.type === 'tile_paint' && data.edit) { if (gameBridge && typeof gameBridge.applyTilePaint === 'function') gameBridge.applyTilePaint(data.edit); return; }
          if (data?.type === 'layers' || data?.type === 'all') { if (gameBridge && typeof (gameBridge as any).fetchAndApplyServerLayers === 'function') (gameBridge as any).fetchAndApplyServerLayers(); return; }
          if (data?.type === 'asset' && Array.isArray(data.assets)) { if (gameBridge && typeof (gameBridge as any).setEditorAssets === 'function') (gameBridge as any).setEditorAssets(data.assets); return; }
          if (gameBridge && typeof (gameBridge as any).handleEditorUpdate === 'function') (gameBridge as any).handleEditorUpdate(data);
        });

        room.onMessage('remote_control', async (payload: { mic?: boolean; cam?: boolean; share?: boolean; dnd?: boolean }) => {
          // Wichtig: Schalte Mic/Kamera ausschließlich über den AVManager,
          // damit Pending-Flags, Reconnect-Recovery und Publishes konsistent bleiben.
          try {
            if (typeof payload.mic === 'boolean') {
              const target = !!payload.mic;
              await avRef.current?.setMicrophoneEnabled(target);
              try {
                if (!target) {
                  // Zeige lokale Toast-Meldung
                  const { default: i18n } = await import('../lib/i18n');
                  const title = i18n.t('participant.forceMutedSelfTitle');
                  const desc = i18n.t('participant.forceMutedSelfDesc');
                  const close = i18n.t('toast.close');
                  const host = document.createElement('div');
                  host.style.position = 'fixed';
                  host.style.bottom = '16px';
                  host.style.right = '16px';
                  host.style.zIndex = '120';
                  host.innerHTML = `
                    <div style="display:grid;gap:6px;min-width:240px;max-width:420px;padding:12px;border-radius:10px;border:1px solid rgba(244,63,94,0.45);background:rgba(244,63,94,0.15);color:var(--fg);box-shadow:var(--shadow)">
                      <div style="font-weight:700;">${title}</div>
                      <div style="font-size:13px;color:var(--fg-subtle)">${desc}</div>
                      <div style="display:flex;justify-content:flex-end">
                        <button data-toast-close style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:var(--glass);color:var(--fg);cursor:pointer">${close}</button>
                      </div>
                    </div>`;
                  document.body.appendChild(host);
                  const remove = () => { try { host.remove(); } catch {} };
                  try { host.querySelector('[data-toast-close]')?.addEventListener('click', remove, { once: true } as any); } catch {}
                  setTimeout(remove, 4500);
                }
              } catch {}
            }
          } catch {}
          try {
            if (typeof payload.cam === 'boolean') {
              await avRef.current?.setCameraEnabled(payload.cam);
            }
          } catch {}
          if (typeof payload.share === 'boolean') {
            try {
              if (payload.share && !avRef.current?.room?.localParticipant?.isScreenShareEnabled) {
                const ok = await avRef.current?.startScreenshare();
                if (ok) setAvState(s => ({ ...s, share: true }));
              } else if (!payload.share && avRef.current?.room?.localParticipant?.isScreenShareEnabled) {
                await avRef.current?.stopScreenshare();
                setAvState(s => ({ ...s, share: false }));
              }
            } catch {}
          }
          if (typeof payload.dnd === 'boolean') {
            const next = !!payload.dnd;
            if (gameBridge && typeof (gameBridge as any).setDoNotDisturb === 'function') (gameBridge as any).setDoNotDisturb(next);
            if (next) {
              try { await avRef.current?.setMicrophoneEnabled(false); } catch {}
              try { await avRef.current?.setCameraEnabled(false); } catch {}
              try { await avRef.current?.stopScreenshare(); } catch {}
            }
            setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
            dndRef.current = next;
            try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
          }
        });

        room.onMessage('bubble_state', (payload: { members: string[] }) => {
          const incoming = new Set<string>(Array.isArray(payload?.members) ? payload.members : []);
          const visual = new Set<string>();
          const amInBubble = !!(localPosRef.current.id && incoming.has(localPosRef.current.id));
          if (gameBridge && typeof (gameBridge as any).setMovementLocked === 'function') (gameBridge as any).setMovementLocked(!!amInBubble);
          if (localPosRef.current.id && incoming.has(localPosRef.current.id)) visual.add('__local__');
          for (const id of incoming) { if (id !== localPosRef.current.id) visual.add(id); }
          if (gameBridge && typeof (gameBridge as any).setBubbleMembers === 'function') (gameBridge as any).setBubbleMembers(visual);
          applyVolumesToUi();
          // UI names
          const names: string[] = [];
          for (const id of incoming) {
            if (id === localPosRef.current.id) continue;
            const identity = colyseusToLivekitMap.current[id] || id;
            const name = identityToNameMap.current[identity] || identity;
            names.push(name);
          }
          setBubbleUi({ active: amInBubble && incoming.size > 1, members: names });
        });

        room.onStateChange((state: any) => {
          const players: Record<string, { x: number; y: number; direction: any; dnd?: boolean; identity?: string; name?: string }> = {};
          if (state.players) {
            if (typeof state.players.forEach === 'function') {
              state.players.forEach((value: any, key: string) => { players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name }; if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name; });
            } else if (typeof state.players.entries === 'function') {
              for (const [key, value] of state.players.entries()) { players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name }; if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name; }
            } else if ((state.players as any)[Symbol.iterator]) {
              for (const [key, value] of (state.players as any)) { players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd, identity: value.identity, name: value.name }; if (value.identity && value.name) identityToNameMap.current[value.identity] = value.name; }
            }
          }
          remotesRef.current = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y }]));
          const filtered = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => {
            const livekitIdentity = (p as any).identity || colyseusToLivekitMap.current[id] || id;
            const name = identityToNameMap.current[livekitIdentity] || (p as any).name || livekitIdentity;
            return [id, { ...p, name, identity: livekitIdentity }];
          }));
          if (gameBridge && typeof gameBridge.syncRemotePlayers === 'function') gameBridge.syncRemotePlayers(filtered);

          try {
          const online: Record<string, { name: string; x: number; y: number }> = {};
            for (const [sid, p] of Object.entries(filtered) as any) {
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
            rosterByIdentityRef.current = online;
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

        room.onError?.(() => { colyseusRef.current = null; scheduleReconnect(); });
        room.onLeave?.(() => { colyseusRef.current = null; scheduleReconnect(); });
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      try { if (args.disposedRef) args.disposedRef.current = true; } catch {}
      try {
        const room: any = colyseusRef.current;
        const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
        const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
        if (isOpen) room.leave();
      } catch {}
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [apiBase, me?.id]);
}


