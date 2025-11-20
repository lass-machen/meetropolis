import React from 'react';
import { joinWorld } from '../lib/colyseus';
import { mergeRecentPresence, type ApiPresence } from '../features/participants/presence';

type AnyRef<T> = React.MutableRefObject<T>;

interface UseWorldRoomArgs {
  apiBase: string;
  me: { id: string; email: string; name?: string } | null;
  avRef: AnyRef<any>;
  colyseusRef: AnyRef<any>;
  localPosRef: AnyRef<{ id: string; x: number; y: number }>;
  remotesRef: AnyRef<Record<string, { x: number; y: number; dnd?: boolean }>>;
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
  // bubble members (used by VolumeManager providers)
  bubbleMembersRef: AnyRef<Set<string>>;
  // bubble groups mapping: colyseusId -> groupId
  bubbleGroupsRef: AnyRef<Record<string, string>>;
  dndRef: AnyRef<boolean>;
  setAvState: React.Dispatch<React.SetStateAction<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>>;
  // roster
  rosterByIdentityRef: AnyRef<Record<string, { name: string; x: number; y: number }>>;
  setRoster: React.Dispatch<React.SetStateAction<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>>;
  // lifetime
  disposedRef: AnyRef<boolean>;
  // connection monitor (optional)
  setConnectionStatus?: React.Dispatch<React.SetStateAction<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>>;
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
    bubbleMembersRef,
    bubbleGroupsRef,
    dndRef,
    setAvState,
    rosterByIdentityRef,
    setRoster,
    setConnectionStatus,
  } = args;

  const reconnectAttemptsRef = React.useRef(0);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloseInfoRef = React.useRef<{ code?: number; reason?: string }>({});
  const connectingRef = React.useRef<boolean>(false);
  const coolDownUntilRef = React.useRef<number>(0);

  React.useEffect(() => {
    if (!me) return;
    let disposed = false;
    try { if (args.disposedRef) args.disposedRef.current = false; } catch {}

    // Debounce-Timer/RAF-Handles im Effekt-Scope halten, damit Cleanup sie erreicht
    let buildListTimer: any = null;
    let buildListRaf: number | null = null;
    let rosterTimer: any = null;
    let rosterRaf: number | null = null;

    const scheduleReconnect = () => {
      if (disposed) return;
      try { setConnectionStatus?.((s) => ({ reconnecting: true, lastCode: lastCloseInfoRef.current.code, lastReason: lastCloseInfoRef.current.reason })); } catch {}
      try { (window as any).__wsReconnects = ((window as any).__wsReconnects || 0) + 1; } catch {}
      const now = Date.now();
      if (coolDownUntilRef.current > now) {
        // In Cooldown (z. B. bei 'Insufficient resources') – warte bis Ablauf.
      } else {
        // Exponentieller Backoff
        const attempt = ++reconnectAttemptsRef.current;
        // Circuit breaker: nach vielen Fehlversuchen längeren Cooldown setzen
        if (attempt >= 8) {
          coolDownUntilRef.current = now + 60_000; // 60s Pause
          reconnectAttemptsRef.current = 0;
        }
      }
      const baseAttempt = Math.max(1, reconnectAttemptsRef.current);
      const delayBase = Math.min(30_000, 1000 * Math.pow(2, baseAttempt - 1) + Math.random() * 500);
      const extra = Math.max(0, coolDownUntilRef.current - now);
      const delay = Math.max(delayBase, extra);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (disposed) return;
      if (connectingRef.current) return;
      const now = Date.now();
      if (coolDownUntilRef.current > now) {
        // Noch im Cooldown – später erneut versuchen
        scheduleReconnect();
        return;
      }
      connectingRef.current = true;
      try {
        // Server entscheidet über Default-Spawn: keine LocalStorage-Spawninjektion mehr
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
        try { setConnectionStatus?.({ reconnecting: false, lastCode: undefined, lastReason: undefined }); } catch {}
        connectingRef.current = false;

        const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
        const colyseusSessionId = room.sessionId;
        colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
        localPosRef.current.id = colyseusSessionId;
        if (typeof window !== 'undefined') { (window as any).__localSessionId = colyseusSessionId; }

        const refreshRosterFromRemotes = () => {
          try {
            const online: Record<string, { name: string; x: number; y: number }> = {};
            // Remotes (Colyseus SIDs -> LiveKit Identity)
            for (const [sid, pos] of Object.entries(remotesRef.current)) {
              const livekitIdentity = (colyseusToLivekitMap.current as any)[sid] || sid;
              const name = identityToNameMap.current[livekitIdentity] || livekitIdentity;
              online[livekitIdentity] = { name, x: (pos as any).x, y: (pos as any).y };
            }
            // Local (stabile User-ID)
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
                  map.set(ident, { ...(map.get(ident) as any), name: (v as any).name, online: true, x: (v as any).x, y: (v as any).y });
                } else {
                  // Fallback: match by display name to avoid duplicates when identities diverge
                  let matchedKey: string | undefined;
                  for (const [k, val] of map.entries()) {
                    if ((val.name || '').toLowerCase() === ((v as any).name || '').toLowerCase()) { matchedKey = k; break; }
                  }
                  if (matchedKey) {
                    const cur = map.get(matchedKey)!;
                    map.set(matchedKey, { ...cur, online: true, x: (v as any).x, y: (v as any).y });
                  } else {
                    map.set(ident, { identity: ident, name: (v as any).name, online: true, x: (v as any).x, y: (v as any).y });
                  }
                }
              }
              return Array.from(map.values()).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
            });
          } catch {}
        };

        // Force full map reload on join/reconnect to ensure consistency
        try { gameBridge.forceReloadMap?.(); } catch (e) { console.error('Failed to force reload map on join', e); }

        // Debounce: Teilnehmerliste/Roster nur 1x pro kurzem Intervall aktualisieren (rAF + Delay)
        // Vor neuem Session-Lauf evtl. hängende Handles räumen und zurücksetzen
        if (buildListTimer) { try { clearTimeout(buildListTimer); } catch {} buildListTimer = null; }
        if (buildListRaf !== null) { try { cancelAnimationFrame(buildListRaf); } catch {} buildListRaf = null; }
        if (rosterTimer) { try { clearTimeout(rosterTimer); } catch {} rosterTimer = null; }
        if (rosterRaf !== null) { try { cancelAnimationFrame(rosterRaf); } catch {} rosterRaf = null; }
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
        let recentPresenceRef: ApiPresence[] = [];

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
            remotesRef.current = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd }]));
            scheduleBuildParticipantList(0);
            // Roster unmittelbar aus Remotes aktualisieren
            scheduleRefreshRosterFromRemotes(0);
          }
        });

        room.onMessage('player_joined', (data: any) => {
          if (data.id === localPosRef.current.id) return;
          remotesRef.current[data.id] = { x: data.x, y: data.y, dnd: data.dnd };
          if (data.identity) {
            colyseusToLivekitMap.current[data.id] = data.identity;
            if (data.name) identityToNameMap.current[data.identity] = data.name;
          }
          if (gameBridge && typeof (gameBridge as any).addRemotePlayer === 'function') (gameBridge as any).addRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction, name: data.name, dnd: data.dnd });
          scheduleBuildParticipantList(50);
          scheduleRefreshRosterFromRemotes(0);
          applyVolumesToUi();
          try {
            const currZones = (editor?.zones || []);
            if (Array.isArray(currZones) && currZones.length > 0) {
              colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: currZones });
            }
          } catch {}
        });

        room.onMessage('player_moved', (data: any) => {
          if (data.id === localPosRef.current.id) return;
          // keep existing dnd state
          const prev = remotesRef.current[data.id] || {};
          remotesRef.current[data.id] = { ...prev, x: data.x, y: data.y };
          if (gameBridge && typeof gameBridge.updateRemotePlayer === 'function') gameBridge.updateRemotePlayer(data.id, { x: data.x, y: data.y, direction: data.direction });
          scheduleBuildParticipantList(50);
          scheduleRefreshRosterFromRemotes(0);
          applyVolumesToUi();
        });

        room.onMessage('player_left', (data: any) => {
          delete remotesRef.current[data.id];
          delete colyseusToLivekitMap.current[data.id];
          if (gameBridge && typeof gameBridge.removeRemotePlayer === 'function') gameBridge.removeRemotePlayer(data.id);
          scheduleBuildParticipantList(50);
          scheduleRefreshRosterFromRemotes(0);
          applyVolumesToUi();
        });

        room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => {
          if (remotesRef.current[data.id]) {
             remotesRef.current[data.id].dnd = data.dnd;
          }
          if (gameBridge && typeof (gameBridge as any).updateRemotePlayerDnd === 'function') (gameBridge as any).updateRemotePlayerDnd(data.id, data.dnd);
          scheduleBuildParticipantList(50);
        });

        room.onMessage('editor_update', (data: any) => {
          if (data?.type === 'zone' && Array.isArray(data.polys)) {
            setEditor((s: any) => ({ ...s, zones: data.polys }));
            try { localStorage.setItem('meetropolis.zones', JSON.stringify(data.polys)); } catch {}
            if (gameBridge && typeof gameBridge.setZoneOverlay === 'function') gameBridge.setZoneOverlay(data.polys);
            if (zoneRef.current && typeof zoneRef.current.setZones === 'function') zoneRef.current.setZones(data.polys);
            scheduleBuildParticipantList(0);
            return;
          }
          if (data?.type === 'spawn' && data.pos && typeof data.pos.x === 'number' && typeof data.pos.y === 'number') {
            try { gameBridge?.setSpawnMarker?.({ x: data.pos.x, y: data.pos.y }); } catch {}
            try { localStorage.setItem('meetropolis.spawn', JSON.stringify({ x: data.pos.x, y: data.pos.y })); } catch {}
            try { setEditor((s: any) => ({ ...s, spawn: { x: data.pos.x, y: data.pos.y } })); } catch {}
            return;
          }
          if (data?.type === 'tile_paint' && data.edit) { if (gameBridge && typeof gameBridge.applyTilePaint === 'function') gameBridge.applyTilePaint(data.edit); return; }
          if (data?.type === 'layers' || data?.type === 'all') { if (gameBridge && typeof (gameBridge as any).fetchAndApplyServerLayers === 'function') (gameBridge as any).fetchAndApplyServerLayers(); return; }
          if (data?.type === 'asset' && Array.isArray(data.assets)) { if (gameBridge && typeof (gameBridge as any).setEditorAssets === 'function') (gameBridge as any).setEditorAssets(data.assets); return; }
          if (gameBridge && typeof (gameBridge as any).handleEditorUpdate === 'function') (gameBridge as any).handleEditorUpdate(data);
        });

        // v2: Chunks-Updates direkt anwenden
        room.onMessage('chunks_updated', (payload: any) => {
          try {
            const layer = (payload && typeof payload.layer === 'string') ? payload.layer : null;
            const updates = Array.isArray(payload?.updates) ? payload.updates : [];
            if (!layer || updates.length === 0) return;
            const layerName = (layer === 'collision' || layer === 'walls' || layer === 'ground') ? layer : null;
            if (!layerName) return;
            if (gameBridge && typeof (gameBridge as any).applyChunkUpdates === 'function') {
              (gameBridge as any).applyChunkUpdates(layerName, updates);
            }
          } catch {}
        });

        // Tileset Registry Sync (v2)
        room.onMessage('tileset_registry_updated', (payload: any) => {
          try {
            const registry = Array.isArray(payload?.tilesetRegistry) ? payload.tilesetRegistry : null;
            if (registry && gameBridge && typeof (gameBridge as any).updateTilesetRegistry === 'function') {
              (gameBridge as any).updateTilesetRegistry(registry);
            }
          } catch {}
        });

        // Presence: Seed der letzten Aktivitäten (ohne Polling)
        room.onMessage('presence_recent', (list: ApiPresence[]) => {
          try {
            recentPresenceRef = Array.isArray(list) ? list : [];
            setRoster((prev) => mergeRecentPresence(prev, rosterByIdentityRef.current, recentPresenceRef));
          } catch {}
        });
        // Presence: Einzel-Update (z. B. Positions-/Zeitstempelaktualisierung)
        room.onMessage('presence_update', (p: ApiPresence) => {
          try {
            const list = Array.isArray(recentPresenceRef) ? [...recentPresenceRef] : [];
            const idx = list.findIndex(x => String(x.userId) === String((p as any)?.userId));
            if (idx >= 0) list[idx] = { ...list[idx], ...p, updatedAt: p.updatedAt || new Date().toISOString() };
            else list.push({ ...p, updatedAt: p.updatedAt || new Date().toISOString() });
            recentPresenceRef = list;
            setRoster((prev) => mergeRecentPresence(prev, rosterByIdentityRef.current, recentPresenceRef));
          } catch {}
        });

        // Helper, um Remote-Controls konsistent anzuwenden (genutzt von weiteren Message-Typen)
        const applyRemoteControl = async (payload: { mic?: boolean; cam?: boolean; share?: boolean; dnd?: boolean }) => {
          const roomRef: any = avRef.current?.room as any;
          try {
            if (typeof payload.mic === 'boolean') {
              const { isLocalMicOn } = await import('../av/core/localState');
              const current = isLocalMicOn(roomRef);
              const target = !!payload.mic;
              if (current !== target) {
                await avRef.current?.setMicrophoneEnabled(target);
                // Nachführen UI mit tatsächlichem Zustand
                try {
                  const real = isLocalMicOn(roomRef);
                  setAvState(s => ({ ...s, mic: real }));
                } catch {}
                // Kurzer Re-Check (Pending/Signaling)
                setTimeout(() => {
                  try {
                    const again = isLocalMicOn(avRef.current?.room as any);
                    setAvState(s => ({ ...s, mic: again }));
                  } catch {}
                }, 400);
                try {
                  if (!target) {
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
            }
          } catch {}
          try {
            if (typeof payload.cam === 'boolean') {
              const { isLocalCamOn } = await import('../av/core/localState');
              const current = isLocalCamOn(roomRef);
              const target = !!payload.cam;
              if (current !== target) {
                await avRef.current?.setCameraEnabled(target);
                // Nachführen UI mit tatsächlichem Zustand
                try {
                  const real = isLocalCamOn(roomRef);
                  setAvState(s => ({ ...s, cam: real }));
                } catch {}
                setTimeout(() => {
                  try {
                    const again = isLocalCamOn(avRef.current?.room as any);
                    setAvState(s => ({ ...s, cam: again }));
                  } catch {}
                }, 400);
              }
            }
          } catch {}
          if (typeof payload.share === 'boolean') {
            try {
              const { isLocalShareOn } = await import('../av/core/localState');
              const current = isLocalShareOn(roomRef);
              const target = !!payload.share;
              if (target && !current) {
                const ok = await avRef.current?.startScreenshare();
                if (ok) setAvState(s => ({ ...s, share: true }));
              } else if (!target && current) {
                await avRef.current?.stopScreenshare();
                setAvState(s => ({ ...s, share: false }));
              }
              // Kurzer Re-Check für Share
              setTimeout(() => {
                try {
                  const again = isLocalShareOn(avRef.current?.room as any);
                  setAvState(s => ({ ...s, share: again }));
                } catch {}
              }, 400);
            } catch {}
          }
          if (typeof payload.dnd === 'boolean') {
            const next = !!payload.dnd;
            try { await avRef.current?.setDoNotDisturb(next); } catch {}
            if (gameBridge && typeof (gameBridge as any).setDoNotDisturb === 'function') (gameBridge as any).setDoNotDisturb(next);
            if (next) {
              try { await avRef.current?.setMicrophoneEnabled(false); } catch {}
              try { await avRef.current?.setCameraEnabled(false); } catch {}
              try { await avRef.current?.stopScreenshare(); } catch {}
            }
            setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
            dndRef.current = next;
            try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
            // DND beeinflusst Lautstärke/Mute – UI-Volumes neu anwenden
            try { applyVolumesToUi(); } catch {}
            // Verifiziere nach kurzer Zeit den echten Zustand (Mic/Cam/Share) und gleiche UI an
            setTimeout(async () => {
              try {
                const mod: any = await import('../av/core/localState');
                const r: any = avRef.current?.room as any;
                const realMic = mod.isLocalMicOn(r);
                const realCam = mod.isLocalCamOn(r);
                const realShare = mod.isLocalShareOn(r);
                setAvState(s => ({ ...s, mic: next ? false : realMic, cam: next ? false : realCam, share: next ? false : realShare }));
              } catch {}
            }, 450);
          }
        };

        room.onMessage('remote_control', async (payload: any) => {
          await applyRemoteControl(payload || {});
        });
        room.onMessage('remote_controls', async (msg: any) => {
          if (msg?.payload) {
            await applyRemoteControl(msg.payload);
          }
        });

        room.onMessage('remote_controls_for', async (msg: any) => {
          const localIdentity = avRef.current?.room?.localParticipant?.identity || me?.id;
          if (!msg?.forIdentity || String(localIdentity || '') !== String(msg.forIdentity || '')) return;
          if (msg?.payload) {
            await applyRemoteControl(msg.payload);
          }
        });

        room.onMessage('bubble_state', (payload: { members?: string[]; groups?: Array<{ id: string; members: string[] }> }) => {
          const membersArr = Array.isArray(payload?.members) ? payload.members! : [];
          // Groups -> mapping
          const groupsArr = Array.isArray(payload?.groups) ? payload.groups! : null;
          const mapping: Record<string, string> = {};
          if (groupsArr) {
            for (const g of groupsArr) {
              const gid = String(g?.id || '');
              const ms = Array.isArray(g?.members) ? g.members : [];
              if (!gid || ms.length < 2) continue;
              for (const id of ms) mapping[id] = gid;
            }
          } else if (membersArr.length >= 2) {
            // Legacy: alle Mitglieder als eine Bubble
            const gid = 'legacy';
            for (const id of membersArr) mapping[id] = gid;
          }
          try { bubbleGroupsRef.current = mapping; } catch {}
          const incoming = new Set<string>(membersArr);
          // Sync bubbleMembersRef used by VolumeManager providers
          try {
            bubbleMembersRef.current.clear();
            for (const id of incoming) bubbleMembersRef.current.add(id);
          } catch {}
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
          remotesRef.current = Object.fromEntries(Object.entries(players).filter(([id]) => id !== localPosRef.current.id).map(([id, p]) => [id, { x: (p as any).x, y: (p as any).y, dnd: (p as any).dnd }]));
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

        room.onError?.((...ev: any[]) => {
          try {
            const code = (ev && ev[0] && typeof ev[0].code === 'number') ? ev[0].code : undefined;
            const reason = (ev && ev[0] && typeof ev[0].reason === 'string') ? ev[0].reason : undefined;
            // Manche Browser-Stacks liefern nur Message-Strings
            const msg = (ev && ev[0] && (ev[0].message || ev[0].toString?.())) || '';
            const text = String(reason || msg || '');
            if (text.toLowerCase().includes('insufficient resources')) {
              // Setze Cooldown um Session-ID-Flut zu verhindern
              coolDownUntilRef.current = Date.now() + 60_000;
            }
            lastCloseInfoRef.current = { code, reason };
          } catch {}
          colyseusRef.current = null;
          connectingRef.current = false;
          scheduleReconnect();
        });
        room.onLeave?.((code?: number) => {
          try { lastCloseInfoRef.current = { code, reason: undefined }; } catch {}
          colyseusRef.current = null;
          connectingRef.current = false;
          scheduleReconnect();
        });
      } catch (err: any) {
        try {
          const msg = (err && (err.message || err.toString?.())) || '';
          if (String(msg).toLowerCase().includes('insufficient resources')) {
            coolDownUntilRef.current = Date.now() + 60_000;
            lastCloseInfoRef.current = { code: undefined, reason: 'Insufficient resources' };
          }
        } catch {}
        connectingRef.current = false;
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      try { if (args.disposedRef) args.disposedRef.current = true; } catch {}
      try { setConnectionStatus?.({ reconnecting: false, lastCode: undefined, lastReason: undefined }); } catch {}
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


