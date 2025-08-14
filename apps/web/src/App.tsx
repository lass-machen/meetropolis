import React, { useEffect, useRef } from 'react';
import { ThemeProvider, AppShell, ThemeToggleButton } from './ui/theme';
import { Button, Card, Input, Toolbar, Modal, TilesetPreview } from './ui/components';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { FollowManager } from './game/followManager';
import { ZoneManager } from './game/zoneManager';
import { VolumeManager } from './game/volumeManager';

const DEBUG = (import.meta as any).env?.VITE_DEBUG_LOGS === 'true';

// Simple Inline-Icons
function MicIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v4a4 4 0 0 0 4 4Z" stroke={color} strokeWidth="1.8" />
      <path d="M19 10a7 7 0 1 1-14 0" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17v4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function CamIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="7" width="12" height="10" rx="2" stroke={color} strokeWidth="1.8" />
      <path d="M21 8v8l-5-3.2V11.2L21 8Z" fill={color} />
    </svg>
  );
}
function ScreenIcon(props: { on?: boolean }) {
  const color = props.on ? '#10b981' : '#e5e7eb';
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="4" width="18" height="12" rx="2" stroke={color} strokeWidth="1.8" />
      <rect x="8" y="18" width="8" height="2" rx="1" fill={color} />
    </svg>
  );
}

// Small UI Icons
function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 5H5v4" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M5 5l5 5" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M15 19h4v-4" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M19 19l-5-5" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}
function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 10L5 5" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M9 5h-4v4" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M14 14l5 5" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M15 19h4v-4" stroke="#e5e7eb" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

export function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const colyseusReconnectAttemptsRef = useRef(0);
  const colyseusReconnectTimerRef = useRef<any>(null);
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<import('./game/followManager').FollowManager | null>(null);
  const volumeRef = useRef<VolumeManager | null>(null);
  const bubbleMembersRef = useRef<Set<string>>(new Set());
  const localPosRef = useRef<{ id: string; x: number; y: number }>({ id: '', x: 0, y: 0 });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean }>({ mic: false, cam: false, share: false });
  const [selectedMicId, setSelectedMicId] = React.useState<string | ''>('');
  const [selectedCamId, setSelectedCamId] = React.useState<string | ''>('');
  const [uiParticipants, setUiParticipants] = React.useState<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen' }[]>([]);
  // Auth state
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  // view/state werden in AuthScreen verwaltet
  // Grid Overlay expand/collapse + selection
  const [gridExpanded, setGridExpanded] = React.useState(false);
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  // Simple view routing
  const [page, setPage] = React.useState<'world' | 'users' | 'profile'>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const editorActiveRef = React.useRef(false);
  const connectLivekitRef = React.useRef<null | (() => Promise<void>)>(null);
  // Map Editor State
  const [editor, setEditor] = React.useState<{ 
    active: boolean;
    tool: 'zone' | 'asset' | 'select' | 'paint' | 'collision' | 'erase';
    tempPoints: { x: number; y: number }[];
    name: string;
    zones: { name: string; points: { x: number; y: number }[] }[];
    assets: { id: string; key: string; dataUrl: string; x: number; y: number }[];
    pendingAsset?: { key: string; dataUrl: string } | null;
    tilePaint?: { tilesetKey: string; tileIndex: number; tileWidth: number; tileHeight: number; margin?: number; spacing?: number } | null;
    drag?: { startTileX: number; startTileY: number; endTileX: number; endTileY: number } | null;
    tilesets?: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }[];
  }>({ active: false, tool: 'zone', tempPoints: [], name: '', zones: [], assets: [], pendingAsset: null, tilePaint: { tilesetKey: 'office_tiles', tileIndex: 1, tileWidth: 16, tileHeight: 16 }, drag: null, tilesets: [] });
  React.useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);

  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:2567`
      : 'http://localhost:2567');

  // Room getter stabil hält die gleiche Referenz für Child-Komponenten
  const getRoom = React.useCallback(() => avRef.current?.room, []);

  async function fetchMe() {
    try {
      const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        setMe(null);
      } else {
        const u = await res.json();
        setMe(u);
      }
    } catch {
      setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    if (page !== 'world') return;
    fetchMe();
  }, [page]);

  // Editor: Laden aus localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('meetropolis.zones');
      if (raw) {
        const parsed = JSON.parse(raw);
        setEditor(s => ({ ...s, zones: Array.isArray(parsed) ? parsed : [] }));
        gameBridge.setZoneOverlay(Array.isArray(parsed) ? parsed : []);
      }
      const rawA = localStorage.getItem('meetropolis.assets');
      if (rawA) {
        const assets = JSON.parse(rawA) || [];
        setEditor(s => ({ ...s, assets }));
        gameBridge.setEditorAssets(assets);
      }
      const rawTs = localStorage.getItem('meetropolis.tilesets');
      const defaultTs = [
        { key: 'office_tiles', dataUrl: '/assets/tilesets/office_tiles.png', tileWidth: 16, tileHeight: 16 },
        { key: 'furniture_tiles', dataUrl: '/assets/tilesets/furniture_tiles.png', tileWidth: 16, tileHeight: 16 },
        { key: 'decor_tiles', dataUrl: '/assets/tilesets/decor_tiles.png', tileWidth: 16, tileHeight: 16 },
      ];
      let tilesets = defaultTs;
      if (rawTs) {
        try { const parsed = JSON.parse(rawTs) || []; tilesets = [...defaultTs, ...parsed.filter((t:any)=>!defaultTs.find(d=>d.key===t.key))]; } catch {}
      }
      try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(tilesets)); } catch {}
      setEditor(s => ({ ...s, tilesets, tilePaint: { ...(s.tilePaint as any), tilesetKey: s.tilePaint?.tilesetKey || 'office_tiles' } }));
      // Bereits vorhandene Editor-Layer sofort anwenden (falls vorhanden)
      try { gameBridge.reloadEditorLayers(); } catch {}
      // Server-state laden (best-effort) – bei 404 Map anlegen und lokalen Stand hochladen
      (async () => {
        try {
          const res = await fetch(`${apiBase}/maps/office/editor-state`, { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            if (data?.tilesets) try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(data.tilesets)); } catch {}
            if (data?.assets) try { localStorage.setItem('meetropolis.assets', JSON.stringify(data.assets)); } catch {}
            if (data?.zones) try { localStorage.setItem('meetropolis.zones', JSON.stringify(data.zones.map((z:any)=>({ name: z.name, points: z.polygon })))); } catch {}
            if (Array.isArray(data?.editorGround) || Array.isArray(data?.collision)) {
              try { localStorage.setItem('meetropolis.editorLayers', JSON.stringify({ editorGround: data.editorGround, collision: data.collision, w: undefined, h: undefined })); } catch {}
              // Nach erfolgreichem Laden: direkt in Szene anwenden
              try { gameBridge.reloadEditorLayers(); } catch {}
            }
          } else if (res.status === 404) {
            // Map auf dem Server erzeugen mit lokalem Stand
            const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
            const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
            const zones = JSON.parse(localStorage.getItem('meetropolis.zones') || '[]');
            const layers = JSON.parse(localStorage.getItem('meetropolis.editorLayers') || '{}');
            await fetch(`${apiBase}/maps/office/editor-state`, {
              method: 'PUT',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ editorGround: layers.editorGround ?? null, collision: layers.collision ?? null, tilesets, assets, zones })
            }).catch(()=>{});
            try { gameBridge.reloadEditorLayers(); } catch {}
          }
        } catch {}
      })();
    } catch {}
  }, []);

  async function saveAllToServer() {
    try {
      const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
      const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
      const zones = editor.zones;
      const layers = JSON.parse(localStorage.getItem('meetropolis.editorLayers') || '{}');
      await fetch(`${apiBase}/maps/office/editor-state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editorGround: layers.editorGround ?? null, collision: layers.collision ?? null, tilesets, assets, zones })
      });
    } catch {}
  }

  // Wenn zur User-Seite gewechselt wird, Game/AV pausieren
  useEffect(() => {
    if (page === 'users') {
      // pausiert Rendering/AV wenn User-Management geöffnet wird
      try { colyseusRef.current?.leave?.(); } catch {}
      try { avRef.current?.leave?.(); } catch {}
    }
  }, [page]);

  const buildParticipantList = React.useCallback(() => {
    const room: any = avRef.current?.room as any;
    if (!room || !room.localParticipant) {
      console.log('[UI] buildParticipantList - no room or localParticipant');
      return;
    }
    const remoteParticipants = Array.from(room.remoteParticipants?.values() || []);
    console.log('[UI] buildParticipantList - participants:', {
      local: room.localParticipant?.identity,
      remotes: remoteParticipants.map((p: any) => ({ identity: p.identity, sid: p.sid }))
    });
    
    const activeSet = new Set<string>((room.activeSpeakers || []).map((p: any) => p.sid));
    const list: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen' }[] = [];
    const pushP = (p: any) => {
      if (!p || !p.trackPublications) return;
      const publications = Array.from((p.trackPublications?.values?.() || []) as any);
      if (DEBUG) { try { console.log('[UI] participant pubs', p.identity, publications.map((pub:any)=>({src: pub?.source||pub?.track?.source, kind: pub?.kind||pub?.track?.kind, hasTrack: !!pub?.track}))); } catch {} }
      const isVideoPub = (pub: any) => {
        const source = (pub?.source ?? pub?.track?.source);
        return (!!pub?.track && (source === 'camera' || source === 1));
      };
      const isMicPub = (pub: any) => {
        const source = (pub?.source ?? pub?.track?.source);
        const kind = pub?.kind ?? pub?.track?.kind;
        return (!!pub?.track && (kind === 'audio' || source === 'microphone' || source === 0));
      };
      const isScreenPub = (pub: any) => {
        const source = (pub?.source ?? pub?.track?.source);
        const kind = pub?.kind ?? pub?.track?.kind;
        return (!!pub?.track && kind === 'video' && (source === 'screen_share' || source === 2));
      };
      const hasV = publications.some(isVideoPub);
      const hasMic = publications.some(isMicPub);
      const hasScreen = publications.some(isScreenPub);
      const identity = p.identity || 'User';
      // Kamera-Karte
      if (hasV) {
        list.push({ sid: p.sid, identity, hasVideo: true, hasMic, isSpeaking: activeSet.has(p.sid), media: 'camera' });
      }
      // Audio-only Karte (kein Video, aber Mic aktiv)
      if (!hasV && hasMic) {
        list.push({ sid: p.sid, identity, hasVideo: false, hasMic: true, isSpeaking: activeSet.has(p.sid), media: 'camera' });
      }
      // Screenshare als eigene Karte
      if (hasScreen) {
        list.push({ sid: p.sid + ':screen', identity: `${identity} – Bildschirm`, hasVideo: true, hasMic: false, isSpeaking: false, media: 'screen' });
      }
    };
    pushP(room.localParticipant);
    const remotes = Array.from((room.remoteParticipants?.values?.() || room.participants?.values?.() || []) as any);
    console.log('[UI] Processing remote participants:', remotes.length);
    for (const rp of remotes) {
      console.log('[UI] Processing remote participant:', { sid: rp.sid, identity: rp.identity, hasPubs: !!rp.trackPublications });
      pushP(rp);
    }
    console.log('[UI] Final participant list:', list);
    setUiParticipants(list);
  }, []);

  useEffect(() => {
    if (page !== 'world') return;
    if (!authChecked || !me) return;
    if (!containerRef.current) return;
    const game = createPhaserGame(containerRef.current);

    // Colyseus World mit Auto-Reconnect
    let disposed = false;
    const scheduleColyseusReconnect = () => {
      if (disposed) return;
      const attempt = ++colyseusReconnectAttemptsRef.current;
      const delay = Math.min(30000, 1000 * Math.pow(2, attempt - 1) + Math.random() * 500);
      try { if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current); } catch {}
      colyseusReconnectTimerRef.current = setTimeout(() => {
        colyseusReconnectTimerRef.current = null;
        void connectColyseus();
      }, delay);
    };
    const connectColyseus = async () => {
      try {
        const room = await joinWorld(apiBase);
        if (disposed) { try { room.leave(); } catch {} return; }
        colyseusRef.current = room;
        colyseusReconnectAttemptsRef.current = 0;
        localPosRef.current.id = room.sessionId;
        gameBridge.onLocalMove = (p) => {
          localPosRef.current.x = p.x;
          localPosRef.current.y = p.y;
          zoneRef.current?.update({ x: p.x, y: p.y });
          if (followRef.current) {
            const f = followRef.current.update(
              { x: p.x, y: p.y },
              remotesRef.current
            );
            if (f.following) {
              gameBridge.setDesiredPosition({ x: f.x, y: f.y });
            } else {
              gameBridge.setDesiredPosition(null);
            }
          }
          colyseusRef.current?.send?.('move', p);
        };
        room.onStateChange((state: any) => {
          const players: Record<string, { x: number; y: number; direction: any }> = {};
          state.players?.forEach?.((value: any, key: string) => {
            players[key] = { x: value.x, y: value.y, direction: value.direction };
          });
          
          const playerEntries = Object.entries(players) as [string, { x: number; y: number; direction: any }][];
          remotesRef.current = Object.fromEntries(
            playerEntries
              .filter(([id]) => id !== localPosRef.current.id)
              .map(([id, p]) => [id, { x: p.x, y: p.y }])
          );
          
          
          if (bubbleRef.current) {
            const remoteEntries = Object.entries(remotesRef.current) as [string, { x: number; y: number }][];
            const others = remoteEntries.map(([id, p]) => ({ id, x: p.x, y: p.y }));
            bubbleRef.current.update(localPosRef.current, others);
          }
          gameBridge.syncRemotePlayers(players);
        });
        room.onError?.((_code: any, _message: any) => {
          scheduleColyseusReconnect();
        });
        room.onLeave?.((_code: any) => {
          scheduleColyseusReconnect();
        });
      } catch {
        scheduleColyseusReconnect();
      }
    };
    void connectColyseus();

    // LiveKit nach User-Geste verbinden
    const identity = me.id;
    const connectLivekit = async () => {
      // Im Editor-Modus nie LiveKit initialisieren (verhindert Blocking/Errors)
      if (editorActiveRef.current) return;
      try {
        avRef.current = new AVManager({ baseUrl: apiBase, identity, useVideo: import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true' });
        bubbleRef.current?.setAV(avRef.current);
        zoneRef.current?.setAV(avRef.current);
        await avRef.current.switchTo('world');
        const list = await avRef.current.listDevices();
        const micOptions = list.microphones.map(d => ({ id: d.deviceId, label: d.label }));
        const camOptions = list.cameras.map(d => ({ id: d.deviceId, label: d.label }));
        setDevices({ mics: micOptions, cams: camOptions });
        // System-Standard (deviceId === 'default') wählen, sonst erstes Gerät
        const defaultMic = micOptions.find(d => d.id === 'default')?.id || micOptions[0]?.id || '';
        const defaultCam = camOptions.find(d => d.id === 'default')?.id || camOptions[0]?.id || '';
        if (defaultMic) {
          setSelectedMicId(defaultMic);
          try { await avRef.current.useMicrophoneDevice(defaultMic); } catch {}
        }
        if (defaultCam) {
          setSelectedCamId(defaultCam);
          try { await avRef.current.useCameraDevice(defaultCam); } catch {}
        }
        // Warte bis die Verbindung stabil ist
        const room = avRef.current.room;
        if (room) {
          await new Promise<void>((resolve) => {
            const checkConnection = () => {
              if ((room as any).state === 'connected' || (room as any).connectionState === 'connected') {
                resolve();
              } else {
                setTimeout(checkConnection, 100);
              }
            };
            checkConnection();
          });
        }
        // Add event handlers for participant changes
        if (room) {
          // Import LiveKit event constants
          (async () => {
            try {
              const mod = await import('livekit-client');
              const RoomEvent = (mod as any).RoomEvent;
              if (RoomEvent) {
                room.on(RoomEvent.ParticipantConnected, () => {
                  console.log('[LiveKit] ParticipantConnected event - rebuilding list');
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.ParticipantDisconnected, () => {
                  console.log('[LiveKit] ParticipantDisconnected event - rebuilding list');
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackPublished, () => {
                  console.log('[LiveKit] TrackPublished event - rebuilding list');
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackUnpublished, () => {
                  console.log('[LiveKit] TrackUnpublished event - rebuilding list');
                  setTimeout(buildParticipantList, 100);
                });
              }
            } catch {}
          })();
        }
        // Mikrofon automatisch aktivieren
        try { await avRef.current.setMicrophoneEnabled(true); setAvState(s => ({ ...s, mic: true })); } catch {}
        // erst listen, dann sicher bauen
        setTimeout(buildParticipantList, 50);
      } catch (e) {
        console.warn('LiveKit connect failed', e);
        // Editor weiterhin bedienbar halten
        try { bubbleRef.current?.setAV(null as any); } catch {}
        try { zoneRef.current?.setAV(null as any); } catch {}
      }
    };
    connectLivekitRef.current = connectLivekit;
    const firstInteract = () => {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      connectLivekit();
    };
    // LiveKit-Handler optional, aber niemals doppelt registrieren
    if (!editorActiveRef.current) {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      window.addEventListener('pointerdown', firstInteract, { once: true } as any);
      window.addEventListener('keydown', firstInteract, { once: true } as any);
    }

    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);
    // Seed Zonen sofort, auch wenn der Editor bisher nie geöffnet war
    try { zoneRef.current.setZones(editor.zones as any); } catch {}
    // Stelle sicher, dass ZoneManager initial eine Position bekommt, auch bevor Colyseus onLocalMove feuert
    gameBridge.onLocalMove = (p) => {
      localPosRef.current.x = p.x;
      localPosRef.current.y = p.y;
      zoneRef.current?.update({ x: p.x, y: p.y });
      if (followRef.current) {
        const f = followRef.current.update(
          { x: p.x, y: p.y },
          remotesRef.current
        );
        if (f.following) {
          gameBridge.setDesiredPosition({ x: f.x, y: f.y });
        } else {
          gameBridge.setDesiredPosition(null);
        }
      }
      colyseusRef.current?.send?.('move', p);
    };
    volumeRef.current = new VolumeManager(
      { setParticipantVolume: (sid, vol) => avRef.current?.setParticipantVolume(sid, vol) },
      {
        getLocal: () => localPosRef.current.id ? { id: localPosRef.current.id, x: localPosRef.current.x, y: localPosRef.current.y } : null,
        getRemotes: () => remotesRef.current,
        getZones: () => zoneRef.current?.getZones?.() || [],
        getFollowTarget: () => followRef.current?.getTarget?.() || null,
        getBubbleMembers: () => bubbleMembersRef.current,
      },
      { nearRadius: 96, farRadius: 384, outsideBubbleAttenuation: 0.15 }
    );
    // Direkt nach Szenenstart versuchen, lokal gespeicherte Editor-Layer zu laden
    setTimeout(() => { try { gameBridge.reloadEditorLayers(); } catch {} }, 0);
    // Editor-Click-Handler
    gameBridge.onPointerDown = ({ x, y }) => {
      setEditor(prev => {
        if (!prev.active) return prev;
        if (prev.tool === 'asset' && prev.pendingAsset) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          const asset = { id, key: prev.pendingAsset.key + ':' + id, dataUrl: prev.pendingAsset.dataUrl, x, y };
          const assets = [...prev.assets, asset];
          try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
          gameBridge.setEditorAssets(assets);
          return { ...prev, assets, pendingAsset: null };
        }
        return prev;
      });
    };
    // Tile-basierte Selektion/Malen
    gameBridge.onPointerDownTile = ({ tileX, tileY }) => {
      setEditor(s => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY } }));
      const tw = 16, th = 16;
      gameBridge.setSelectionRect({ x: tileX * tw, y: tileY * th, w: tw, h: th });
    };
    gameBridge.onPointerMoveTile = ({ tileX, tileY }) => {
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        const x0 = Math.min(drag.startTileX, drag.endTileX);
        const y0 = Math.min(drag.startTileY, drag.endTileY);
        const w = Math.abs(drag.endTileX - drag.startTileX) + 1;
        const h = Math.abs(drag.endTileY - drag.startTileY) + 1;
        gameBridge.setSelectionRect({ x: x0 * 16, y: y0 * 16, w: w * 16, h: h * 16 });
        return { ...s, drag };
      });
    };
    gameBridge.onPointerUpTile = ({ tileX, tileY }) => {
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        const rect = { startX: drag.startTileX, startY: drag.startTileY, endX: drag.endTileX, endY: drag.endTileY };
        gameBridge.setSelectionRect(null);
        const isErase = s.tool === 'erase';
        if ((s.tool === 'paint' || isErase) && s.tilePaint) {
          const index = isErase ? -1 : s.tilePaint.tileIndex;
          gameBridge.applyTilePaint({ layer: 'EditorGround', tilesetKey: s.tilePaint.tilesetKey, tileIndex: index, rect });
        }
        if (s.tool === 'collision' || isErase) {
          // Kollisionen als solide (Tile-Index 1) markieren; konkrete Indexe hängen vom Tileset ab
          const index = isErase ? -1 : 1;
          gameBridge.applyTilePaint({ layer: 'Collision', tilesetKey: 'collision_tiles', tileIndex: index, rect });
        }
        if (s.tool === 'zone') {
          const x0 = Math.min(rect.startX, rect.endX) * 16;
          const y0 = Math.min(rect.startY, rect.endY) * 16;
          const x1 = (Math.max(rect.startX, rect.endX) + 1) * 16;
          const y1 = (Math.max(rect.startY, rect.endY) + 1) * 16;
          const name = (s.name || `Zone ${s.zones.length+1}`).trim();
          const poly = { name, points: [ {x:x0,y:y0}, {x:x1,y:y0}, {x:x1,y:y1}, {x:x0,y:y1} ] };
          const zones = [...s.zones, poly];
          try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
          gameBridge.setZoneOverlay(zones);
          zoneRef.current?.setZones?.(zones as any);
          // Server speichern (best-effort)
          (async ()=>{ try { await fetch(`${apiBase}/maps/office/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zones }) }); } catch {} })();
          return { ...s, zones, drag: null };
        }
        return { ...s, drag: null };
      });
    };

    const hudTimer = setInterval(() => {
      const z = zoneRef.current?.getCurrent?.();
      const next: { zone?: string; follow?: string | null; avRoom?: string | null } = {
        follow: followRef.current?.getTarget?.() ?? null,
        avRoom: avRef.current?.activeRoom ?? null,
      };
      if (typeof z === 'string') next.zone = z;
      setHud(next);

      const room: any = avRef.current?.room as any;
      if (room && room.localParticipant && room.localParticipant.trackPublications) {
        const pubs = Array.from(room.localParticipant.trackPublications?.values?.() || []);
        const isVideoPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          const kind = pub?.kind ?? pub?.track?.kind;
          return (!!pub?.track && (kind === 'video' || source === 'camera' || source === 1));
        };
        const isMicPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          const kind = pub?.kind ?? pub?.track?.kind;
          return (!!pub?.track && (kind === 'audio' || source === 'microphone' || source === 0));
        };
        const isSharePub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          return (!!pub?.track && (source === 'screen_share' || source === 'screen_share_audio' || source === 2));
        };
        const hasMic = pubs.some(isMicPub);
        const hasCam = pubs.some(isVideoPub);
        const hasShare = pubs.some(isSharePub);
        setAvState(s => (s.mic === hasMic && s.cam === hasCam && s.share === hasShare) ? s : { ...s, mic: hasMic, cam: hasCam, share: hasShare });
        // Don't call buildParticipantList in the HUD timer - it's called by LiveKit events
      }
      // Lautstärke-Mix aktualisieren
      volumeRef.current?.update();
    }, 250);

    return () => {
      disposed = true;
      try { gameBridge.setSceneApi?.(null); } catch {}
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      try { avRef.current?.leave?.(); } catch {}
      if (!editorActiveRef.current) {
        window.removeEventListener('keydown', firstInteract);
        window.removeEventListener('pointerdown', firstInteract);
      }
      try { if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current); } catch {}
      clearInterval(hudTimer);
    };
  }, [authChecked, me, apiBase, buildParticipantList, page]);


  // Global Audio Track Manager - handles all remote participants' audio
  useEffect(() => {
    const room = avRef.current?.room as any;
    if (!room) return;

    const audioElements = new Map<string, HTMLAudioElement>();
    
    const attachAudioTrack = (track: any, participantId: string) => {
      try {
        const audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        audio.volume = 1.0;
        // Important: Add audio element to DOM for autoplay to work
        audio.style.display = 'none';
        document.body.appendChild(audio);
        track.attach(audio);
        audioElements.set(participantId, audio);
        if (DEBUG) console.log('[Audio] Attached audio track for', participantId);
      } catch (e) {
        console.error('[Audio] Failed to attach audio track:', e);
      }
    };

    const detachAudioTrack = (participantId: string) => {
      const audio = audioElements.get(participantId);
      if (audio) {
        audio.pause();
        audio.srcObject = null;
        // Remove from DOM
        if (audio.parentNode) {
          audio.parentNode.removeChild(audio);
        }
        audioElements.delete(participantId);
        if (DEBUG) console.log('[Audio] Detached audio track for', participantId);
      }
    };

    const handleTrackSubscribed = (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio' && participant.sid !== room.localParticipant?.sid) {
        attachAudioTrack(track, participant.sid);
      }
    };

    const handleTrackUnsubscribed = (track: any, publication: any, participant: any) => {
      if (track.kind === 'audio') {
        detachAudioTrack(participant.sid);
      }
    };

    // Initial setup for existing participants
    const participants = Array.from(room.remoteParticipants?.values() || room.participants?.values() || []);
    console.log('[Audio] Initial participants:', participants.map((p: any) => ({ sid: p.sid, identity: p.identity })));
    
    participants.forEach((participant: any) => {
      if (participant.sid === room.localParticipant?.sid) return;
      
      const audioTracks = Array.from(participant.trackPublications.values())
        .filter((pub: any) => pub.kind === 'audio' && pub.track)
        .map((pub: any) => pub.track);
      
      console.log('[Audio] Audio tracks for', participant.identity, ':', audioTracks.length);
      
      audioTracks.forEach((track: any) => {
        attachAudioTrack(track, participant.sid);
      });
    });

    // Subscribe to events
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
          room.on(RoomEvent.TrackUnsubscribed, handleTrackUnsubscribed);
        }
      } catch {}
    })();

    return () => {
      // Cleanup all audio elements
      audioElements.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;
        if (audio.parentNode) {
          audio.parentNode.removeChild(audio);
        }
      });
      audioElements.clear();
    };
  }, [avRef.current?.room]); // Re-run when room changes

  // Wenn aus dem Editor herausgegangen wird, LiveKit-Connect bei erster Interaktion erneut anbieten
  useEffect(() => {
    if (page !== 'world') return;
    if (!authChecked || !me) return;
    if (!connectLivekitRef.current) return;
    if (editorActiveRef.current) return; // nur wenn Editor aus
    const firstInteract = () => {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      try { connectLivekitRef.current?.(); } catch {}
    };
    window.addEventListener('pointerdown', firstInteract, { once: true } as any);
    window.addEventListener('keydown', firstInteract, { once: true } as any);
    return () => {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
    };
  }, [editor.active, page, authChecked, me]);

  // Wenn Editor-Zonen sich ändern, ins Game-Overlay + ZoneManager schieben
  useEffect(() => {
    // Zone-Overlay nur im Edit-Modus anzeigen
    const zonesToShow = editor.active ? editor.zones : [];
    gameBridge.setZoneOverlay(zonesToShow);
    // Aber: ZoneManager soll immer mit den echten Zonen arbeiten
    zoneRef.current?.setZones?.(editor.zones as any);
    // Assets nur im Edit-Modus anzeigen
    const assetsToShow = editor.active ? editor.assets : [];
    gameBridge.setEditorAssets(assetsToShow);
  }, [editor.active, editor.zones]);

  useEffect(() => {
    // Nur im Edit-Modus Assets rendern
    const assetsToShow = editor.active ? editor.assets : [];
    gameBridge.setEditorAssets(assetsToShow);
  }, [editor.active, editor.assets]);

  // Verlasse Edit-Modus: Kollision-Overlay aus
  useEffect(() => {
    if (!editor.active) {
      try { gameBridge.setCollisionVisible(false); } catch {}
    }
  }, [editor.active]);

  if (!authChecked) {
    return (
      <ThemeProvider>
        <div style={{display:'grid',placeItems:'center',height:'100vh'}}>Lade…</div>
      </ThemeProvider>
    );
  }
  if (!me) {
    return (
      <ThemeProvider>
        <AuthScreen baseUrl={apiBase} onDone={async () => { await fetchMe(); }} />
      </ThemeProvider>
    );
  }

  const participantsToRender = uiParticipants.length > 0
    ? uiParticipants
    : [{ sid: (avRef.current?.room?.localParticipant?.sid ?? 'local'), identity: me.name || me.email, hasVideo: false, hasMic: avState.mic, isSpeaking: false, media: 'camera' as const }];

  return (
    <ThemeProvider>
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      {page === 'world' && (
        <>
          {/* Participants Grid Overlay */}
          {(() => {
            const minCard = gridExpanded ? 480 : 260;
            const gap = gridExpanded ? 18 : 12;
            const count = participantsToRender.length || 1;
            const cols = Math.max(1, Math.min(count, gridExpanded ? 3 : 4));
            const buttonSpace = 44; // Platz für den Expand/Collapse-Button rechts
            const containerMax = Math.min(window.innerWidth * 0.96, cols * minCard + (cols - 1) * gap + 24 + buttonSpace);
            return (
              <div style={{ position: 'absolute', top: gridExpanded ? 0 : 10, left: '50%', transform: 'translateX(-50%)', zIndex: 20, width: containerMax }}>
                <div style={{ position: 'relative', background: gridExpanded ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 12, paddingRight: 12 + buttonSpace, backdropFilter: 'blur(6px)' }}>
                  <button onClick={() => setGridExpanded(e => !e)} title={gridExpanded ? 'Verkleinern' : 'Vergrößern'} style={{ position: 'absolute', top: 10, right: 10, padding: 6, width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer', zIndex: 2 }}>
                    {gridExpanded ? <CollapseIcon /> : <ExpandIcon />}
                  </button>
                  <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: gap, justifyItems: 'center', alignContent: 'start' }}>
                    {participantsToRender.map(p => (
                      <div key={p.sid} onClick={() => setSelectedSid(s => s === p.sid ? null : p.sid)} style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}>
                        <ParticipantCard part={p} roomGetter={getRoom} compact={!gridExpanded} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          <div
            ref={containerRef}
            onContextMenu={(e) => {
              e.preventDefault();
              // TODO: Echte Selektion per Klick-Target; aktuell einfacher Toggle mit erstem Remote
              const localId = localPosRef.current.id;
              const selected = Object.keys(remotesRef.current)[0];
              if (!selected) return;
              const set = bubbleMembersRef.current;
              if (set.has(localId) && set.has(selected)) {
                set.delete(localId); set.delete(selected);
              } else {
                set.add(localId); set.add(selected);
              }
            }}
            style={{ width: '100%', height: '100%' }}
          />

          {/* HUD (links oben klein) */}
          <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(0,0,0,0.45)', color: '#fff', padding: 8, borderRadius: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div>Zone: {hud.zone ?? '-'}</div>
            <div>AV: {hud.avRoom ?? 'lobby'}</div>
            <div>Following: {hud.follow ?? 'no'}</div>
          </div>
          {/* Single Card Fullscreen Overlay */}
          {selectedSid && (() => {
            const pick = participantsToRender.find(p => p.sid === selectedSid);
            if (!pick) return null;
            return (
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 30, backdropFilter: 'blur(2px)' }} onClick={() => { setSelectedSid(null); setOverlayZoom(1); }}>
                <div style={{ position:'absolute', top: 24, bottom: 24, left: 24, right: 24, display: 'grid', placeItems: 'center', overflow: 'auto', borderRadius: 12 }} onWheel={(e)=>{ if (e.ctrlKey || e.metaKey) { e.preventDefault(); const dir = e.deltaY > 0 ? -0.1 : 0.1; setOverlayZoom(z => Math.max(0.25, Math.min(4, +(z+dir).toFixed(2)))); } }}>
                  <ParticipantCard part={pick} roomGetter={getRoom} compact={false} full zoom={overlayZoom} />
                </div>
                {/* Zoom Controls */}
                <div style={{ position:'absolute', top: 24, right: 24, display:'flex', gap:8 }}>
                  <button title="Zoom -" onClick={(e)=>{e.stopPropagation(); setOverlayZoom(z=>Math.max(0.25, +(z-0.1).toFixed(2)));}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>-</button>
                  <button title="Reset" onClick={(e)=>{e.stopPropagation(); setOverlayZoom(1);}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>1x</button>
                  <button title="Zoom +" onClick={(e)=>{e.stopPropagation(); setOverlayZoom(z=>Math.min(4, +(z+0.1).toFixed(2)));}} style={{ padding:6, width:32, height:32, borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.55)', color:'#fff' }}>+</button>
                </div>
              </div>
            );
          })()}

          {/* Bottom Control Bar */}
          <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'rgba(17,17,20,0.75)', color: '#fff', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 8px 24px rgba(0,0,0,0.35)', backdropFilter: 'blur(8px)' }}>
            <button style={btnStyle(avState.mic)} onClick={async () => {
              const enabled = !avState.mic;
              await avRef.current?.setMicrophoneEnabled(enabled);
              setAvState(s => ({ ...s, mic: enabled }));
            }}>
              <MicIcon on={avState.mic} />
              <span style={btnLabelStyle}>Mic {avState.mic ? 'aus' : 'an'}</span>
            </button>

            <select style={selectStyle} disabled={!devices.mics.length} value={selectedMicId} onChange={async (e) => {
              const id = e.target.value;
              setSelectedMicId(id);
              await avRef.current?.useMicrophoneDevice(id);
            }}>
              <option value="" disabled>Mic wählen…</option>
              {devices.mics.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>

            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

            <button style={btnStyle(avState.cam)} onClick={async () => {
              const enabled = !avState.cam;
              try {
                await avRef.current?.setCameraEnabled(enabled);
                setAvState(s => ({ ...s, cam: enabled }));
              } catch (e) {
                console.error('[Camera Toggle] Failed:', e);
                // Revert state on error
                setAvState(s => ({ ...s, cam: !enabled }));
              }
            }}>
              <CamIcon on={avState.cam} />
              <span style={btnLabelStyle}>{avState.cam ? 'Kamera aus' : 'Kamera an'}</span>
            </button>

            <select style={selectStyle} disabled={!devices.cams.length} value={selectedCamId} onChange={async (e) => {
              const id = e.target.value;
              setSelectedCamId(id);
              await avRef.current?.useCameraDevice(id);
            }}>
              <option value="" disabled>Kamera wählen…</option>
              {devices.cams.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>

            <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.08)' }} />

            <button style={btnStyle(avState.share)} onClick={async () => {
              if (!avState.share) {
                await avRef.current?.startScreenshare();
              } else {
                await avRef.current?.stopScreenshare();
              }
              setAvState(s => ({ ...s, share: !s.share }));
            }}>
              <ScreenIcon on={avState.share} />
              <span style={btnLabelStyle}>{avState.share ? 'Screenshare stoppen' : 'Screenshare starten'}</span>
            </button>
          </div>
        </>
      )}

      {page === 'users' && (
        <div style={{ position: 'absolute', inset: 0, padding: 16 }}>
          <AppShell title="Benutzerverwaltung" right={<div style={{ display:'flex', gap:8 }}><ThemeToggleButton /><button onClick={()=>setMenuOpen(v=>!v)} title="Einstellungen" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}><GearIcon /></button></div>}>
            <UserManagement baseUrl={apiBase} onBack={() => setPage('world')} />
          </AppShell>
        </div>
      )}

      {/* Profil-Seite ist (noch) nicht implementiert; Stub entfernt */}

      {/* Settings & Theme (oben rechts) */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 40, display: 'flex', gap: 8 }}>
        <ThemeToggleButton />
        <button onClick={() => setMenuOpen(v => !v)} title="Einstellungen" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
          <GearIcon />
        </button>
        {menuOpen && (
          <div style={{ position: 'absolute', top: 44, right: 0, background: 'var(--glass)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, padding: 8, display: 'grid', gap: 6, minWidth: 220, boxShadow: 'var(--shadow)', backdropFilter: 'blur(6px)' }}>
            <button onClick={() => { setPage('users'); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Benutzer verwalten</button>
            {/* <button onClick={() => { setPage('profile'); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Mein Profil</button> */}
            <button onClick={() => { setPage('world'); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Zurück zur Welt</button>
            <button onClick={async () => { if (editor.active) { await saveAllToServer().catch(()=>{}); } setEditor(s => ({ ...s, active: !s.active })); setMenuOpen(false); gameBridge.setZoneOverlay(editor.zones); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: editor.active ? 'rgba(16,185,129,0.18)' : 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>{editor.active ? 'Editor beenden' : 'Map-Editor öffnen'}</button>
            <button onClick={async () => { try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { setMe(null); setMenuOpen(false); setPage('world'); } }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Logout</button>
          </div>
        )}
      </div>

      {/* Editor Panel */}
      {editor.active && (
        <div style={{ position: 'absolute', top: 64, right: 12, zIndex: 35, width: 320 }}>
          <div style={{ background: 'rgba(17,17,20,0.9)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 10, color: '#fff', display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Map-Editor</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'zone' }))} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='zone'?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)', color: '#fff' }}>Zone</button>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'asset' }))} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='asset'?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)', color: '#fff' }}>Asset</button>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'select' }))} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='select'?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)', color: '#fff' }}>Select</button>
              <button onClick={() => setEditor(s => ({ ...s, tool: 'paint' }))} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='paint'?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)', color: '#fff' }}>Boden malen</button>
              <button onClick={() => { setEditor(s => ({ ...s, tool: 'collision' })); gameBridge.setCollisionVisible(true); }} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: editor.tool==='collision'?'rgba(255,255,255,0.14)':'rgba(255,255,255,0.06)', color: '#fff' }}>Kollision</button>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#e5e7eb' }}>Zonenname</label>
              <input value={editor.name} onChange={(e)=>setEditor(s=>({ ...s, name: e.target.value }))} placeholder="z.B. Meeting A" style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
            </div>
            {/* Kollision Overlay Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input id="toggle-collision" type="checkbox" defaultChecked={true} onChange={(e)=>gameBridge.setCollisionVisible(e.target.checked)} />
              <label htmlFor="toggle-collision" style={{ fontSize: 12, color: '#e5e7eb' }}>Kollision anzeigen</label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setEditor(s => { const next = { ...s, tempPoints: [] }; gameBridge.setZoneOverlay([...next.zones]); return next; })} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>Punkte zurücksetzen</button>
              <button onClick={() => setEditor(s => {
                if (s.tempPoints.length < 3) return s;
                const name = (s.name || `Zone ${s.zones.length+1}`).trim();
                const poly = { name, points: s.tempPoints };
                const zones = [...s.zones, poly];
                try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
                gameBridge.setZoneOverlay(zones);
                zoneRef.current?.setZones?.(zones as any);
                // Server speichern (best-effort)
                (async ()=>{ try { await fetch(`${apiBase}/maps/office/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zones }) }); } catch {} })();
                return { ...s, zones, tempPoints: [], name };
              })} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.18)', color: '#fff' }}>Zone speichern</button>
            </div>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Klicke in die Karte, um Punkte zu setzen (Zone), oder platziere hochgeladene Assets (Asset).</div>
            {/* Asset Upload */}
            <div style={{ display: 'grid', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#e5e7eb' }}>Asset hochladen</label>
              <input type="file" accept="image/*" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const buf = await file.arrayBuffer();
                const base64 = await new Promise<string>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(new Blob([buf], { type: file.type || 'image/png' }));
                });
                const key = `upload-${Date.now()}`;
                setEditor(s => ({ ...s, tool: 'asset', pendingAsset: { key, dataUrl: base64 }, tilePaint: s.tilePaint ? { ...s.tilePaint, tilesetKey: s.tilePaint.tilesetKey || key } : { tilesetKey: key, tileIndex: 1, tileWidth: 16, tileHeight: 16 } }));
              }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
              {editor.pendingAsset && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 12, color: '#9ca3af' }}>Klicke in die Karte, um das Asset zu platzieren…</div>
                  <img src={editor.pendingAsset.dataUrl} alt="preview" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' }} />
                </div>
              )}
              {editor.assets.length > 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 600 }}>Assets</div>
                  <div style={{ maxHeight: 160, overflow: 'auto', display: 'grid', gap: 6 }}>
                    {editor.assets.map((a) => (
                      <div key={a.id} className="glass-surface" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderRadius: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <img src={a.dataUrl} alt="asset" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, border: '1px solid rgba(255,255,255,0.12)' }} />
                          <div style={{ fontSize: 11, color: '#9ca3af' }}>x:{Math.round(a.x)} y:{Math.round(a.y)}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button title="Anzeigen" onClick={() => gameBridge.setEditorAssets([a])} style={{ padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>👁</button>
                          <button title="Löschen" onClick={() => setEditor(s => {
                            const assets = s.assets.filter(x => x.id !== a.id);
                            try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
                            gameBridge.setEditorAssets(assets);
                            return { ...s, assets };
                          })} style={{ padding: 6, borderRadius: 8, border: '1px solid rgba(244,63,94,0.45)', background: 'rgba(244,63,94,0.22)', color: '#fff' }}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Boden malen: einfache Tileset-Auswahl + Index */}
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>Boden / Tiles</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input placeholder="Tileset-Key (z.B. floors_tiles)" value={editor.tilePaint?.tilesetKey || ''} onChange={(e)=>{
                  const tilesetKey = e.target.value || 'office_tiles';
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tileIndex: 1, tileWidth: 16, tileHeight: 16 }), tilesetKey } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
                <input type="number" min={0} max={4096} value={editor.tilePaint?.tileIndex ?? 1} onChange={(e)=>{
                  const tileIndex = Math.max(0, Math.min(4096, parseInt(e.target.value||'0',10)));
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tilesetKey: 'office_tiles', tileWidth: 16, tileHeight: 16 }), tileIndex } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                <input type="number" min={8} max={64} value={editor.tilePaint?.tileWidth ?? 16} onChange={(e)=>{
                  const tileWidth = Math.max(4, Math.min(256, parseInt(e.target.value||'16',10)));
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tilesetKey: 'office_tiles', tileIndex: 1, tileHeight: 16 }), tileWidth } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
                <input type="number" min={8} max={64} value={editor.tilePaint?.tileHeight ?? 16} onChange={(e)=>{
                  const tileHeight = Math.max(4, Math.min(256, parseInt(e.target.value||'16',10)));
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tilesetKey: 'office_tiles', tileIndex: 1, tileWidth: 16 }), tileHeight } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
                <input type="number" min={0} max={16} placeholder="margin" value={editor.tilePaint?.margin ?? 0} onChange={(e)=>{
                  const margin = Math.max(0, Math.min(64, parseInt(e.target.value||'0',10)));
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tilesetKey: 'office_tiles', tileIndex: 1, tileWidth: 16, tileHeight: 16 }), margin } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
                <input type="number" min={0} max={16} placeholder="spacing" value={editor.tilePaint?.spacing ?? 0} onChange={(e)=>{
                  const spacing = Math.max(0, Math.min(64, parseInt(e.target.value||'0',10)));
                  setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint || { tilesetKey: 'office_tiles', tileIndex: 1, tileWidth: 16, tileHeight: 16 }), spacing } }));
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => {
                  const p = editor.tilePaint;
                  if (!p) return;
                  // Tileset anhand eines zuvor hochgeladenen Bildes aus der Asset-Pipeline registrieren
                  // Falls du statt Upload eine URL hast, könntest du ebenfalls dataUrl setzen.
                  // Hier verwenden wir pendingAsset, falls gesetzt, sonst ignorieren wir.
                  const source = editor.pendingAsset?.dataUrl;
                  if (!source) return;
                  const k = p.tilesetKey || `ts-${Date.now()}`;
                  gameBridge.registerTileset({ key: k, dataUrl: source, tileWidth: p.tileWidth || 16, tileHeight: p.tileHeight || 16, margin: p.margin || 0, spacing: p.spacing || 0 });
                  // In die lokale Tileset-Bibliothek aufnehmen
                  setEditor(s => {
                    const next = { key: k, dataUrl: source, tileWidth: p.tileWidth || 16, tileHeight: p.tileHeight || 16, margin: p.margin || 0, spacing: p.spacing || 0 };
                    const tilesets = [...(s.tilesets||[])];
                    if (!tilesets.find(t => t.key === k)) tilesets.push(next);
                    try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(tilesets)); } catch {}
                    return { ...s, tilesets, tilePaint: { ...(s.tilePaint as any), tilesetKey: k } };
                  });
                }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>Tileset aus Upload registrieren</button>
              </div>
              {/* Visuelle Kachel-Palette */}
              {(() => {
                const p = editor.tilePaint;
                if (!p) return null;
                const lib = (editor.tilesets||[]).find(t => t.key === p.tilesetKey);
                if (!lib) return null;
                return (
                  <TilesetPreview
                    tileset={lib}
                    selectedIndex={p.tileIndex}
                    onSelect={(index: number) => setEditor(s => ({ ...s, tilePaint: { ...(s.tilePaint as any), tileIndex: index } }))}
                  />
                );
              })()}
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Ziehen mit der Maus, um eine Rechteck-Auswahl zu malen. Wähle die Kachel per Klick in der Vorschau.</div>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ fontWeight: 600 }}>Zonen</div>
              <div style={{ maxHeight: 160, overflow: 'auto', display: 'grid', gap: 6 }}>
                {editor.zones.map((z, idx) => (
                  <div key={idx} className="glass-surface" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 8, borderRadius: 8 }}>
                    <div style={{ display: 'grid' }}>
                      <div>{z.name}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>{z.points.length} Punkte</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button title="Anzeigen" onClick={() => gameBridge.setZoneOverlay([z])} style={{ padding: 6, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>👁</button>
                      <button title="Löschen" onClick={() => setEditor(s => {
                        const zones = s.zones.filter((_, i) => i !== idx);
                        try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
                        gameBridge.setZoneOverlay(zones);
                        zoneRef.current?.setZones?.(zones as any);
                        return { ...s, zones };
                      })} style={{ padding: 6, borderRadius: 8, border: '1px solid rgba(244,63,94,0.45)', background: 'rgba(244,63,94,0.22)', color: '#fff' }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { try { localStorage.removeItem('meetropolis.zones'); } catch {}; setEditor(s => ({ ...s, zones: [] })); gameBridge.setZoneOverlay([]); zoneRef.current?.setZones?.([] as any); }} style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid rgba(244,63,94,0.45)', background: 'rgba(244,63,94,0.22)', color: '#fff' }}>Alle löschen</button>
                <button onClick={() => { try { const raw = localStorage.getItem('meetropolis.zones'); if (raw) { const parsed = JSON.parse(raw)||[]; setEditor(s=>({ ...s, zones: parsed })); gameBridge.setZoneOverlay(parsed); zoneRef.current?.setZones?.(parsed as any); } } catch {} }} style={{ padding: 8, borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: '#fff' }}>Lokal laden</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </ThemeProvider>
  );
}

// Styles
const btnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px', borderRadius: 10,
  background: active ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.06)',
  border: `1px solid ${active ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.08)'}`,
  color: '#fff', cursor: 'pointer',
  outline: 'none',
});
const btnLabelStyle: React.CSSProperties = { fontSize: 12, letterSpacing: 0.2 }; 
const selectStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  color: '#fff',
  borderRadius: 8,
  padding: '6px 8px',
  fontSize: 12,
};

// Teilnehmer-Card-Komponente (verschönert)
function ParticipantCard(props: { part: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera'|'screen' }, roomGetter: () => any | undefined, compact?: boolean, full?: boolean, zoom?: number }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, compact, full, zoom = 1 } = props;
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);

  useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;
    console.log('[UI] ParticipantCard mount for', part.identity, 'sid=', part.sid);
    let baseSid = (part.sid || '').split(':')[0];
    const isLocalNow = room.localParticipant?.sid === baseSid;
    setIsLocal(isLocalNow);
    console.log('[UI] Looking for participant:', { baseSid, isLocal: isLocalNow, localSid: room.localParticipant?.sid });
    let p: any = isLocalNow ? room.localParticipant : (room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid));
    
    // If not found by SID, try to match by identity
    if (!p && !isLocalNow) {
      const allParticipants = Array.from(room.remoteParticipants?.values() || []);
      console.log('[UI] Participant not found by SID, trying identity match. Available:', allParticipants.map((p: any) => ({ sid: p.sid, identity: p.identity })));
      
      p = allParticipants.find((participant: any) => participant.identity === part.identity);
      if (p) {
        console.log('[UI] Found participant by identity match:', { identity: part.identity, actualSid: p.sid });
        // Update baseSid for event matching
        baseSid = p.sid;
      }
    }
    
    if (!p || !p.trackPublications) {
      console.log('[UI] Participant not found or no publications:', { found: !!p, hasPubs: !!p?.trackPublications });
      return;
    }
    const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
    console.log('[UI] Track publications for', part.identity, ':', pubs.map(pub => ({
      source: pub?.source || pub?.track?.source,
      kind: pub?.kind || pub?.track?.kind,
      hasTrack: !!pub?.track
    })));
    const wantedPub = pubs.find(pub => {
      const src = (pub?.source || pub?.track?.source);
      if (part.media === 'screen') return src === 'screen_share';
      return src === 'camera';
    });
    const track = wantedPub?.track;
    console.log('[UI] Wanted track for', part.identity, ':', { found: !!track, source: wantedPub?.source || wantedPub?.track?.source });
    let cleanup: (() => void) | undefined;
    let pollTimer: any;

    const onLoaded = () => {
      try {
        // Wenn Frames gerendert werden, sollte readyState > 2 sein
        if (el.readyState >= 2) setIsVideoRendering(true);
      } catch {}
    };
    const onPlaying = () => setIsVideoRendering(true);
    const onEmptied = () => setIsVideoRendering(false);
    el.addEventListener('loadeddata', onLoaded);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('emptied', onEmptied);

    if (track && el) {
      try {
        console.log('[UI] attach initial track for', part.identity, 'track:', track);
        track.attach(el);
        cleanup = () => { try { track.detach(el); } catch {} };
        // Check if video is actually playing
        setTimeout(() => {
          if (el.videoWidth > 0 && el.videoHeight > 0) {
            console.log('[UI] Video playing for', part.identity, el.videoWidth + 'x' + el.videoHeight);
          } else {
            console.log('[UI] Video NOT playing for', part.identity);
          }
        }, 500);
      } catch (e) {
        console.error('[UI] Failed to attach track:', e);
      }
    } else {
      console.log('[UI] No track or element for', part.identity, 'track:', !!track, 'el:', !!el);
    }

    // Aggressiver Fallback: pollt kurzzeitig und versucht zu attachen, wenn Track verzögert verfügbar wird
    const tryAttach = () => {
      try {
        const pubsNow: any[] = Array.from(p.trackPublications?.values?.() || []);
        const cam = pubsNow.find(pub => {
          const src = (pub?.source || pub?.track?.source);
          if (part.media === 'screen') return src === 'screen_share';
          return src === 'camera';
        });
        const t = cam?.track;
        if (t && el && !el.srcObject) {
          try { 
            console.log('[UI] poll attach for', part.identity, 'track:', t);
            t.attach(el); 
            setIsVideoRendering(false); 
            clearInterval(pollTimer);
            // Check video status after attach
            setTimeout(() => {
              if (el.videoWidth > 0 && el.videoHeight > 0) {
                console.log('[UI] Video playing after poll attach for', part.identity);
              }
            }, 500);
          } catch (e) {
            console.error('[UI] Poll attach failed:', e);
          }
        }
      } catch {}
    };
    pollTimer = setInterval(tryAttach, 400);
    setTimeout(() => { try { clearInterval(pollTimer); } catch {} }, 6000);

    // Fallback: auf spätere Publishes/Subscribes reagieren und (re-)attachen
    const onTrackSubscribed = (t: any, publication: any, participant: any) => {
      try {
        const src = (publication?.source || t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
        const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
        if (participant?.sid === baseSid && isDesired && el) {
          try { 
            console.log('[UI] onTrackSubscribed attach', part.identity, { src, kind: t?.kind });
            el.muted = isLocalNow; 
            t.attach(el); 
            setIsVideoRendering(false);
            setTimeout(() => {
              if (el.videoWidth > 0 && el.videoHeight > 0) {
                console.log('[UI] Video playing after TrackSubscribed for', part.identity);
              } else {
                console.log('[UI] Video NOT playing after TrackSubscribed for', part.identity);
              }
            }, 500);
          } catch (e) {
            console.error('[UI] TrackSubscribed attach failed:', e);
          }
        } else {
          console.log('[UI] TrackSubscribed not matching', { participant: participant?.sid, baseSid, isDesired, hasEl: !!el });
        }
      } catch {}
    };
    const onTrackUnsubscribed = (t: any, _publication: any, participant: any) => {
      try {
        if (participant?.sid?.startsWith?.(baseSid) && el) {
          try { if (DEBUG) console.log('[UI] onTrackUnsubscribed detach', part.identity); t.detach(el); } catch {}
        }
      } catch {}
    };
    const onTrackPublished = (publication: any, participant: any) => {
      try {
        const src = (publication?.source || publication?.track?.source) as string | undefined;
        const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
        if (participant?.sid === baseSid && isDesired && publication?.track && el) {
          try { if (DEBUG) console.log('[UI] onTrackPublished attach', part.identity); publication.track.attach(el); setIsVideoRendering(false); } catch {}
        }
      } catch {}
    };
    // Event-Wiring über RoomEvent (LiveKit v2)
    (async () => {
      try {
        const mod = await import('livekit-client');
        const RoomEvent = (mod as any).RoomEvent;
        if (RoomEvent) {
          room.on?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
          room.on?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
          room.on?.(RoomEvent.TrackPublished, onTrackPublished);
          room.on?.(RoomEvent.LocalTrackPublished, (publication: any) => {
            try {
              const src = (publication?.source || publication?.track?.source) as string | undefined;
              if (isLocalNow && src === 'camera' && publication?.track && el) {
                try { el.muted = true; publication.track.attach(el); setIsVideoRendering(false); } catch {}
              }
            } catch {}
          });
        } else {
          // Fallback auf String-Events (ältere Clients)
          room.on?.('trackSubscribed', onTrackSubscribed);
          room.on?.('trackUnsubscribed', onTrackUnsubscribed);
          room.on?.('trackPublished', onTrackPublished);
          room.on?.('localTrackPublished', () => { try { if (isLocalNow && el) setTimeout(()=>setIsVideoRendering(false),0); } catch {} });
        }
      } catch {}
    })();
    return () => {
      const node = videoRef.current;
      try { node?.removeEventListener('loadeddata', onLoaded); } catch {}
      try { node?.removeEventListener('playing', onPlaying); } catch {}
      try { node?.removeEventListener('emptied', onEmptied); } catch {}
      cleanup?.();
      try { clearInterval(pollTimer); } catch {}
      try {
        const offAll = async () => {
          try {
            const mod = await import('livekit-client');
            const RoomEvent = (mod as any).RoomEvent;
            if (RoomEvent) {
              room.off?.(RoomEvent.TrackSubscribed, onTrackSubscribed);
              room.off?.(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
              room.off?.(RoomEvent.TrackPublished, onTrackPublished);
              room.off?.(RoomEvent.LocalTrackPublished, () => {});
            } else {
              room.off?.('trackSubscribed', onTrackSubscribed);
              room.off?.('trackUnsubscribed', onTrackUnsubscribed);
              room.off?.('trackPublished', onTrackPublished);
              room.off?.('localTrackPublished', () => {});
            }
          } catch {}
        };
        offAll();
      } catch {}
    };
  }, [part.sid, part.hasVideo, roomGetter]);

  const borderColor = part.isSpeaking ? '#22d3ee' : 'rgba(255,255,255,0.10)';
  const glow = part.isSpeaking ? '0 0 0 2px rgba(34,211,238,0.35), 0 12px 30px rgba(34,211,238,0.25)' : '0 12px 30px rgba(0,0,0,0.35)';
  const bg = 'rgba(17,17,20,0.75)';
  const headerBg = 'rgba(17,17,20,0.6)';
  const badgeOn = 'rgba(16,185,129,0.25)';
  const badgeOff = 'rgba(244,63,94,0.25)';
  const borderOn = 'rgba(16,185,129,0.5)';
  const borderOff = 'rgba(244,63,94,0.5)';

  // Größenlogik:
  // - Kamera: in der kleinen Ansicht quadratisch, groß etwas höher
  // - Screenshare: soll nicht abgeschnitten werden -> 16:9 in klein, 16:9 in groß
  const isScreen = part.media === 'screen';
  const aspect = full ? undefined : (isScreen ? '16 / 9' : '1 / 1');
  const targetSize = full ? undefined : (compact ? '16vh' : '36vh');
  const minW = full ? undefined : (compact ? 260 : 420);

  return (
    <div style={{
      width: full ? 'min(calc(100vw - 64px), 1920px)' : `min(${targetSize}, 100%)`,
      minWidth: minW as any,
      maxHeight: full ? 'calc(100vh - 64px)' : (targetSize as any),
      aspectRatio: aspect as any,
      position: 'relative', borderRadius: 14, overflow: 'hidden', background: bg, border: `1px solid ${borderColor}`, boxShadow: glow
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: full ? 'auto' : '100%', maxHeight: full ? 'calc(100vh - 64px)' : undefined, objectFit: isScreen ? 'contain' : (full ? 'contain' : 'cover'), background: 'rgba(0,0,0,0.35)', transform: (isLocal && part.media==='camera') ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`, transformOrigin: 'center center' }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#e5e7eb', fontWeight: 600, fontSize: 14 }}>
          {part.identity}
        </div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: headerBg, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 12, color: '#e5e7eb', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.identity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 8 }}>
        <div title={part.hasMic ? 'Mikro an' : 'Mikro aus'} style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: part.hasMic ? badgeOn : badgeOff, border: `1px solid ${part.hasMic ? borderOn : borderOff}` }}>
          <MicIcon on={part.hasMic} />
        </div>
        <div title={part.hasVideo ? 'Kamera an' : 'Kamera aus'} style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: (part.hasVideo || isVideoRendering) ? badgeOn : badgeOff, border: `1px solid ${(part.hasVideo || isVideoRendering) ? borderOn : borderOff}` }}>
          <CamIcon on={(part.hasVideo || isVideoRendering)} />
        </div>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" stroke="#e5e7eb" strokeWidth="1.8"/>
      <path d="M4 12c0-.5.04-.98.12-1.45l-1.9-1.1 2-3.46 1.9 1.1c.72-.6 1.54-1.07 2.43-1.37V3h4v2.72c.89.3 1.7.77 2.43 1.37l1.9-1.1 2 3.46-1.9 1.1c.08.47.12.95.12 1.45s-.04.98-.12 1.45l1.9 1.1-2 3.46-1.9-1.1c-.72.6-1.54 1.07-2.43 1.37V21h-4v-2.72c-.89-.3-1.7-.77-2.43-1.37l-1.9 1.1-2-3.46 1.9-1.1A8.8 8.8 0 0 1 4 12Z" stroke="#e5e7eb" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function UserManagement(props: { baseUrl: string; onBack: () => void }) {
  const { baseUrl, onBack } = props;
  const [loading, setLoading] = React.useState(true);
  const [users, setUsers] = React.useState<{ id: string; email: string; name?: string; createdAt?: string }[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [edit, setEdit] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newEmail, setNewEmail] = React.useState('');
  const [newName, setNewName] = React.useState('');
  const [inviteCode, setInviteCode] = React.useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/users`, { credentials: 'include' });
      if (!res.ok) throw new Error('Fehler beim Laden');
      const list = await res.json();
      setUsers(list);
    } catch (e: any) {
      setError(e.message || 'Fehler');
    } finally {
      setLoading(false);
    }
  }

  async function save(u: { id: string; email: string; name?: string }) {
    try {
      const res = await fetch(`${baseUrl}/users/${u.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: u.email, name: u.name }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Update fehlgeschlagen');
      await load();
      setEdit(null);
    } catch (e: any) {
      setError(e.message || 'Fehler');
    }
  }

  async function remove(id: string) {
    if (!confirm('Benutzer wirklich löschen?')) return;
    try {
      const res = await fetch(`${baseUrl}/users/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json())?.error || 'Löschen fehlgeschlagen');
      await load();
    } catch (e: any) {
      setError(e.message || 'Fehler');
    }
  }

  React.useEffect(() => { load(); }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 16 }}>
      <Toolbar
        left={<>
          <Button onClick={onBack}>Zurück</Button>
          <div style={{ padding: '6px 10px', borderRadius: '999px', background: 'var(--glass)', border: '1px solid var(--border)', fontSize: 12, color: 'var(--fg-subtle)' }}>Admin</div>
        </>}
        right={<>
          <Button variant="primary" onClick={() => { setInviteCode(null); setNewEmail(''); setNewName(''); setCreateOpen(true); }}>Neuer Benutzer</Button>
        </>}
      />

      {error && <Card><div style={{ color: '#fca5a5' }}>{error}</div></Card>}
      {loading ? (
        <Card><div>Lade…</div></Card>
      ) : (
        <Card>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 180px', gap: 8, padding: 8, borderRadius: 10, fontWeight: 700, color: 'var(--fg-subtle)' }}>
              <div>E-Mail</div>
              <div>Name</div>
              <div>Aktionen</div>
            </div>
            {users.map(u => (
              <div key={u.id} className="glass-surface" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 180px', gap: 10, padding: 12, borderRadius: 12 }}>
                {edit?.id === u.id ? (
                  <>
                    <Input value={edit.email} onChange={e => setEdit({ ...(edit as any), email: e.target.value })} />
                    <Input value={edit.name ?? ''} onChange={e => setEdit({ ...(edit as any), name: e.target.value })} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button variant="primary" onClick={() => save(edit!)}>Speichern</Button>
                      <Button onClick={() => setEdit(null)}>Abbrechen</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center' }}>{u.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>{u.name ?? '—'}</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '' })}>Bearbeiten</Button>
                      <Button variant="danger" onClick={() => remove(u.id)}>Löschen</Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neuen Benutzer einladen" maxWidth={520} footer={<>
        <Button onClick={() => setCreateOpen(false)}>Abbrechen</Button>
        <Button variant="primary" onClick={async () => {
          setError(null);
          try {
            // Einladung erzeugen
            const res = await fetch(`${baseUrl}/auth/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: newEmail }) });
            if (!res.ok) throw new Error((await res.json())?.error || 'Fehler beim Einladen');
            const data = await res.json();
            setInviteCode(data.code || null);
            // offen lassen, damit Code kopiert werden kann
          } catch (e: any) {
            setError(e.message || 'Fehler');
          }
        }}>Einladung erstellen</Button>
      </>}>
        <div style={{ display: 'grid', gap: 10 }}>
          <Input placeholder="E-Mail-Adresse" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
          <Input placeholder="Name (optional)" value={newName} onChange={e => setNewName(e.target.value)} />
          {inviteCode && <div className="glass-surface" style={{ padding: 10, borderRadius: 10, display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
            <div>Einladungscode: <b>{inviteCode}</b></div>
            <Button onClick={() => { navigator.clipboard?.writeText(inviteCode); }}>Kopieren</Button>
          </div>}
          <div style={{ fontSize: 12, color: 'var(--fg-subtle)' }}>Der eingeladene Nutzer erhält einen Code. Mit diesem kann er sich selbst registrieren.</div>
        </div>
      </Modal>
    </div>
  );
}

function AuthScreen(props: { baseUrl: string; onDone: () => void }) {
  const { baseUrl, onDone } = props;
  const [view, setView] = React.useState<'login'|'register'|'forgot'|'reset'>('login');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [name, setName] = React.useState('');
  const [invite, setInvite] = React.useState('');
  const [token, setToken] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);

  async function post(path: string, body: any) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json())?.error || 'Fehler');
    return await res.json().catch(() => ({}));
  }

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 12, width: 360 };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'grid', placeItems: 'center' }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontWeight: 800, fontSize: 18, background: 'var(--gradient)', WebkitBackgroundClip: 'text', color: 'transparent' as any }}>Welcome to Meetropolis</div>
          <ThemeToggleButton />
        </div>
        <div style={commonStyle}>
        {view === 'login' && (
          <>
            <h3 style={{ margin: 0 }}>Login</h3>
            <Input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <Input placeholder="Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ await post('/auth/login',{email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}>Einloggen</Button>
            <div style={{ display:'flex', justifyContent:'space-between' }}>
              <a style={{ cursor:'pointer' }} onClick={()=>setView('forgot')}>Passwort vergessen?</a>
              <a style={{ cursor:'pointer' }} onClick={()=>setView('register')}>Einladung einlösen</a>
            </div>
          </>
        )}
        {view === 'register' && (
          <>
            <h3 style={{ margin: 0 }}>Registrieren (Einladung nötig)</h3>
            <Input placeholder="Einladungscode" value={invite} onChange={e=>setInvite(e.target.value)} />
            <Input placeholder="Name (optional)" value={name} onChange={e=>setName(e.target.value)} />
            <Input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <Input placeholder="Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ await post('/auth/register',{code:invite,name,email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}>Registrieren</Button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'forgot' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort vergessen</h3>
            <Input placeholder="E-Mail" value={email} onChange={e=>setEmail(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ const r=await post('/auth/forgot',{email}); setMsg(`Reset-Token (Debug): ${r.token||'per Mail'}`); setView('reset'); } catch(e:any){ setMsg(e.message); } }}>Zurücksetzen anfordern</Button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {view === 'reset' && (
          <>
            <h3 style={{ margin: 0 }}>Passwort zurücksetzen</h3>
            <Input placeholder="Reset-Token" value={token} onChange={e=>setToken(e.target.value)} />
            <Input placeholder="Neues Passwort" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <Button variant="primary" onClick={async()=>{ try{ await post('/auth/reset',{token,password}); setView('login'); setMsg('Passwort aktualisiert'); } catch(e:any){ setMsg(e.message); } }}>Passwort speichern</Button>
            <a style={{ cursor:'pointer' }} onClick={()=>setView('login')}>Zurück zum Login</a>
          </>
        )}
        {msg && <div style={{ color:'#fca5a5' }}>{msg}</div>}
        </div>
      </Card>
    </div>
  );
}

/*
function ProfilePage(props: { baseUrl: string; me: { id: string; email: string; name?: string } | null; onBack: () => void; onUpdated: (u: { id: string; email: string; name?: string }) => void }) {
  const { baseUrl, me, onBack, onUpdated } = props;
  const [email, setEmail] = React.useState(me?.email || '');
  const [name, setName] = React.useState(me?.name || '');
  const [currentPassword, setCurrentPassword] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [msg, setMsg] = React.useState<string | null>(null);

  async function saveProfile() {
    setMsg(null);
    try {
      const res = await fetch(`${baseUrl}/me`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email, name }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Update fehlgeschlagen');
      const u = await res.json();
      onUpdated(u);
      setMsg('Profil aktualisiert');
    } catch (e: any) {
      setMsg(e.message || 'Fehler');
    }
  }

  async function changePassword() {
    setMsg(null);
    try {
      const res = await fetch(`${baseUrl}/auth/change`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ currentPassword, newPassword }) });
      if (!res.ok) throw new Error((await res.json())?.error || 'Passwortwechsel fehlgeschlagen');
      setCurrentPassword('');
      setNewPassword('');
      setMsg('Passwort aktualisiert');
    } catch (e: any) {
      setMsg(e.message || 'Fehler');
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', display: 'grid', gap: 16 }}>
      <Toolbar left={<Button onClick={onBack}>Zurück</Button>} />

      <Card title="Profil">
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 6 }}>E-Mail</div>
            <Input value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 6 }}>Name</div>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <Button variant="primary" onClick={saveProfile}>Speichern</Button>
          </div>
        </div>
      </Card>

      <Card title="Passwort ändern">
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 6 }}>Aktuelles Passwort</div>
            <Input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--fg-subtle)', marginBottom: 6 }}>Neues Passwort</div>
            <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <Button variant="primary" onClick={changePassword}>Passwort aktualisieren</Button>
          </div>
        </div>
      </Card>

      {msg && <div className="glass-surface" style={{ padding: 10, borderRadius: 12 }}>{msg}</div>}
    </div>
  );
}
*/
