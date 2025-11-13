import React, { useEffect, useRef } from 'react';
import { Modal, Button } from '../../ui/system';
import { UserManagement } from '../../ui/admin/UserManagement';
import { AuthScreen } from '../../ui/auth/AuthScreen';
import { Signup } from '../../ui/auth/Signup';
import { pointInPolygon } from '../../lib/geom';
import { getDisplayName as getDisplayNameLib } from '../../lib/displayName';
import { ThemeToggleButton } from '../../ui/theme';
// removed unused component imports from ui/components
import { AVBar } from '../../ui/av/AVBar';
import { RosterPanel } from '../../ui/user/RosterPanel';
import { BubbleBanner } from '../../ui/user/BubbleBanner';
import { Overlays } from '../layout/Overlays';
import { useParticipants } from '../../features/participants/useParticipants';
// presence merge now used via useRosterPresence hook
import { useRosterPresence } from '../../features/roster/useRosterPresence';
import { EditorWindow } from '../../features/editor/EditorWindow';
import { useEditorPointer } from '../../features/editor/useEditorPointer';
// HudPanel moved into Overlays
import { TopRightControls } from '../layout/TopRightControls';
import { ApiTokensOverlay } from '../../ui/admin/ApiTokensOverlay';
import { AdminOverlay } from '../../ui/admin/AdminOverlay';
import { TenantsAdminModal } from '../../features/admin/TenantsAdminModal';
import { InvitesModal } from '../../features/admin/InvitesModal';
import { useEditor } from '../../hooks/useEditor';
import { useApiTokensLoader } from '../../features/admin/useApiTokens';
import { useEditorBridge } from '../../editor/useEditorBridge';
import { useGlobalAudioTracks } from '../../av/useGlobalAudioTracks';
import { usePositionPersistence } from '../../hooks/usePositionPersistence';
import { useZones as useZonesSync } from '../../features/zones/useZones';
import { useHudTicker } from '../../features/hud/useHudTicker';
import { useBubbleNavigation } from '../../features/bubble/useBubbleNavigation';
import { useWorldRoom } from '../../realtime/useWorldRoom';
import { useLivekit } from '../../av/useLivekit';
import { createPhaserGame, destroyPhaserGame } from '../../game/phaserGame';
import { gameBridge } from '../../game/bridge';
import { joinWorld } from '../../lib/colyseus';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { AVManager } from '../../av/avManager';
import { useDoNotDisturbBridge } from '../../av/hooks/useDoNotDisturbBridge';
import { useDndShortcut } from '../../av/hooks/useDndShortcut';
import { BubbleManager } from '../../game/bubbleManager';
import { FollowManager } from '../../game/followManager';
import { ZoneManager } from '../../game/zoneManager';
import { VolumeManager } from '../../game/volumeManager';
import { ConnectionBanner } from '../../ui/system/ConnectionBanner';
 

export function WorldApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const colyseusReconnectAttemptsRef = useRef(0);
  const colyseusReconnectTimerRef = useRef<any>(null);
  // Reconnect-Handling liegt im WorldRoom-Hook
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<import('../../game/followManager').FollowManager | null>(null);
  const volumeRef = useRef<VolumeManager | null>(null);
  const bubbleMembersRef = useRef<Set<string>>(new Set());
  // removed unused right-click timers
  const localPosRef = useRef<{ id: string; x: number; y: number }>({ id: '', x: 0, y: 0 });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
  const colyseusToLivekitMap = useRef<Record<string, string>>({});
  const identityToNameMap = useRef<Record<string, string>>({});
  // const livekitSidToColyseusMap = useRef<Record<string, string>>({});
  const getDisplayName = (identity: string): string => getDisplayNameLib(identity, identityToNameMap.current, me);
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>({ mic: false, cam: false, share: false, dnd: false });
  const [selectedMicId, setSelectedMicId] = React.useState<string | ''>('');
  const [selectedCamId, setSelectedCamId] = React.useState<string | ''>('');
  const [uiParticipants, setUiParticipants] = React.useState<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[]>([]);
  const participantVolumesRef = useRef<Record<string, number>>({});
  const dndRef = useRef<boolean>(false);
  const [cameraManual, setCameraManual] = React.useState(false);
  // Admin/UI: Benutzer & Einladungen
  const [userModalOpen, setUserModalOpen] = React.useState(false);
  const [invitesModalOpen, setInvitesModalOpen] = React.useState(false);
  // Invites-Modal State wird im InvitesModal verwaltet
  // Roster (rechte Seitenleiste)
  const [roster, setRoster] = React.useState<Array<{ identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>>([]);
  const rosterByIdentityRef = React.useRef<Record<string, { name: string; x: number; y: number }>>({});
  React.useEffect(() => {
    const handler = (active: boolean) => setCameraManual(!!active);
    try { (gameBridge as any).onCameraManualChange = handler; } catch {}
    return () => { try { (gameBridge as any).onCameraManualChange = () => {}; } catch {} };
  }, []);
  // Positions-Persistenz (Throttle)
  const lastPositionPostAtRef = React.useRef(0);
  // API Base (früh deklarieren) – unterstützt Desktop-Query (?apiBase=...)
  const apiBase = getApiBaseFromWindow();

  // Participants logic (hook) moved below after state declarations

  
  // Map-Editor State (must be declared before any hooks that reference `editor`)
  const [editor, setEditor] = useEditor();

  // Intercept DND toggles to resume AV after DND is turned off
  useDoNotDisturbBridge(avRef);
  // (veraltet) Lokale No-Op-Teilnehmer-Helpers und früher WorldRoom-Aufruf entfernt; Nutzung erfolgt weiter unten mit den Hook-Funktionen
  // Auth state
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  // Blockiere Spiel-Start bis Position geladen/entschieden ist
  const [positionReady, setPositionReady] = React.useState(false);
  // API Tokens & Settings
  const [apiModalOpen, setApiModalOpen] = React.useState(false);
  const [apiTokens, setApiTokens] = React.useState<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]>([]);
  const [newTokenName, setNewTokenName] = React.useState('');
  const [freshToken, setFreshToken] = React.useState<string | null>(null);
  const [adminOpen, setAdminOpen] = React.useState(false);
  
  const [isInternalOwner, setIsInternalOwner] = React.useState(false);
  // view/state werden in AuthScreen verwaltet
  // Roster: periodisch letzte Präsenz (für Offline/"zuletzt online")
  useRosterPresence({ apiBase, authChecked, meId: me?.id ?? null, rosterByIdentityRef, setRoster, avRef });
  // Grid Overlay expand/collapse + selection
  const [gridExpanded, setGridExpanded] = React.useState(false);
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  // Connection status (Colyseus)
  const [connStatus, setConnStatus] = React.useState<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>({ reconnecting: false });
  // Simple view routing (removed legacy state)
  // Bubble UI state
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({ active: false, members: [] });
  // Pending bubble navigation until arrival near target
  const bubblePendingRef = React.useRef<{ targetId: string; dest?: { x: number; y: number } } | null>(null);
  // Kontextmenü State
  const [contextMenu, setContextMenu] = React.useState<{ open: boolean; x: number; y: number; playerId: string | null }>({ open: false, x: 0, y: 0, playerId: null });
  // Expose bubble start from effect to JSX
  const bubbleStartRef = React.useRef<null | ((id: string) => void)>(null);
  const disposedRef = React.useRef(false);
  const [page, setPage] = React.useState<'world' | 'admin' | string>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);
  // EditorWindow Drag/Dirty/Exit-Logik ausgelagert in <EditorWindow />
  const connectLivekitRef = React.useRef<null | (() => Promise<void>)>(null);
  // Single-run guards to prevent repeated re-inits/auto-connects
  const gameCreatedRef = React.useRef(false);
  const livekitAutoConnectOnceRef = React.useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  // apiBase declared earlier

  // Participants logic (hook)
  const { buildParticipantList: buildParticipantListHook, applyVolumesToUi: applyVolumesToUiHook } = useParticipants({
    avRef,
    zoneRef,
    localPosRef,
    remotesRef,
    colyseusToLivekitMap,
    identityToNameMap,
    volumeRef,
    me,
    setUiParticipants: (list) => setUiParticipants(list),
    disposedRef,
    getDisplayName,
    gameBridge,
  });
  const buildParticipantList = buildParticipantListHook;
  const applyVolumesToUi = applyVolumesToUiHook;

  // Debounce: Teilnehmerliste nur 1x pro Tick/kurzem Intervall neu bauen
  const buildListTimerRef = React.useRef<any>(null);
  const buildListRafRef = React.useRef<number | null>(null);
  const scheduleBuildParticipantList = React.useCallback((delay: number = 100) => {
    if (buildListTimerRef.current || buildListRafRef.current !== null) return;
    buildListTimerRef.current = setTimeout(() => {
      buildListTimerRef.current = null;
      buildListRafRef.current = requestAnimationFrame(() => {
        buildListRafRef.current = null;
        try { buildParticipantListHook(); } catch {}
      });
    }, Math.max(0, delay));
  }, [buildParticipantListHook]);
  React.useEffect(() => {
    return () => {
      try { if (buildListTimerRef.current) clearTimeout(buildListTimerRef.current); } catch {}
      try { if (buildListRafRef.current !== null) cancelAnimationFrame(buildListRafRef.current); } catch {}
    };
  }, []);

  

  // Laden der Tokenliste beim Öffnen des Modals (ausgelagert)
  useApiTokensLoader({ apiBase, open: apiModalOpen, setFreshToken, setApiTokens });
  // Map Editor State (moved to hook)
  const editorActiveRef = React.useRef(false);
  React.useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);
  // Editor Pointer Bridge
  useEditorBridge({ editor, setEditor, gameBridge });

  // Position-Persistenz (Hook auf Top-Level)
  usePositionPersistence({ apiBase, localPosRef, gameBridge });

  // Editor-Pointer-Logik (aus App extrahiert)
  useEditorPointer({ editor, setEditor, apiBase });

  // LiveKit-Verbindung via Hook (Top-Level, nicht in Effekten verwenden)
  useLivekit({
    apiBase,
    me,
    editorActiveRef,
    avRef,
    bubbleRef,
    zoneRef,
    setDevices,
    setSelectedMicId,
    setSelectedCamId,
    buildParticipantList: buildParticipantListHook,
    connectLivekitRef,
    livekitAutoConnectOnceRef,
    setAvState,
  });
  
  // Colyseus-Verbindung (ausgelagerter Hook)
  useWorldRoom({
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
    buildParticipantList: buildParticipantListHook,
    applyVolumesToUi: applyVolumesToUiHook,
    setBubbleUi,
    dndRef,
    setAvState,
    rosterByIdentityRef,
    setRoster,
    disposedRef,
    setConnectionStatus: setConnStatus,
  });
  
  // Collision-Overlay: Sichtbarkeit steuert ausschließlich der Edit-Mode

  // Room getter stabil hält die gleiche Referenz für Child-Komponenten
  const getRoom = React.useCallback(() => avRef.current?.room, []);

  async function fetchMe() {
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    try {
      // 1) Auth-Abfrage mit Backoff (Cookie-/Auth-Race nach Hard-Reload abfangen)
      const authBackoff = [0, 150, 300, 600, 1200, 2000];
      let user: any | null = null;
      for (let i = 0; i < authBackoff.length; i++) {
        if (i > 0) await sleep(authBackoff[i]);
        try {
          const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
          if (res.ok) {
            user = await res.json();
            break;
          }
        } catch {}
      }
      if (!user) {
        // Nicht eingeloggt → AuthScreen anzeigen
        setMe(null);
        return;
      }
      try { setIsInternalOwner(!!user.isInternalOwner); } catch {}

      // 2) Position ermitteln: bevorzugt vom Server, sonst lokaler Spawn als Fallback
      const applyPosition = (pos: { x: number; y: number } | null) => {
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          try { localPosRef.current = { id: user.id, x: pos.x, y: pos.y }; } catch {}
          try { (window as any).initialPlayerPosition = { x: pos.x, y: pos.y }; } catch {}
        }
      };

      const readLocalSpawn = (): { x: number; y: number } | null => {
        try {
          const raw = localStorage.getItem('meetropolis.spawn');
          if (!raw) return null;
          const sp = JSON.parse(raw);
          if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') return { x: sp.x, y: sp.y };
        } catch {}
        return null;
      };

      let posApplied = false;
      if (user.lastPosition && typeof user.lastPosition.x === 'number' && typeof user.lastPosition.y === 'number') {
        applyPosition({ x: user.lastPosition.x, y: user.lastPosition.y });
        posApplied = true;
      } else {
        // Kurzer Retry ausschließlich für Position (Server braucht evtl. einen Tick nach Auth)
        const posBackoff = [150, 300, 600, 1200];
        for (let i = 0; i < posBackoff.length && !posApplied; i++) {
          await sleep(posBackoff[i]);
          try {
            const res = await fetch(`${apiBase}/auth/me`, { credentials: 'include' });
            if (res.ok) {
              const next = await res.json();
              user = next; // aktualisieren (Name usw.)
              if (next.lastPosition && typeof next.lastPosition.x === 'number' && typeof next.lastPosition.y === 'number') {
                applyPosition({ x: next.lastPosition.x, y: next.lastPosition.y });
                posApplied = true;
                break;
              }
            }
          } catch {}
        }
        if (!posApplied) {
          // Fallback: lokaler Spawn (vom Editor gesetzt) falls vorhanden
          const localSpawn = readLocalSpawn();
          if (localSpawn) {
            applyPosition(localSpawn);
            posApplied = true;
          }
        }
      }

      // User erst setzen, wenn wir Position bestmöglich abgeholt haben
      setMe(user);
      setPositionReady(true);
    } catch {
      setMe(null);
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    fetchMe();
  }, [apiBase]);

  // Editor-Pointer-Handler sind via useEditorBridge ausgelagert

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
      
      // Asset-Packs laden
      try {
        (async () => {
          const res = await fetch(`${apiBase}/asset-packs`, { credentials: 'include' });
          if (res.ok) {
            const packs = await res.json();
            // Terrain-Tilesets aus Packs einfügen
            const packTilesets: any[] = [];
            const packItems: any[] = [];
            for (const p of packs || []) {
              const uuid = p.uuid;
              // Terrain → Tilesets registrieren
              for (const t of (p.terrain || [])) {
                packTilesets.push({
                  key: `${uuid}:${t.key}`,
                  dataUrl: t.dataURL,
                  tileWidth: t.tileWidth,
                  tileHeight: t.tileHeight,
                  margin: t.margin ?? 0,
                  spacing: t.spacing ?? 0,
                  category: 'terrain'
                });
              }
              // Terrain → auswählbare Terrain-Items (wie Objekte behandeln)
              for (const t of (p.terrain || [])) {
                packItems.push({ packUuid: uuid, itemId: t.id, key: t.key, category: 'terrain', dataUrl: t.dataURL, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
              }
              // Structures & Objects → auswählbare Items
              for (const s of (p.structures || [])) {
                packItems.push({ packUuid: uuid, itemId: s.id, key: s.key, category: 'structures', dataUrl: s.dataURL, width: s.width, height: s.height, collide: !!s.collide });
              }
              for (const o of (p.objects || [])) {
                packItems.push({ packUuid: uuid, itemId: o.id, key: o.key, category: 'objects', dataUrl: o.dataURL, width: o.width, height: o.height, collide: !!o.collide });
              }
            }
            if (packTilesets.length > 0) {
              // Merge mit Überschreiben: Pack-Definitionen ersetzen bestehende Einträge gleicher Keys
              setEditor(s => {
                const existing = s.tilesets || [];
                const merged = [...existing];
                for (const ts of packTilesets) {
                  const idx = merged.findIndex(m => m.key === ts.key);
                  if (idx >= 0) merged[idx] = ts; else merged.push(ts);
                }
                try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(merged)); } catch {}
                // Phaser-Registrierung beim Szenenstart über pendingTilesets
                (window as any).pendingTilesets = merged;
                return { ...s, tilesets: merged };
              });
              // Szene sofort über Bridge registrieren (asynchrones Laden vermeiden Timing-Probleme)
              try {
                for (const ts of packTilesets) {
                  gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0 });
                }
              } catch {}
            }
            setEditor(s => ({ ...s, packItems }));
          }
        })();
      } catch {}

      // Load layers from server on startup
      try {
        gameBridge.fetchAndApplyServerLayers();
      } catch (e) {
      }
      const rawTs = localStorage.getItem('meetropolis.tilesets');
      const defaultTs = [
        { key: 'office_tiles', dataUrl: '/assets/tilesets/office_tiles.png', tileWidth: 16, tileHeight: 16, category: 'terrain' },
        { key: 'furniture_tiles', dataUrl: '/assets/tilesets/furniture_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
        { key: 'decor_tiles', dataUrl: '/assets/tilesets/decor_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
      ];
      let tilesets = defaultTs;
      if (rawTs) {
        try { const parsed = JSON.parse(rawTs) || []; tilesets = [...defaultTs, ...parsed.filter((t:any)=>!defaultTs.find(d=>d.key===t.key))]; } catch {}
      }
      try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(tilesets)); } catch {}
      setEditor(s => ({ ...s, tilesets, tilePaint: { ...(s.tilePaint as any), tilesetKey: s.tilePaint?.tilesetKey || 'office_tiles' } }));
      // Tilesets zur späteren Registrierung speichern
      (window as any).pendingTilesets = tilesets;
      // Und sofortige Registrierung versuchen (falls Szene bereits läuft)
      try {
        for (const ts of tilesets) {
          gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: (ts as any).margin ?? 0, spacing: (ts as any).spacing ?? 0 });
        }
      } catch {}
      // Bereits vorhandene Editor-Layer sofort anwenden (falls vorhanden)
      try { gameBridge.reloadEditorLayers(); } catch {}
      // Server-state laden (best-effort) – bei 404 Map anlegen und lokalen Stand hochladen
      (async () => {
        try {
          const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
          const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, { credentials: 'include' });
          console.debug('[EDITOR] load server editor-state', { mapName, ok: res.ok, status: res.status });
          if (res.ok) {
            const data = await res.json();
            if (data?.tilesets) try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(data.tilesets)); } catch {}
            // Assets nur übernehmen, wenn der Server welche hat (nicht leere Antwort über lokale schreiben)
            if (Array.isArray(data?.assets) && data.assets.length > 0) {
              try { localStorage.setItem('meetropolis.assets', JSON.stringify(data.assets)); } catch {}
            }
            if (data?.zones) try {
              const zones = Array.isArray(data.zones) ? data.zones.map((z: any)=>{
                const anyZ = z || {};
                const pts = Array.isArray(anyZ.points)
                  ? anyZ.points
                  : Array.isArray(anyZ.polygon)
                    ? anyZ.polygon
                    : (anyZ.polygon && Array.isArray(anyZ.polygon.points))
                      ? anyZ.polygon.points
                      : [];
                return { name: anyZ.name, points: pts };
              }) : [];
              // Nur übernehmen/speichern, wenn es mindestens eine gültige Zone gibt
              if (zones.some((z: any) => Array.isArray((z as any).points) && (z as any).points.length > 0)) {
                localStorage.setItem('meetropolis.zones', JSON.stringify(zones));
                setEditor(s => ({ ...s, zones }));
                try { gameBridge.setZoneOverlay(zones); } catch {}
              }
            } catch {}
            if (typeof data?.backgroundColor === 'string') {
              try { localStorage.setItem('meetropolis.backgroundColor', data.backgroundColor); } catch {}
              setEditor(s => ({ ...s, backgroundColor: data.backgroundColor }));
              try { gameBridge.setBackgroundColor(data.backgroundColor); } catch {}
            }
            if (Array.isArray(data?.editorGround) || Array.isArray(data?.editorWalls) || Array.isArray(data?.collision)) {
              try { localStorage.setItem('meetropolis.editorLayers', JSON.stringify({ editorGround: data.editorGround, editorWalls: data.editorWalls, collision: data.collision, w: undefined, h: undefined })); } catch {}
              // Nach erfolgreichem Laden: direkt in Szene anwenden
              try { gameBridge.reloadEditorLayers(); } catch {}
            }
            if (Array.isArray(data?.assets) && data.assets.length > 0) {
              // Editor-Assets in UI/Scene anwenden (nur wenn vorhanden)
              setEditor(s => ({ ...s, assets: data.assets }));
              try { gameBridge.setEditorAssets(data.assets); } catch {}
            }
          } else if (res.status === 404) {
            // Map auf dem Server erzeugen mit lokalem Stand
            const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
            const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
            const zones = JSON.parse(localStorage.getItem('meetropolis.zones') || '[]');
            const layers = JSON.parse(localStorage.getItem('meetropolis.editorLayers') || '{}');
            const backgroundColor = localStorage.getItem('meetropolis.backgroundColor') || '#202020';
            // Server ist Source of Truth: Zonen nur mitsenden, wenn vorhanden
            const payload: any = { editorGround: layers.editorGround ?? null, collision: layers.collision ?? null, tilesets, assets, backgroundColor };
              if (Array.isArray(zones) && zones.some((z: any)=> Array.isArray((z as any)?.points) && (z as any).points.length > 0)) {
              payload.zones = zones;
              payload.replaceZones = true;
            }
            console.debug('[EDITOR] bootstrap create map editor-state', { mapName });
            const body = JSON.stringify(payload);
            if (body.length < 100000) {
              await fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body
              }).catch(()=>{});
            } else {
            }
            try { gameBridge.reloadEditorLayers(); } catch {}
          }
        } catch {}
      })();
    } catch {}
  }, []);

  // Reset von Auswahl beim Kategorienwechsel
  React.useEffect(() => {
    setEditor(s => {
      // Beim Wechsel der Kategorie: pendingAsset entfernen, Ghost-Vorschau entfernen
      try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch {}
      // Standard: Keine aktive Aktion nach Tab-Wechsel
      return { ...s, pendingAsset: null, tool: 'select' };
    });
  }, [editor.category]);

  // Tool-Wechsel: Asset-Ghost deaktivieren, wenn nicht 'asset'
  React.useEffect(() => {
    if (editor.tool !== 'asset') {
      try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch {}
    }
  }, [editor.tool]);

  

  async function saveAllToServer() {
    try {
      const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
      const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
      const zones = editor.zones;
      const backgroundColor = localStorage.getItem('meetropolis.backgroundColor') || '#202020';
      const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
      const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tilesets, assets, zones, backgroundColor })
      });
      if (!res.ok) {
        try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: `Server antwortete mit ${res.status}`, intent: 'error' } })); } catch {}
        return false;
      }
      // Notify other users to reload from server
      colyseusRef.current?.send?.('editor_update', { type: 'reload_all' });
      return true;
    } catch {
      try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: 'Netzwerk- oder Serverfehler', intent: 'error' } })); } catch {}
      return false;
    }
  }

  // Nutzerverwaltung als Overlay: Spiel/AV laufen weiter
  // (keine Pause mehr beim Wechsel auf 'users')

  

  // applyVolumesToUi via Hook

  useEffect(() => {
    // Suppression-Flag für Zonen-Broadcast (verhindert Echo bei eingehenden Updates)
  }, []);

  const suppressZoneBroadcastRef = React.useRef(false);

  useEffect(() => {
    if (!authChecked || !me) return;
    if (!containerRef.current) return;
    // Prevent multiple initializations causing WebGL context leaks / WS storms
    if (gameCreatedRef.current) return;
    gameCreatedRef.current = true;
    // Ensure container is clean before creating a new Phaser instance
    try { const el = containerRef.current; while (el && el.firstChild) { el.removeChild(el.firstChild); } } catch {}
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
        const positionToUse = localPosRef.current && (localPosRef.current.x !== undefined && localPosRef.current.y !== undefined) ? localPosRef.current : undefined;
        const room = await joinWorld(
          apiBase, 
          me.id, 
          me.name || me.email || me.id,
          positionToUse
        );
        if (disposed) { try { room.leave(); } catch {} return; }
        colyseusRef.current = room;
        colyseusReconnectAttemptsRef.current = 0;
        // Store LiveKit identity for cross-referencing, but keep Colyseus session ID for positioning
        const localLivekitIdentity = avRef.current?.room?.localParticipant?.identity || me.id;
        const colyseusSessionId = room.sessionId;
        
        // Map between Colyseus session ID and LiveKit identity for volume control
        colyseusToLivekitMap.current[colyseusSessionId] = localLivekitIdentity;
        
        // Keep the session ID for position tracking consistency
        localPosRef.current.id = colyseusSessionId;
        
        // Register message handlers immediately (before game loads)
        // Ensure handlers exist before server sends full_state/player events
        room.onMessage('full_state', (data: any) => {
          if (!gameBridge?.syncRemotePlayers) return; // Skip if game not loaded
          if (data.players) {
            const players: Record<string, { x: number; y: number; direction: any; name?: string }> = {};
            data.players.forEach((p: any) => {
              if (p.id !== localPosRef.current.id) {
                // Store identity mapping
                if (p.identity) {
                  colyseusToLivekitMap.current[p.id] = p.identity;
                  // Store name mapping if provided
                  if (p.name) {
                    identityToNameMap.current[p.identity] = p.name;
                  }
                }
                players[p.id] = { 
                  x: p.x, 
                  y: p.y, 
                  direction: p.direction,
                  name: p.name || getDisplayName(p.identity || p.id),
                  dnd: p.dnd
                } as any;
              }
            });
            gameBridge.syncRemotePlayers(players);
            // Update remote positions cache for distance/zone calculations
            try {
              remotesRef.current = Object.fromEntries(
                Object.entries(players).map(([id, p]) => [id, { x: p.x, y: p.y }])
              );
            } catch {}
            // Trigger participant grid build (debounced)
            try { scheduleBuildParticipantList(0); } catch {}
          }
        });
        
        room.onMessage('player_joined', (data: any) => {
          if (data.id !== localPosRef.current.id) {
            remotesRef.current[data.id] = { x: data.x, y: data.y };
            // Store identity mapping
            if (data.identity) {
              colyseusToLivekitMap.current[data.id] = data.identity;
              // Store name mapping if provided  
              if (data.name) {
                identityToNameMap.current[data.identity] = data.name;
              }
            }
            if (gameBridge?.addRemotePlayer) {
              gameBridge.addRemotePlayer(data.id, { 
                x: data.x, 
                y: data.y, 
                direction: data.direction, 
                name: data.name || getDisplayName(data.identity || data.id),
                dnd: data.dnd
              });
            }
            // Update participant grid (zone/nearby)
            try { scheduleBuildParticipantList(50); } catch {}
            // Re-broadcast current zones so new joiner gets them live (even if server save failed)
            try {
              const currZones = (editor?.zones || []);
              if (Array.isArray(currZones) && currZones.length > 0) {
                colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: currZones });
              }
            } catch {}
          }
        });
        
        room.onMessage('player_moved', (data: any) => {
          if (data.id !== localPosRef.current.id) {
            remotesRef.current[data.id] = { x: data.x, y: data.y };
            if (gameBridge?.updateRemotePlayer) {
              gameBridge.updateRemotePlayer(data.id, { 
                x: data.x, 
                y: data.y, 
                direction: data.direction 
              });
            }
            // Movement may change zone membership
            try { scheduleBuildParticipantList(50); } catch {}
          }
        });
        
        room.onMessage('player_left', (data: any) => {
          delete remotesRef.current[data.id];
          // Clean up identity mapping
          delete colyseusToLivekitMap.current[data.id];
          if (gameBridge?.removeRemotePlayer) {
            gameBridge.removeRemotePlayer(data.id);
          }
          // Rebuild participants after roster change
          try { scheduleBuildParticipantList(50); } catch {}
        });
        
        room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => {
          if (gameBridge?.updateRemotePlayerDnd) {
            gameBridge.updateRemotePlayerDnd(data.id, data.dnd);
          }
          // DND affects visibility/opacity in UI cards
          try { scheduleBuildParticipantList(50); } catch {}
        });
        
        room.onMessage('editor_update', (data: any) => {
          // Zonen-Update oder Tiles direkt anwenden, ohne Neuladen zu benötigen
          try {
            if (data?.type === 'zone' && Array.isArray(data.polys)) {
              // Update lokale Anzeige und Manager
              suppressZoneBroadcastRef.current = true;
              setEditor(s => ({ ...s, zones: data.polys }));
              try { localStorage.setItem('meetropolis.zones', JSON.stringify(data.polys)); } catch {}
              gameBridge.setZoneOverlay(data.polys);
              zoneRef.current?.setZones?.(data.polys as any);
              // Teilnehmerliste neu bauen (Zonenfilter)
              try { scheduleBuildParticipantList(0); } catch {}
              // Nach kurzem Delay Broadcast wieder zulassen
              setTimeout(() => { suppressZoneBroadcastRef.current = false; }, 50);
              return;
            }
            if (data?.type === 'tile_paint' && data.edit) {
              gameBridge.applyTilePaint(data.edit);
              return;
            }
            if (data?.type === 'layers' || data?.type === 'all') {
              gameBridge.fetchAndApplyServerLayers?.();
              return;
            }
            if (data?.type === 'asset' && Array.isArray(data.assets)) {
              gameBridge.setEditorAssets(data.assets);
              return;
            }
          } catch {}
          if (gameBridge?.handleEditorUpdate) {
            gameBridge.handleEditorUpdate(data);
          }
        });
        
        room.onMessage('remote_control', async (payload: { mic?: boolean; cam?: boolean; share?: boolean; dnd?: boolean }) => {
          const lkRoom = avRef.current?.room;
          if (payload.mic !== undefined) {
            if (lkRoom?.localParticipant?.isMicrophoneEnabled !== payload.mic) {
              await lkRoom?.localParticipant?.setMicrophoneEnabled(payload.mic);
            }
          }
          if (payload.cam !== undefined) {
            if (lkRoom?.localParticipant?.isCameraEnabled !== payload.cam) {
              await lkRoom?.localParticipant?.setCameraEnabled(payload.cam);
            }
          }
          if (payload.share !== undefined) {
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
          if (payload.dnd !== undefined) {
            try { gameBridge.setDoNotDisturb(!!payload.dnd); } catch {}
            dndRef.current = !!payload.dnd;
            setAvState(s => ({ ...s, dnd: !!payload.dnd, mic: payload.dnd ? false : s.mic, cam: payload.dnd ? false : s.cam, share: payload.dnd ? false : s.share }));
            try { colyseusRef.current?.send?.('dnd_status', { dnd: !!payload.dnd }); } catch {}
          }
        });
        
        // State is initialized and ready for player tracking
        
        // Try to access players directly
        if (room.state && room.state.players) {
          try {
            // Method 1: forEach
            if (typeof room.state.players.forEach === 'function') {
              // noop
              room.state.players.forEach(() => {});
            }
            // Method 2: Direct access
          } catch (e) {
          }
        }
        gameBridge.onLocalMove = (p) => {
          localPosRef.current.x = p.x;
          localPosRef.current.y = p.y;
          // Store last direction for position saving
          (gameBridge as any).lastDirection = p.direction;
          zoneRef.current?.update({ x: p.x, y: p.y });
          if (followRef.current) {
            const f = followRef.current.update(
              { x: p.x, y: p.y },
              remotesRef.current
            );
            // WICHTIG: keine Überschreibung der Zielbewegung, wenn Bubble-Navigation aussteht
            if (!bubblePendingRef.current) {
              if (f.following) {
                gameBridge.setDesiredPosition({ x: f.x, y: f.y });
              } else {
                gameBridge.setDesiredPosition(null);
              }
            } else if (f.following) {
              gameBridge.setDesiredPosition({ x: f.x, y: f.y });
            }
          }
          try {
            const room: any = colyseusRef.current as any;
            const wsReadyState =
              room?.connection?.ws?.readyState ??
              room?.connection?.transport?.ws?.readyState ??
              room?.connection?._transport?.ws?.readyState;
            const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
            if (room && isOpen) {
              room.send('move', p);
            }
          } catch (e) {
          }

          // Spielerposition serverseitig speichern (gedrosselt)
          try {
            const now = Date.now();
            if (now - lastPositionPostAtRef.current > 1500) {
              lastPositionPostAtRef.current = now;
              fetch(`${apiBase}/auth/position`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: p.x, y: p.y, direction: p.direction || 'down', roomId: 'world' })
              }).catch(() => {});
            }
          } catch {}
        };
        // Add manual state check first
        if (room.state && room.state.players) {
          room.state.players.forEach(() => {});
        }
        
        room.onStateChange((state: any) => {
          
        const players: Record<string, { x: number; y: number; direction: any; dnd?: boolean }> = {};
          
          // Try different ways to iterate over the players
          if (state.players) {
            // Check if it's a MapSchema
            if (typeof state.players.forEach === 'function') {
              state.players.forEach((value: any, key: string) => {
                players[key] = { x: value.x, y: value.y, direction: value.direction, dnd: value.dnd };
                // Store name mapping if available
                if (value.identity && value.name) {
                  identityToNameMap.current[value.identity] = value.name;
                }
              });
            } 
            // Try entries() method if available
            else if (typeof state.players.entries === 'function') {
              for (const [key, value] of state.players.entries()) {
                players[key] = { x: value.x, y: value.y, direction: value.direction };
                // Store name mapping if available
                if (value.identity && value.name) {
                  identityToNameMap.current[value.identity] = value.name;
                }
              }
            }
            // Try direct iteration
            else if (state.players[Symbol.iterator]) {
              for (const [key, value] of state.players) {
                players[key] = { x: value.x, y: value.y, direction: value.direction };
                // Store name mapping if available
                if (value.identity && value.name) {
                  identityToNameMap.current[value.identity] = value.name;
                }
              }
            }
          }
          
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
          // Filter out local player before syncing to scene and add names
          const filteredPlayers = Object.fromEntries(
            Object.entries(players)
              .filter(([id]) => id !== localPosRef.current.id)
              .map(([id, p]) => {
                const livekitIdentity = colyseusToLivekitMap.current[id] || id;
                const name = identityToNameMap.current[livekitIdentity] || livekitIdentity;
                return [id, { ...p, name }];
              })
          );
          gameBridge.syncRemotePlayers(filteredPlayers);
          // Update roster with currently online players
          try {
            const online: Record<string, { name: string; x: number; y: number }> = {};
            for (const [sid, p] of Object.entries(filteredPlayers) as any) {
              const livekitIdentity = (colyseusToLivekitMap.current as any)[sid] || sid;
              const name = (p as any).name || livekitIdentity;
              online[livekitIdentity] = { name, x: (p as any).x, y: (p as any).y };
            }
            // Ensure local user is marked online using stable userId for reconciliation with presence API
            try {
              if (me?.id) {
                const lp = localPosRef.current;
                online[me.id] = { name: me.name || me.email || me.id, x: lp?.x ?? 0, y: lp?.y ?? 0 };
              }
            } catch {}
            rosterByIdentityRef.current = online;
            setRoster((prev) => {
              const map = new Map<string, { identity: string; name: string; online: boolean; x?: number; y?: number; lastSeen?: string }>();
              for (const r of prev) map.set(r.identity, { ...r, online: false });
              for (const [ident, v] of Object.entries(online)) {
                if (map.has(ident)) {
                  map.set(ident, { ...(map.get(ident) as any), name: v.name, online: true, x: v.x, y: v.y });
                } else {
                  // Fallback: reconcile by display name (e.g., "Root Admin") to avoid duplicates when identities differ (userId vs livekit identity)
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
          // Ensure participant grid reflects latest positions/zones
          try { setTimeout(buildParticipantList, 0); } catch {}
        });
        room.onError?.((_code: any, _message: any) => {
          try { (gameBridge as any).onLocalMove = () => {}; } catch {}
          colyseusRef.current = null;
          scheduleColyseusReconnect();
        });
        room.onLeave?.((_code: any) => {
          try { (gameBridge as any).onLocalMove = () => {}; } catch {}
          colyseusRef.current = null;
          scheduleColyseusReconnect();
        });
        
        // Editor update handler registration moved up
        // Note: editor_update is still handled here for game bridge
        room.onMessage('editor_update', (data: any) => {
          // Apply the update to the local scene
          if (data.type === 'tile_paint') {
            gameBridge.applyTilePaint(data.edit);
          } else if (data.type === 'reload_all') {
            // Another user saved to server, reload from server
            try {
              const scene = (window as any).currentPhaserScene;
              scene?.fetchAndApplyServerLayers?.();
            } catch {}
          }
        });
        // Remote control handling ist zentral in useWorldRoom.ts implementiert

        // Bubble-State von Server empfangen
        room.onMessage('bubble_state', (payload: { members: string[] }) => {
          const incoming = new Set<string>(Array.isArray(payload?.members) ? payload.members : []);
          bubbleMembersRef.current = incoming;
          const visual = new Set<string>();
          const amInBubble = !!(localPosRef.current.id && incoming.has(localPosRef.current.id));
          if (amInBubble) {
            try { gameBridge.setMovementLocked(true); } catch {}
          } else {
            try { gameBridge.setMovementLocked(false); } catch {}
          }
          if (localPosRef.current.id && incoming.has(localPosRef.current.id)) visual.add('__local__');
          for (const id of incoming) { if (id !== localPosRef.current.id) visual.add(id); }
          try { gameBridge.setBubbleMembers(visual); } catch {}
          applyVolumesToUi();
          // Update banner UI
          const names: string[] = [];
          for (const id of incoming) {
            if (id === localPosRef.current.id) continue;
            const identity = colyseusToLivekitMap.current[id] || id;
            const name = identityToNameMap.current[identity] || getDisplayName(identity);
            names.push(name);
          }
          setBubbleUi({ active: amInBubble && incoming.size > 1, members: names });
        });
      } catch {
        scheduleColyseusReconnect();
      }
    };
    void connectColyseus();

  // LiveKit-Verbindung via Hook (nach oben verlegt)

    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);
    // Seed Zonen sofort, auch wenn der Editor bisher nie geöffnet war
    try { zoneRef.current.setZones(editor.zones as any); } catch {}
    // Stelle sicher, dass ZoneManager initial eine Position bekommt, auch bevor Colyseus onLocalMove feuert
    let lastZone: string | null = null;
    gameBridge.onLocalMove = (p) => {
      localPosRef.current.x = p.x;
      localPosRef.current.y = p.y;
      zoneRef.current?.update({ x: p.x, y: p.y });
      
      // Check if zone changed
      const zones = zoneRef.current?.getZones?.() || [];
      const currentZone = zones.find(z => pointInPolygon({ x: p.x, y: p.y }, z.points));
      const currentZoneName = currentZone?.name || null;
      
      if (currentZoneName !== lastZone) {
        lastZone = currentZoneName;
        // Rebuild participant list when zone changes
        setTimeout(buildParticipantList, 50);
        // Force volume update when zone changes
        setTimeout(() => volumeRef.current?.update(), 100);
      }
      
      if (followRef.current) {
        const f = followRef.current.update(
          { x: p.x, y: p.y },
          remotesRef.current
        );
        // WICHTIG: keine Überschreibung der Zielbewegung, wenn Bubble-Navigation aussteht
        if (!bubblePendingRef.current) {
          if (f.following) {
            gameBridge.setDesiredPosition({ x: f.x, y: f.y });
          } else {
            gameBridge.setDesiredPosition(null);
          }
        } else if (f.following) {
          gameBridge.setDesiredPosition({ x: f.x, y: f.y });
        }
      }
      colyseusRef.current?.send?.('move', p);
    };
    volumeRef.current = new VolumeManager(
      { 
        setParticipantVolume: (colyseusId, vol) => {
          // Map Colyseus ID to LiveKit identity
          const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
          if (livekitIdentity && avRef.current) {
            avRef.current.setParticipantVolume(livekitIdentity, vol);
          }
        }
      },
      {
        getLocal: () => {
          // Return Colyseus ID for volume calculations
          return localPosRef.current.id ? { id: localPosRef.current.id, x: localPosRef.current.x, y: localPosRef.current.y } : null;
        },
        getRemotes: () => {
          // Always return all remotes - DND is handled in VolumeManager
          return remotesRef.current;
        },
        getZones: () => zoneRef.current?.getZones?.() || [],
        getFollowTarget: () => followRef.current?.getTarget?.() || null,
        getBubbleMembers: () => bubbleMembersRef.current,
        getLocalDnd: () => dndRef.current,
      },
      { nearRadius: 96, farRadius: 384, outsideBubbleAttenuation: 0.05 }
    );
    // Direkt nach Szenenstart versuchen, lokal gespeicherte Editor-Layer zu laden
    setTimeout(() => { 
      try { gameBridge.reloadEditorLayers(); } catch {}
      // Set hero name with a small delay to ensure scene is ready
      const heroName = me.name || me.email || 'You';
      setTimeout(() => {
        try { gameBridge.setHeroName(heroName); } catch {}
      }, 100);
    }, 0);
    // Editor-Click-Handler (deaktiviert in Editor-Modus, da tile-basierte Pointer-Events genutzt werden)
    gameBridge.onPointerDown = ({ x, y }) => {
      if (editorActiveRef.current) {
        // Editor verwendet onPointerDownTile / onPointerMoveTile / onPointerUpTile
        return;
      }
      setEditor(prev => {
        if (!prev.active) return prev;
        
        // Grid snapping - align to 16x16 grid
        // Since sprites are centered, we need to offset by half a tile
        const GRID_SIZE = 16;
        const HALF_GRID = GRID_SIZE / 2;
        const snappedX = Math.floor(x / GRID_SIZE) * GRID_SIZE + HALF_GRID;
        const snappedY = Math.floor(y / GRID_SIZE) * GRID_SIZE + HALF_GRID;
        
        // Handle object deletion
        if (prev.tool === 'erase' && prev.category === 'objects') {
          // Find object at position
          const clickRadius = 16; // Tolerance for clicking
          const clickedAsset = prev.assets.find(a => 
            Math.abs(a.x - x) < clickRadius && Math.abs(a.y - y) < clickRadius
          );
          
          if (clickedAsset) {
            const assets = prev.assets.filter(a => a.id !== clickedAsset.id);
            try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
            gameBridge.setEditorAssets(assets);
            return { ...prev, assets };
          }
          return prev;
        }
        
        // Handle object placement from tileset
        if (prev.tool === 'asset' && prev.tilePaint && prev.category === 'objects') {
          const tileset = prev.tilesets?.find(ts => ts.key === prev.tilePaint?.tilesetKey);
          if (tileset) {
            // Create a canvas to extract the specific tile
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = tileset.tileWidth;
              canvas.height = tileset.tileHeight;
              
              const img = new Image();
              img.onload = () => {
                const margin = tileset.margin || 0;
                const spacing = tileset.spacing || 0;
                const cols = Math.floor((img.width - margin + spacing) / (tileset.tileWidth + spacing));
                const tileIndex = prev.tilePaint?.tileIndex || 0;
                const tx = tileIndex % cols;
                const ty = Math.floor(tileIndex / cols);
                const sx = margin + tx * (tileset.tileWidth + spacing);
                const sy = margin + ty * (tileset.tileHeight + spacing);
                
                ctx.drawImage(img, sx, sy, tileset.tileWidth, tileset.tileHeight, 0, 0, tileset.tileWidth, tileset.tileHeight);
                
                const tileDataUrl = canvas.toDataURL();
                const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                const asset = { id, key: `${tileset.key}:${tileIndex}:${id}`, dataUrl: tileDataUrl, x: snappedX, y: snappedY };
                
                setEditor(s => {
                  const assets = [...s.assets, asset];
                  try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
                  gameBridge.setEditorAssets(assets);
                  return { ...s, assets };
                });
              };
              img.src = tileset.dataUrl;
            }
          }
          return prev;
        }
        
        // Legacy Asset-Placement deaktiviert; Editor nutzt tile-basierte Platzierung
        return prev;
      });
    };
    
    // startBubbleTo ist oben initialisiert und im Ref hinterlegt

    gameBridge.onRightClick = ({ x, y, playerId }) => {
      if (editorActiveRef.current) return;
      if (!playerId) return;
      try { console.debug('[UI] context menu for', playerId, 'at', x, y); } catch {}
      // Öffne Kontextmenü-UI
      setContextMenu({ open: true, x, y, playerId });
    };
    // Tile-basierte Pointer-Events werden exklusiv in useEditorBridge gebunden

    // Save position when player stops moving
    let lastSavedPosition = { x: 0, y: 0, direction: 'down' };
    let moveTimeoutRef: NodeJS.Timeout | null = null;

    const savePosition = async (opts?: { immediate?: boolean }) => {
      const currentPos = localPosRef.current;
      const currentDirection = (gameBridge as any).lastDirection || 'down';
      const hasMoved = currentPos.x && currentPos.y && (
        Math.abs(currentPos.x - lastSavedPosition.x) > 10 ||
        Math.abs(currentPos.y - lastSavedPosition.y) > 10 ||
        currentDirection !== lastSavedPosition.direction
      );
      if (!hasMoved && !opts?.immediate) return;
      lastSavedPosition = { x: currentPos.x || lastSavedPosition.x, y: currentPos.y || lastSavedPosition.y, direction: currentDirection };
      const payload = JSON.stringify({ 
        x: Math.round(lastSavedPosition.x), 
        y: Math.round(lastSavedPosition.y), 
        direction: lastSavedPosition.direction 
      });
      try {
        if (opts?.immediate && 'sendBeacon' in navigator) {
          const blob = new Blob([payload], { type: 'application/json' });
          (navigator as any).sendBeacon?.(`${apiBase}/auth/position`, blob);
        } else {
          await fetch(`${apiBase}/auth/position`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            // keepalive erlaubt Senden bei pagehide/unload
            keepalive: !!opts?.immediate,
            body: payload
          });
        }
      } catch {}
    };
    
    // Override onLocalMove to save position after movement stops
    const originalOnLocalMove = gameBridge.onLocalMove;
    gameBridge.onLocalMove = (p) => {
      originalOnLocalMove(p);
      
      // Clear existing timeout
      if (moveTimeoutRef) {
        clearTimeout(moveTimeoutRef);
      }
      
      // Set new timeout to save position 1 second after movement stops
      moveTimeoutRef = setTimeout(() => {
        void savePosition();
        moveTimeoutRef = null;
      }, 1000);
    };

    return () => {
      disposed = true;
      try { gameBridge.setSceneApi?.(null); } catch {}
      destroyPhaserGame(game);
      // Remove any leftover canvases to free WebGL contexts
      try { const el = containerRef.current; while (el && el.firstChild) { el.removeChild(el.firstChild); } } catch {}
      // Leave Colyseus room only if connection is open
      try {
        const room: any = colyseusRef.current;
        const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
        const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
        if (isOpen) room.leave();
      } catch {}
      try { avRef.current?.leave?.(); } catch {}
      try { if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current); } catch {}
      // HUD-Ticker Cleanup wird vom Hook übernommen
      if (moveTimeoutRef) {
        clearTimeout(moveTimeoutRef);
      }
      // Position-Persistenz cleanup wird im Hook gehandhabt
    };
  }, [authChecked, me?.id, apiBase]);


  // Global Audio Track Manager - ausgelagert
  useGlobalAudioTracks({ avRef });

  useDndShortcut({ enabled: !!(authChecked && me), dndRef, avRef, setAvState, colyseusRef, volumeRef, gameBridge });

  // Zonen-Handling/Sync (ausgelagert)
  useZonesSync({ editor, setEditor, zoneRef, gameBridge, colyseusRef });

  // Bubble-Navigation (ausgelagert)
  const { startBubbleTo } = useBubbleNavigation({
    bubbleMembersRef,
    localPosRef,
    colyseusRef,
    gameBridge,
    identityToNameMap,
    colyseusToLivekitMap,
    setBubbleUi,
    applyVolumesToUi,
    followRef,
  });
  bubbleStartRef.current = startBubbleTo;

  // HUD-Ticker ausgelagert
  useHudTicker({
    enabled: !!(authChecked && me),
    zoneRef,
    avRef,
    setHud,
    bubblePendingRef,
    localPosRef,
    remotesRef,
    onZoneParticipantRefresh: () => setTimeout(buildParticipantList, 0),
    volumeRef,
    setParticipantVolumesRef: (vols) => { participantVolumesRef.current = vols; },
    onArrivedAtBubbleTarget: (targetId) => {
      try { followRef.current?.stop?.(); } catch {}
      try { gameBridge.setDesiredPosition(null); } catch {}
      try {
        // reuse bubble activation from hook by dispatching message to server and UI
        // minimal local activation
        const visual = new Set<string>();
        if (localPosRef.current.id) visual.add('__local__');
        visual.add(targetId);
        gameBridge.setBubbleMembers(visual);
      } catch {}
    },
  });

  useEffect(() => {
    // Assets immer anzeigen - sie sind Teil der Map!
    gameBridge.setEditorAssets(editor.assets);
  }, [editor.assets]);

  // Collision-Overlay immer im Edit-Modus anzeigen (User-Erwartung)
  useEffect(() => {
    gameBridge.setCollisionVisible(!!editor.active);
  }, [editor.active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu({ open: false, x: 0, y: 0, playerId: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    // Kein globales Blockieren des Kontextmenüs mehr.
    // Das Unterdrücken des Kontextmenüs wird ausschließlich in der Phaser-Scene
    // für das Canvas selbst gehandhabt (siehe MainScene).
  }, []);

  React.useEffect(() => {
    // Subscribe to camera manual change from scene
    const handler = (active: boolean) => setCameraManual(!!active);
    try { (gameBridge as any).onCameraManualChange = handler; } catch {}
    return () => {
      try { (gameBridge as any).onCameraManualChange = () => {}; } catch {}
    };
  }, []);

  // Editor Bridge: verbindet Pointer-Events der Szene mit der Editor-Logik (Zonen/Spawn)
  // (bereits früher aufgerufen)

  if (!authChecked) {
    return (
      <div style={{display:'grid',placeItems:'center',height:'100vh'}}>Lade…</div>
    );
  }
  if (!me) {
    return (
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,alignItems:'start',padding:'6vh 6vw'}}>
        <div>
          <h2 style={{ margin: '8px 0' }}>Anmelden</h2>
          <AuthScreen baseUrl={apiBase} onDone={async () => { await fetchMe(); }} />
        </div>
        <div>
          <h2 style={{ margin: '8px 0' }}>Registrieren (neuen Mandanten anlegen)</h2>
          <Signup apiBase={apiBase} onSuccess={(slug)=>{
            try {
              const proto = window.location.protocol;
              const host = window.location.host;
              const baseHost = host.split(':')[0];
              const parts = baseHost.split('.');
              if (parts.length >= 2) {
                const rest = parts.slice(-2).join('.');
                const port = host.includes(':') ? (':' + host.split(':')[1]) : '';
                window.location.href = `${proto}//${slug}.${rest}${port}`;
              } else {
                // localhost/dev fallback: reload to keep cookie
                window.location.reload();
              }
            } catch { window.location.reload(); }
          }} />
        </div>
      </div>
    );
  }
  if (!positionReady) {
    return (
      <div style={{display:'grid',placeItems:'center',height:'100vh'}}>Position wird geladen…</div>
    );
  }

  const participantsToRender = uiParticipants.length > 0
    ? uiParticipants
    : [{ sid: (avRef.current?.room?.localParticipant?.sid ?? 'local'), identity: me.name || me.email, hasVideo: false, hasMic: avState.mic, isSpeaking: false, media: 'camera' as const }];

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'grid', gridTemplateColumns: '1fr 240px' }}>
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {page === 'world' && (
        <>
          <Overlays
            hud={hud}
            editorActive={editor.active}
            avDnd={avState.dnd}
            participants={participantsToRender}
            gridExpanded={gridExpanded}
            onToggleExpand={() => setGridExpanded(e => !e)}
            selectedSid={selectedSid}
            onSelectSid={(sid) => setSelectedSid(sid)}
            getRoom={getRoom}
            overlayZoom={overlayZoom}
            onZoom={(z) => setOverlayZoom(z)}
          />
          {(import.meta as any).env?.DEV ? (
            <ConnectionBanner
              reconnecting={connStatus.reconnecting}
              reason={connStatus.lastReason || (typeof connStatus.lastCode === 'number' ? String(connStatus.lastCode) : undefined)}
            />
          ) : null}
          {positionReady ? (
            <div
              ref={containerRef}
              style={{ width: '100%', height: '100%', position: 'relative' }}
              onContextMenu={(e)=>{ e.preventDefault(); }}
            >
              {avState.dnd && (
                <div
                  onClick={(e)=>{ e.stopPropagation(); }}
                  onMouseDown={(e)=>{ e.stopPropagation(); e.preventDefault(); }}
                  onMouseUp={(e)=>{ e.stopPropagation(); e.preventDefault(); }}
                  onPointerDown={(e)=>{ e.stopPropagation(); e.preventDefault(); }}
                  onPointerUp={(e)=>{ e.stopPropagation(); e.preventDefault(); }}
                  onWheel={(e)=>{ e.stopPropagation(); e.preventDefault(); }}
                  style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.55)',
                    backdropFilter: 'blur(2px) grayscale(0.2)',
                    zIndex: 20,
                    cursor: 'not-allowed'
                  }}
                />
              )}
            </div>
          ) : (
            <div style={{display:'grid',placeItems:'center',height:'100%', color: 'var(--fg-subtle)'}}>Starte Welt…</div>
          )}

          {/* Admin Overlay (einzige Instanz) */}
          {isInternalOwner && (
            <>
              <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60 }}>
                <Button onClick={()=> setAdminOpen(true)} variant="ghost">Admin</Button>
              </div>
              <AdminOverlay apiBase={apiBase} open={adminOpen} onOpenChange={setAdminOpen} />
            </>
          )}
          {/* ParticipantOverlay über Overlays */}

          {/* Bottom Control Bar (hidden in editor mode) */}
          {!editor.active && (
            <div style={{ position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 30 }}>
              <AVBar
                size="md"
                micOn={avState.mic}
                camOn={avState.cam}
                shareOn={avState.share}
                dndOn={avState.dnd}
                devices={devices}
                selectedMicId={selectedMicId}
                selectedCamId={selectedCamId}
                onToggleMic={async () => {
                  const enabled = !avState.mic;
                  // Optimistisches UI-Update, Aktion im Hintergrund
                  setAvState(s => ({ ...s, mic: enabled }));
                  try {
                    await avRef.current?.setMicrophoneEnabled(enabled);
                  } catch (e) {
                    // Revert bei Fehler
                    setAvState(s => ({ ...s, mic: !enabled }));
                    return;
                  }
                  // Nach erfolgreichem Toggle: tatsächlichen Zustand aus dem Room lesen und UI ggf. korrigieren
                  try {
                    const mod: any = await import('../../av/core/localState');
                    const roomAny: any = avRef.current?.room as any;
                    const realOn = mod.isLocalMicOn(roomAny);
                    if (realOn !== enabled) {
                      setAvState(s => ({ ...s, mic: realOn }));
                    }
                    // Fange Pending/Connect-Fälle ab: kurze Nachprüfung
                    setTimeout(() => {
                      try {
                        const again = mod.isLocalMicOn(avRef.current?.room as any);
                        if (again !== realOn) {
                          setAvState(s => ({ ...s, mic: again }));
                        }
                      } catch {}
                    }, 400);
                  } catch {}
                }}
                onSelectMic={async (id: string) => {
                  setSelectedMicId(id);
                  await avRef.current?.useMicrophoneDevice(id);
                }}
                onToggleCam={async () => {
                  const enabled = !avState.cam;
                  // Optimistisches UI-Update, Aktion im Hintergrund
                  setAvState(s => ({ ...s, cam: enabled }));
                  try {
                    await avRef.current?.setCameraEnabled(enabled);
                  } catch (e) {
                    setAvState(s => ({ ...s, cam: !enabled }));
                  }
                }}
                onSelectCam={async (id: string) => {
                  setSelectedCamId(id);
                  await avRef.current?.useCameraDevice(id);
                }}
                onToggleShare={async () => {
                  try {
                    if (!avState.share) {
                      const ok = await avRef.current?.startScreenshare();
                      if (ok) setAvState(s => ({ ...s, share: true }));
                    } else {
                      await avRef.current?.stopScreenshare();
                      setAvState(s => ({ ...s, share: false }));
                    }
                  } catch (e) {}
                }}
                onToggleDnd={async () => {
                  const next = !avState.dnd;
                  try { gameBridge.setDoNotDisturb(next); } catch {}
                  try { gameBridge.setMovementLocked(next); } catch {}
                  if (next) {
                    try { await avRef.current?.setMicrophoneEnabled(false); } catch {}
                    try { await avRef.current?.setCameraEnabled(false); } catch {}
                    try { await avRef.current?.stopScreenshare(); } catch {}
                    try {
                      const room: any = avRef.current?.room as any;
                      if (room?.remoteParticipants) {
                        const participants: any[] = Array.from((room.remoteParticipants as any).values());
                        for (const p of participants) {
                          const sid = (p as any)?.sid;
                          if (sid) {
                            try { avRef.current?.setParticipantVolume(sid, 0); } catch {}
                          }
                        }
                      }
                    } catch {}
                  }
                  dndRef.current = next;
                  setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
                  try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
                  try { volumeRef.current?.update(); } catch {}
                }}
                cameraManual={cameraManual}
                onRecenter={() => { try { gameBridge.recenterCamera(); } catch {} }}
              />
            </div>
          )}
        </>
      )}

      <Modal open={userModalOpen} onOpenChange={setUserModalOpen} title="Benutzerverwaltung" maxWidth={900} right={<div style={{ display:'flex', gap:8 }}><ThemeToggleButton /></div>}>
        <UserManagement baseUrl={apiBase} onBack={() => setUserModalOpen(false)} />
      </Modal>

      {/* Profil-Seite ist (noch) nicht implementiert; Stub entfernt */}

      {/* Settings & Theme (oben rechts) */}
      <TopRightControls
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen(v => !v)}
        onOpenUsers={() => { setUserModalOpen(true); setMenuOpen(false); }}
        onOpenInvites={() => { setInvitesModalOpen(true); setMenuOpen(false); }}
        onBackToWorld={() => { setPage('world'); setMenuOpen(false); }}
        onOpenAdmin={() => { setAdminOpen(true); setMenuOpen(false); }}
        isAdmin={isInternalOwner}
        onOpenApi={() => { setApiModalOpen(true); setMenuOpen(false); }}
        onResetApp={async () => {
          setMenuOpen(false);
          // Verbindungen sauber schließen, bevor Storage/Cookies gelöscht werden
          try { await avRef.current?.leave?.(); } catch {}
          try {
            const room: any = colyseusRef.current;
            const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
            const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
            if (isOpen) await room.leave();
          } catch {}
          try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch {}
          try { localStorage.clear(); } catch {}
          try { sessionStorage.clear(); } catch {}
          try {
            const parts = (document.cookie || '').split(';');
            for (const raw of parts) {
              const name = raw.split('=')[0]?.trim();
              if (!name) continue;
              document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
            }
          } catch {}
          window.location.reload();
        }}
        onToggleEditor={async () => {
          if (editor.active) { await saveAllToServer().catch(()=>{}); }
          setEditor(s => ({ ...s, active: !s.active }));
          setMenuOpen(false);
          setTimeout(() => {
            const newEditorState = !editor.active;
            if (newEditorState) { gameBridge.setZoneOverlay(editor.zones); }
            else { gameBridge.setZoneOverlay([]); }
          }, 0);
        }}
        editorActive={editor.active}
        onLogout={async () => { try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { setMe(null); setMenuOpen(false); setPage('world'); } }}

      />

      </div>
      {/* Rechte Roster-Leiste (volle Höhe) */}
      <RosterPanel roster={roster} onJumpTo={(r)=>{
        try {
          if (typeof r.x === 'number' && typeof r.y === 'number') {
            gameBridge.setDesiredPosition({ x: r.x!, y: r.y! });
            try { (window as any).currentPhaserScene?.cameras?.main?.pan?.(r.x!, r.y!, 250, 'Sine.easeInOut'); } catch {}
          }
        } catch {}
      }} />

      {/* API Token Modal */}
      <ApiTokensOverlay 
        open={apiModalOpen}
        onClose={()=>setApiModalOpen(false)}
        apiBase={apiBase}
        apiTokens={apiTokens}
        setApiTokens={setApiTokens}
        newTokenName={newTokenName}
        setNewTokenName={setNewTokenName}
        freshToken={freshToken}
        setFreshToken={setFreshToken}
      />

      <EditorWindow editor={editor} setEditor={setEditor} onSave={saveAllToServer} />
      
      {/* Tileset Upload Dialog ausgelagert in EditorWindow */}

      {/* Bubble Banner */}
      <BubbleBanner 
        active={bubbleUi.active} 
        members={bubbleUi.members} 
        onLeave={() => {
          const set = bubbleMembersRef.current;
          set.clear();
          try { gameBridge.setBubbleMembers(new Set()); } catch {}
          try { gameBridge.setMovementLocked(false); } catch {}
          try { colyseusRef.current?.send?.('bubble_update', { members: [] }); } catch {}
          setBubbleUi({ active: false, members: [] });
          setTimeout(() => applyVolumesToUi(), 0);
        }}
      />

      {/* Kontextmenü */}
      {contextMenu.open && contextMenu.playerId && (
        <div onClick={() => setContextMenu({ open: false, x: 0, y: 0, playerId: null })} onContextMenu={(e)=> e.preventDefault()} style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={(e)=>e.stopPropagation()} style={{ position: 'absolute', left: Math.min(Math.max(8, contextMenu.x), window.innerWidth - 196), top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 96), background:'rgba(17,17,20,0.98)', color:'#fff', border:'1px solid rgba(255,255,255,0.12)', borderRadius: 8, boxShadow:'0 12px 40px rgba(0,0,0,0.5)' }}>
            <button onClick={() => {
              setContextMenu({ open: false, x: 0, y: 0, playerId: null });
              const id = contextMenu.playerId!;
              // Toggle follow
              if (followRef.current?.getTarget?.() === id) {
                followRef.current.stop();
                gameBridge.setDesiredPosition(null);
              } else {
                followRef.current?.startFollowing?.(id);
              }
            }} style={{ display:'block', padding:'8px 12px', background:'transparent', color:'#fff', border:'none', borderBottom:'1px solid rgba(255,255,255,0.08)', width: 180, textAlign:'left', cursor:'pointer' }}>Folgen</button>
            <button onClick={() => {
              setContextMenu({ open: false, x: 0, y: 0, playerId: null });
              const id = contextMenu.playerId!;
              bubbleStartRef.current?.(id);
            }} style={{ display:'block', padding:'8px 12px', background:'transparent', color:'#fff', border:'none', width: 180, textAlign:'left', cursor:'pointer' }}>Bubble starten</button>
          </div>
        </div>
      )}
      {/* Recenter Button wird nun in der AV-Leiste rechts angezeigt */}

      {/* Admin-Toolbar entfernt – Direktzugriff über Icon-Buttons oben rechts */}

      {/* (Alt) Benutzerverwaltung-Profilmodal entfernt – Benutzerverwaltung läuft über Overlay + UserManagement */}

      {/* Einladungen Modal (einheitliche Modal-Komponente) */}
      <InvitesModal open={invitesModalOpen} onOpenChange={setInvitesModalOpen} apiBase={apiBase} />

      {/* Admin: Tenants */}
      <TenantsAdminModal open={adminOpen} onOpenChange={setAdminOpen} apiBase={apiBase} isInternalOwner={isInternalOwner} />

      {/* Editor Exit Confirm ausgelagert in EditorWindow */}
    </div>
    );
}

// Styles (unused button styles removed)

// ParticipantCard moved to ../../ui/user/ParticipantCard


