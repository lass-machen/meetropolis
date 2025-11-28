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
// useEditorPointer removed - now handled by EditorInputHandler in MainScene
// HudPanel moved into Overlays
import { TopRightControls } from '../layout/TopRightControls';
import { ApiTokensOverlay } from '../../ui/admin/ApiTokensOverlay';
import { AdminOverlay } from '../../ui/admin/AdminOverlay';
import { TenantsAdminModal } from '../../features/admin/TenantsAdminModal';
import { InvitesModal } from '../../features/admin/InvitesModal';
import { useEditor } from '../../hooks/useEditor';
import { EditorService } from '../../services/EditorService';
import { useApiTokensLoader } from '../../features/admin/useApiTokens';
// useEditorBridge removed - now handled by EditorInputHandler in MainScene
import { useGlobalAudioTracks } from '../../av/useGlobalAudioTracks';
// usePositionPersistence removed - logic integrated into WorldApp
import { useZones as useZonesSync } from '../../features/zones/useZones';
import { useHudTicker } from '../../features/hud/useHudTicker';
import { useBubbleNavigation } from '../../features/bubble/useBubbleNavigation';
import { useWorldRoom } from '../../realtime/useWorldRoom';
import { useLivekit } from '../../av/useLivekit';
import { createPhaserGame, destroyPhaserGame } from '../../game/phaserGame';
import { gameBridge } from '../../game/bridge';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import { AVManager } from '../../av/avManager';
import { useDoNotDisturbBridge } from '../../av/hooks/useDoNotDisturbBridge';
import { useDndShortcut } from '../../av/hooks/useDndShortcut';
import { BubbleManager } from '../../game/bubbleManager';
import { FollowManager } from '../../game/followManager';
import { ZoneManager } from '../../game/zoneManager';
import { VolumeManager } from '../../game/volumeManager';
import { ConnectionBanner } from '../../ui/system/ConnectionBanner';
import { splitTilesetImage } from '../../lib/tilesetUtils';


export function WorldApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const colyseusRef = useRef<any>(null);
  const colyseusReconnectTimerRef = useRef<any>(null);
  // Reconnect-Handling liegt im WorldRoom-Hook
  const avRef = useRef<AVManager | null>(null);
  const bubbleRef = useRef<BubbleManager | null>(null);
  const zoneRef = useRef<ZoneManager | null>(null);
  const followRef = useRef<import('../../game/followManager').FollowManager | null>(null);
  const volumeRef = useRef<VolumeManager | null>(null);
  const bubbleMembersRef = useRef<Set<string>>(new Set());
  const bubbleGroupsRef = useRef<Record<string, string>>({});
  // removed unused right-click timers
  const localPosRef = useRef<{ id: string; x?: number; y?: number }>({ id: '' });
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
    try { (gameBridge as any).onCameraManualChange = handler; } catch { }
    return () => { try { (gameBridge as any).onCameraManualChange = () => { }; } catch { } };
  }, []);
  // Positions-Persistenz (Throttle)
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
  // HTTP-Poll für Presence deaktivieren – wir nutzen WS-Push (presence_recent/presence_update)
  useRosterPresence({ apiBase, authChecked, meId: me?.id ?? null, rosterByIdentityRef, setRoster, avRef, enablePoll: false });
  // Grid Overlay expand/collapse + selection
  const [gridExpanded, setGridExpanded] = React.useState(false);
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  // Connection status (Colyseus)
  const [connStatus, setConnStatus] = React.useState<{ reconnecting: boolean; lastCode?: number; lastReason?: string }>({ reconnecting: false });
  // Simple view routing (removed legacy state)
  // Bubble UI state
  const [rosterCollapsed, setRosterCollapsed] = React.useState(false);
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({ active: false, members: [] });
  // Pending bubble navigation until arrival near target
  const bubblePendingRef = React.useRef<{ targetId: string; dest?: { x: number; y: number } } | null>(null);
  // Kontextmenü State
  const [contextMenu, setContextMenu] = React.useState<{ open: boolean; x: number; y: number; playerId: string | null }>({ open: false, x: 0, y: 0, playerId: null });
  // Expose bubble start from effect to JSX
  const bubbleStartRef = React.useRef<null | ((id: string) => void)>(null);
  // Manuelle Navigation zu fixer Position (Roster-Klick)
  const manualNavRef = React.useRef<{ x: number; y: number } | null>(null);
  const disposedRef = React.useRef(false);
  const [page, setPage] = React.useState<'world' | 'admin' | string>('world');
  const [menuOpen, setMenuOpen] = React.useState(false);
  // EditorWindow Drag/Dirty/Exit-Logik ausgelagert in <EditorWindow />
  const connectLivekitRef = React.useRef<null | (() => Promise<void>)>(null);
  // Single-run guards to prevent repeated re-inits/auto-connects
  const gameCreatedRef = React.useRef(false);
  const livekitAutoConnectOnceRef = React.useRef(false);

  // Save position refs declared at top level to be used in useEffect
  const lastSavedPositionRef = useRef({ x: 0, y: 0, direction: 'down' });
  const moveTimeoutRef = useRef<any>(null);

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
    dndRef,
  });
  const buildParticipantList = buildParticipantListHook;
  const applyVolumesToUi = applyVolumesToUiHook;

  // Debounce: Teilnehmerliste nur 1x pro Tick/kurzem Intervall neu bauen
  const buildListTimerRef = React.useRef<any>(null);
  const buildListRafRef = React.useRef<number | null>(null);
  // scheduleBuildParticipantList is used in useWorldRoom hook via buildParticipantListHook
  React.useEffect(() => {
    return () => {
      try { if (buildListTimerRef.current) clearTimeout(buildListTimerRef.current); } catch { }
      try { if (buildListRafRef.current !== null) cancelAnimationFrame(buildListRafRef.current); } catch { }
    };
  }, []);



  // Laden der Tokenliste beim Öffnen des Modals (ausgelagert)
  useApiTokensLoader({ apiBase, open: apiModalOpen, setFreshToken, setApiTokens });
  // Map Editor State (moved to hook)
  const editorActiveRef = React.useRef(false);
  React.useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);
  // Editor Pointer Bridge removed - now handled by EditorInputHandler in MainScene

  // Position-Persistenz (Hook entfernt, Logik unten in useEffect integriert)

  // Editor-Pointer-Logik removed - now handled by EditorInputHandler in MainScene

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
    bubbleMembersRef,
    bubbleGroupsRef,
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
        } catch { }
      }
      if (!user) {
        // Nicht eingeloggt → AuthScreen anzeigen
        setMe(null);
        return;
      }
      try { setIsInternalOwner(!!user.isInternalOwner); } catch { }

      // 2) Position ermitteln: bevorzugt vom Server, sonst lokaler Spawn als Fallback
      const applyPosition = (pos: { x: number; y: number } | null) => {
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          try { localPosRef.current = { id: user.id, x: pos.x, y: pos.y }; } catch { }
          try { (window as any).initialPlayerPosition = { x: pos.x, y: pos.y }; } catch { }
        }
      };

      const readLocalSpawn = (): { x: number; y: number } | null => {
        // Removed localStorage logic for spawn, rely on server or default
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
          } catch { }
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

  // Editor-Pointer-Handler sind jetzt via EditorInputHandler in MainScene implementiert

  // Editor: Laden aus localStorage und Server (nur wenn eingeloggt)
  useEffect(() => {
    if (!me) return; // Nur wenn eingeloggt - verhindert 401/500-Fehler

    try {
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
                // Wenn es sich um ein Tileset handelt (keine einzelnen Items definiert), splitten wir es
                if (t.dataURL) {
                  try {
                    const tiles = await splitTilesetImage(t.dataURL, {
                      tileWidth: t.tileWidth,
                      tileHeight: t.tileHeight,
                      margin: t.margin,
                      spacing: t.spacing
                    });

                    for (const tile of tiles) {
                      packItems.push({
                        packUuid: uuid,
                        itemId: `${t.id}:${tile.row}:${tile.col}`,
                        key: `${t.key}-${tile.row}-${tile.col}`,
                        category: 'terrain',
                        dataUrl: tile.dataUrl,
                        width: t.tileWidth,
                        height: t.tileHeight,
                        collide: !!t.collide
                      });
                    }
                  } catch (e) {
                    console.warn('[WorldApp] Failed to split tileset:', t.key, e);
                    // Fallback: Das ganze Bild als ein Item (besser als nichts)
                    packItems.push({ packUuid: uuid, itemId: t.id, key: t.key, category: 'terrain', dataUrl: t.dataURL, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
                  }
                } else {
                  packItems.push({ packUuid: uuid, itemId: t.id, key: t.key, category: 'terrain', dataUrl: t.dataURL, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
                }
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
                // Phaser-Registrierung beim Szenenstart über pendingTilesets
                (window as any).pendingTilesets = merged;
                return { ...s, tilesets: merged };
              });
              // Szene sofort über Bridge registrieren (asynchrones Laden vermeiden Timing-Probleme)
              try {
                for (const ts of packTilesets) {
                  gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0 });
                }
              } catch { }
            }
            setEditor(s => ({ ...s, packItems }));
          }
          // Restore local custom items (Palette)
          try {
            const raw = localStorage.getItem('meetropolis.packItems');
            if (raw) {
              const local = JSON.parse(raw);
              if (Array.isArray(local)) {
                setEditor(s => {
                  const current = s.packItems || [];
                  const seen = new Set(current.map(p => p.key));
                  const next = [...current];
                  for (const li of local) {
                    if (!seen.has(li.key)) {
                      next.push(li);
                      seen.add(li.key);
                    }
                  }
                  return { ...s, packItems: next };
                });
              }
            }
          } catch { }
        })();
      } catch { }

      // Load layers from server on startup
      try {
        gameBridge.fetchAndApplyServerLayers();
      } catch (e) {
      }

      // Standard-Tilesets (existieren in public/assets/tilesets/)
      const defaultTs = [
        { key: 'office_tiles', dataUrl: '/assets/tilesets/office_tiles.png', tileWidth: 16, tileHeight: 16, category: 'terrain' },
        { key: 'furniture_tiles', dataUrl: '/assets/tilesets/furniture_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
        { key: 'decor_tiles', dataUrl: '/assets/tilesets/decor_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
      ];
      (window as any).pendingTilesets = defaultTs;
      setEditor(s => ({ ...s, tilesets: defaultTs }));

      // Registrierung SEQUENTIELL (nicht parallel!) um Race Condition zu vermeiden
      (async () => {
        try {
          for (const ts of defaultTs) {
            await gameBridge.registerTileset({
              key: ts.key,
              dataUrl: ts.dataUrl,
              tileWidth: ts.tileWidth,
              tileHeight: ts.tileHeight,
              margin: 0,
              spacing: 0
            });
          }
        } catch (e) {
          console.warn('[EDITOR] Tileset registration failed (non-critical):', e);
        }
      })();

      // Bereits vorhandene Editor-Layer sofort anwenden (falls vorhanden)
      try { gameBridge.reloadEditorLayers(); } catch { }
      // Server-state laden (source of truth)
      (async () => {
        try {
          const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
          const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, { credentials: 'include' });
          console.debug('[EDITOR] load server editor-state', { mapName, ok: res.ok, status: res.status });
          if (res.ok) {
            const data = await res.json();
            if (data?.zones) try {
              const zones = Array.isArray(data.zones) ? data.zones.map((z: any) => {
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
              setEditor(s => ({ ...s, zones }));
              try { gameBridge.setZoneOverlay(zones); } catch { }
            } catch { }
            if (typeof data?.backgroundColor === 'string') {
              setEditor(s => ({ ...s, backgroundColor: data.backgroundColor }));
              try { gameBridge.setBackgroundColor(data.backgroundColor); } catch { }
            }
            if (Array.isArray(data?.editorGround) || Array.isArray(data?.editorWalls) || Array.isArray(data?.collision)) {
              // Nach erfolgreichem Laden: direkt in Szene anwenden
              try { gameBridge.reloadEditorLayers(); } catch { }
            }
            if (Array.isArray(data?.assets) && data.assets.length > 0) {
              // Editor-Assets in UI/Scene anwenden
              setEditor(s => ({ ...s, assets: data.assets }));
              // gameBridge.setEditorAssets wird automatisch durch EditorService-Subscription aufgerufen
            }
            if (data?.spawn && typeof data.spawn.x === 'number') {
              setEditor(s => ({ ...s, spawn: { x: data.spawn.x, y: data.spawn.y } }));
              try { gameBridge.setSpawnMarker({ x: data.spawn.x, y: data.spawn.y }); } catch { }
            }
          }
        } catch { }
      })();
    } catch { }
  }, [me]); // Läuft nur wenn User eingeloggt ist

  // Reset von Auswahl beim Kategorienwechsel
  React.useEffect(() => {
    setEditor(s => {
      // Beim Wechsel der Kategorie: pendingAsset entfernen, Ghost-Vorschau entfernen
      try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch { }
      // Standard: Keine aktive Aktion nach Tab-Wechsel
      return { ...s, pendingAsset: null, tool: 'select' };
    });
  }, [editor.category]);

  // Tool-Wechsel: Asset-Ghost deaktivieren, wenn nicht 'asset'
  React.useEffect(() => {
    if (editor.tool !== 'asset') {
      try { (window as any).currentPhaserScene?.setAssetPreview?.(null); } catch { }
    }
  }, [editor.tool]);

  // Auto-Save: Zonen automatisch speichern nach Änderungen (EditorService subscription)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZonesHashRef = React.useRef<string>('');

  React.useEffect(() => {
    if (!me) return; // Nur wenn eingeloggt

    const unsubscribe = EditorService.subscribe((state) => {
      if (!state.active) return; // Nur wenn Editor aktiv

      // Einfacher Hash: JSON-String der Zonen
      const currentHash = JSON.stringify(state.zones || []);
      const hasChanged = currentHash !== prevZonesHashRef.current;

      if (hasChanged && prevZonesHashRef.current !== '') { // Nicht beim ersten Laden
        // Debounce: Warte 800ms nach letzter Änderung, dann speichern
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = setTimeout(() => {
          console.debug('[EDITOR] Auto-saving zones...', { count: (state.zones || []).length });
          saveAllToServer().then(saved => {
            if (saved) {
              console.debug('[EDITOR] Zones auto-saved successfully');
              try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Auto-Speichern', description: 'Zonen wurden automatisch gespeichert', intent: 'success' } })); } catch { }
            }
          });
        }, 800);
      }

      prevZonesHashRef.current = currentHash;
    });

    return () => unsubscribe();
  }, [me]);



  async function saveAllToServer() {
    try {
      // WICHTIG: Aktuellen State vom EditorService holen, nicht aus lokalem useState!
      const currentState = EditorService.getState();
      const tilesets = currentState.tilesets || editor.tilesets || [];
      const assets = currentState.assets || editor.assets || [];
      const zones = currentState.zones || editor.zones;
      const backgroundColor = currentState.backgroundColor || editor.backgroundColor || '#202020';
      const spawn = currentState.spawn || editor.spawn || undefined; // undefined statt null!
      const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';

      // Payload: nur definierte Werte senden
      const payload: any = { tilesets, assets, zones, backgroundColor };
      if (spawn && typeof spawn.x === 'number' && typeof spawn.y === 'number') {
        payload.spawn = spawn;
      }

      const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: `Server antwortete mit ${res.status}`, intent: 'error' } })); } catch { }
        return false;
      }
      // Notify other users to reload from server
      colyseusRef.current?.send?.('editor_update', { type: 'reload_all' });
      return true;
    } catch {
      try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Speichern fehlgeschlagen', description: 'Netzwerk- oder Serverfehler', intent: 'error' } })); } catch { }
      return false;
    }
  }

  // Nutzerverwaltung als Overlay: Spiel/AV laufen weiter
  // (keine Pause mehr beim Wechsel auf 'users')



  // applyVolumesToUi via Hook

  useEffect(() => {
    // Suppression-Flag für Zonen-Broadcast (verhindert Echo bei eingehenden Updates)
  }, []);

  useEffect(() => {
    if (!authChecked || !me) return;
    if (!containerRef.current) return;
    // Prevent multiple initializations causing WebGL context leaks / WS storms
    if (gameCreatedRef.current) return;
    gameCreatedRef.current = true;
    // Ensure container is clean before creating a new Phaser instance
    try { const el = containerRef.current; while (el && el.firstChild) { el.removeChild(el.firstChild); } } catch { }

    // Colyseus-Verbindung wird exklusiv im useWorldRoom-Hook aufgebaut

    // WICHTIG: Manager und Handler VOR Phaser erstellen, damit onLocalMove bereit ist
    bubbleRef.current = new BubbleManager(64, null);
    followRef.current = new FollowManager(96);
    zoneRef.current = new ZoneManager([], null);
    // Seed Zonen sofort, auch wenn der Editor bisher nie geöffnet war
    try { zoneRef.current.setZones(editor.zones as any); } catch { }

    // WICHTIG: savePosition muss VOR onLocalMove definiert werden (kein Hoisting bei const)
    const savePosition = async (opts?: { immediate?: boolean }) => {
      const currentPos = localPosRef.current;
      const currentDirection = (gameBridge as any).lastDirection || 'down';
      const last = lastSavedPositionRef.current;

      const hasMoved = currentPos.x && currentPos.y && (
        Math.abs(currentPos.x - last.x) > 10 ||
        Math.abs(currentPos.y - last.y) > 10 ||
        currentDirection !== last.direction
      );

      if (!hasMoved && !opts?.immediate) return;

      // Update ref immediately
      lastSavedPositionRef.current = {
        x: currentPos.x || last.x,
        y: currentPos.y || last.y,
        direction: currentDirection
      };

      const payload = JSON.stringify({
        x: Math.round(lastSavedPositionRef.current.x),
        y: Math.round(lastSavedPositionRef.current.y),
        direction: lastSavedPositionRef.current.direction
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
            keepalive: !!opts?.immediate,
            body: payload
          });
        }
      } catch { }
    };

    // Stelle sicher, dass ZoneManager initial eine Position bekommt, auch bevor Colyseus onLocalMove feuert
    let lastZone: string | null = null;
    gameBridge.onLocalMove = (p) => {
      localPosRef.current.x = p.x;
      localPosRef.current.y = p.y;
      (gameBridge as any).lastDirection = p.direction;
      zoneRef.current?.update({ x: p.x, y: p.y });
      // Bubble: Ankunft direkt beim Movement prüfen
      try {
        const pending = bubblePendingRef.current;
        if (pending) {
          let arrived = false;
          if (pending.dest) {
            const dx = (p.x || 0) - pending.dest.x;
            const dy = (p.y || 0) - pending.dest.y;
            arrived = (dx * dx + dy * dy) < 12 * 12;
          }
          if (!arrived) {
            const t = remotesRef.current[pending.targetId];
            if (t) {
              const dx = (p.x || 0) - t.x;
              const dy = (p.y || 0) - t.y;
              arrived = (dx * dx + dy * dy) < 20 * 20;
            }
          }
          if (arrived) {
            try { followRef.current?.stop?.(); } catch { }
            try { gameBridge.setDesiredPosition(null); } catch { }
            try { activateBubbleNowRef.current(pending.targetId); } catch { }
            bubblePendingRef.current = null;
          }
        }
      } catch { }

      // Check if zone changed
      const zones = zoneRef.current?.getZones?.() || [];
      const currentZone = zones.find(z => pointInPolygon({ x: p.x, y: p.y }, z.points));
      const currentZoneName = currentZone?.name || null;

      if (currentZoneName !== lastZone) {
        lastZone = currentZoneName;
        // Rebuild participant list when zone changes
        setTimeout(buildParticipantList, 50);
        // Force volume update when zone changes
        applyVolumesToUi();
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
            // Manuelle Navigation aktiv? Dann gewünschte Position halten, bis Ziel erreicht
            const target = manualNavRef.current;
            if (target) {
              const dx = (target.x ?? 0) - p.x;
              const dy = (target.y ?? 0) - p.y;
              const dist = Math.hypot(dx, dy);
              if (dist <= 12) {
                manualNavRef.current = null;
                gameBridge.setDesiredPosition(null);
              } else {
                gameBridge.setDesiredPosition({ x: target.x, y: target.y });
              }
            } else {
              gameBridge.setDesiredPosition(null);
            }
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

      // Debounced position save after movement stops
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
      }
      moveTimeoutRef.current = setTimeout(() => {
        void savePosition();
        moveTimeoutRef.current = null;
      }, 1000);
    };
    
    // JETZT erst Phaser erstellen - nachdem gameBridge.onLocalMove gesetzt ist
    const game = createPhaserGame(containerRef.current);
    
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
          const pos = localPosRef.current;
          if (pos.id && typeof pos.x === 'number' && typeof pos.y === 'number') {
            return { id: pos.id, x: pos.x, y: pos.y };
          }
          return null;
        },
        getRemotes: () => {
          // Always return all remotes - DND is handled in VolumeManager
          return remotesRef.current;
        },
        getZones: () => zoneRef.current?.getZones?.() || [],
        getFollowTarget: () => followRef.current?.getTarget?.() || null,
        getBubbleGroups: () => bubbleGroupsRef.current,
        getLocalDnd: () => dndRef.current,
      },
      { nearRadius: 96, farRadius: 384, outsideBubbleAttenuation: 0.05 }
    );
    // Direkt nach Szenenstart versuchen, lokal gespeicherte Editor-Layer zu laden
    setTimeout(() => {
      try { gameBridge.reloadEditorLayers(); } catch { }
      // Set hero name with a small delay to ensure scene is ready
      const heroName = me.name || me.email || 'You';
      setTimeout(() => {
        try { gameBridge.setHeroName(heroName); } catch { }
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

        // Handle object deletion
        if (prev.tool === 'erase' && prev.category === 'objects') {
          // Find object at position
          const clickRadius = 16; // Tolerance for clicking
          const clickedAsset = prev.assets.find(a =>
            Math.abs(a.x - x) < clickRadius && Math.abs(a.y - y) < clickRadius
          );

          if (clickedAsset) {
            const assets = prev.assets.filter(a => a.id !== clickedAsset.id);
            // gameBridge.setEditorAssets wird automatisch durch EditorService-Subscription aufgerufen
            return { ...prev, assets };
          }
          return prev;
        }

        // Asset placement is now handled via EditorService.dispatch('PLACE_ASSET')
        // Legacy tilePaint-based placement has been removed

        // Legacy Asset-Placement deaktiviert; Editor nutzt tile-basierte Platzierung
        return prev;
      });
    };

    // startBubbleTo ist oben initialisiert und im Ref hinterlegt

    gameBridge.onRightClick = ({ x, y, playerId }) => {
      if (editorActiveRef.current) return;
      if (!playerId) return;
      try { console.debug('[UI] context menu for', playerId, 'at', x, y); } catch { }
      // Öffne Kontextmenü-UI
      setContextMenu({ open: true, x, y, playerId });
    };
    // Tile-basierte Pointer-Events werden jetzt in EditorInputHandler gebunden

    return () => {
      try { gameBridge.setSceneApi?.(null); } catch { }
      destroyPhaserGame(game);
      // Remove any leftover canvases to free WebGL contexts
      try { const el = containerRef.current; while (el && el.firstChild) { el.removeChild(el.firstChild); } } catch { }
      // Leave Colyseus room only if connection is open
      try {
        const room: any = colyseusRef.current;
        const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
        const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
        if (isOpen) room.leave();
      } catch { }
      try { avRef.current?.leave?.(); } catch { }
      try { if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current); } catch { }
      // HUD-Ticker Cleanup wird vom Hook übernommen
      if (moveTimeoutRef.current) {
        clearTimeout(moveTimeoutRef.current);
      }
      // Position-Persistenz cleanup wird im Hook gehandhabt
    };
  }, [authChecked, me?.id, apiBase]);


  // Global Audio Track Manager - ausgelagert
  useGlobalAudioTracks({ avRef });
  // Re-apply Volumes when remote audio topology changes (screenshare on/off, resubscribe)
  React.useEffect(() => {
    let off: (() => void) | null = null;
    (async () => {
      try {
        const mod: any = await import('../../lib/avEvents');
        off = mod.onAudioTracksChanged?.(() => {
          try { applyVolumesToUi(); } catch { }
        }) || null;
      } catch { }
    })();
    return () => { try { off?.(); } catch { } };
  }, []);

  useDndShortcut({ enabled: !!(authChecked && me), dndRef, avRef, setAvState, colyseusRef, volumeRef, gameBridge });

  // Zonen-Handling/Sync (ausgelagert)
  useZonesSync({ editor, setEditor, zoneRef, gameBridge, colyseusRef });

  // Bubble-Navigation (ausgelagert)
  const { startBubbleTo, activateBubbleNow } = useBubbleNavigation({
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
  const activateBubbleNowRef = React.useRef<(id: string) => void>(() => { });
  activateBubbleNowRef.current = activateBubbleNow;
  bubbleStartRef.current = (id: string) => {
    try {
      let dest: { x: number; y: number } | undefined = undefined;
      try {
        const free = gameBridge.findFreeSpotNear(id, { radius: 16, step: 16 });
        if (free) dest = { x: free.x, y: free.y };
      } catch { }
      bubblePendingRef.current = dest ? { targetId: id, dest } : { targetId: id };
    } catch { }
    try { startBubbleTo(id); } catch { }
  };

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
      try { followRef.current?.stop?.(); } catch { }
      try { gameBridge.setDesiredPosition(null); } catch { }
      try { activateBubbleNow(targetId); } catch { }
    },
  });

  // REMOVED: gameBridge.setEditorAssets wird jetzt durch EditorService-Subscription in bridge.ts aufgerufen
  // Kein separater useEffect mehr nötig - verhindert doppelte Calls

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
    try { (gameBridge as any).onCameraManualChange = handler; } catch { }
    return () => {
      try { (gameBridge as any).onCameraManualChange = () => { }; } catch { }
    };
  }, []);

  // Editor Bridge: verbindet Pointer-Events der Szene mit der Editor-Logik (Zonen/Spawn)
  // (bereits früher aufgerufen)

  // Event-basierter Sync des echten AV-Zustands (Mic/Cam/Share) in avState
  React.useEffect(() => {
    let removeHandlers: (() => void) | null = null;
    let pollTimer: any = null;
    let watcher: any = null;
    const applyNow = async () => {
      try {
        const mod: any = await import('../../av/core/localState');
        const roomAny: any = avRef.current?.room as any;
        if (!roomAny) return;
        const mic = mod.isLocalMicOn(roomAny);
        const cam = mod.isLocalCamOn(roomAny);
        let share = false;
        try { share = mod.isLocalShareOn(roomAny); } catch { }
        setAvState(s => ({ ...s, mic, cam, ...(typeof share === 'boolean' ? { share } : {}) }));
      } catch { }
    };
    const installHandlersForRoom = async (room: any) => {
      try {
        const lk: any = await import('livekit-client');
        const RoomEvent = (lk as any).RoomEvent;
        const onAny = () => { void applyNow(); };
        if (RoomEvent) {
          room.on?.(RoomEvent.LocalTrackPublished, onAny);
          room.on?.(RoomEvent.LocalTrackUnpublished, onAny);
          room.on?.(RoomEvent.TrackMuted, onAny);
          room.on?.(RoomEvent.TrackUnmuted, onAny);
          room.on?.(RoomEvent.ConnectionStateChanged, onAny);
          removeHandlers = () => {
            try {
              room.off?.(RoomEvent.LocalTrackPublished, onAny);
              room.off?.(RoomEvent.LocalTrackUnpublished, onAny);
              room.off?.(RoomEvent.TrackMuted, onAny);
              room.off?.(RoomEvent.TrackUnmuted, onAny);
              room.off?.(RoomEvent.ConnectionStateChanged, onAny);
            } catch { }
          };
        } else {
          room.on?.('localTrackPublished', onAny);
          room.on?.('localTrackUnpublished', onAny);
          room.on?.('trackMuted', onAny);
          room.on?.('trackUnmuted', onAny);
          room.on?.('connectionStateChanged', onAny);
          removeHandlers = () => {
            try {
              room.off?.('localTrackPublished', onAny);
              room.off?.('localTrackUnpublished', onAny);
              room.off?.('trackMuted', onAny);
              room.off?.('trackUnmuted', onAny);
              room.off?.('connectionStateChanged', onAny);
            } catch { }
          };
        }
      } catch { }
      void applyNow();
    };
    // Wenn Room noch nicht da ist: zyklisch prüfen und nachträglich Handler setzen
    watcher = setInterval(() => {
      const room: any = avRef.current?.room as any;
      if (!room) {
        // bis dahin leichter Poll, damit UI nicht veraltet ist
        if (!pollTimer) pollTimer = setInterval(applyNow, 750);
        return;
      }
      // Room ist verfügbar → Listener setzen, Poller beenden
      try { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } } catch { }
      clearInterval(watcher);
      watcher = null;
      void installHandlersForRoom(room);
    }, 500);
    // initialen State einmal lesen
    void applyNow();
    return () => {
      try { removeHandlers?.(); } catch { }
      try { clearInterval(pollTimer); } catch { }
      try { if (watcher) clearInterval(watcher); } catch { }
    };
  }, []);

  if (!authChecked) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Lade…</div>
    );
  }
  if (!me) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start', padding: '6vh 6vw' }}>
        <div>
          <h2 style={{ margin: '8px 0' }}>Anmelden</h2>
          <AuthScreen baseUrl={apiBase} onDone={async () => { await fetchMe(); }} />
        </div>
        <div>
          <h2 style={{ margin: '8px 0' }}>Registrieren (neuen Mandanten anlegen)</h2>
          <Signup apiBase={apiBase} onSuccess={(slug) => {
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
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Position wird geladen…</div>
    );
  }

  const participantsToRender = uiParticipants.length > 0
    ? uiParticipants
    : [{ sid: (avRef.current?.room?.localParticipant?.sid ?? 'local'), identity: me.name || me.email, hasVideo: false, hasMic: avState.mic, isSpeaking: false, media: 'camera' as const }];

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'grid', gridTemplateColumns: '1fr auto' }}>
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
                reason={connStatus.lastReason ?? (typeof connStatus.lastCode === 'number' ? String(connStatus.lastCode) : '')}
              />
            ) : null}
            {positionReady ? (
              <div
                ref={containerRef}
                style={{ width: '100%', height: '100%', position: 'relative' }}
                onContextMenu={(e) => { e.preventDefault(); }}
              >
                {avState.dnd && (
                  <div
                    onClick={(e) => { e.stopPropagation(); }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onMouseUp={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onPointerUp={(e) => { e.stopPropagation(); e.preventDefault(); }}
                    onWheel={(e) => { e.stopPropagation(); e.preventDefault(); }}
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
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--fg-subtle)' }}>Starte Welt…</div>
            )}

            {/* Admin Overlay (einzige Instanz) */}
            {isInternalOwner && (
              <>
                <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60 }}>
                  <Button onClick={() => setAdminOpen(true)} variant="ghost">Admin</Button>
                </div>
                <AdminOverlay apiBase={apiBase} open={adminOpen} onOpenChange={setAdminOpen} />
              </>
            )}
            {/* ParticipantOverlay über Overlays */}

            {/* Bottom Control Bar (hidden in editor mode) */}
            {!editor.active && (
              <div style={{ position: 'absolute', bottom: 16, left: 0, right: 0, zIndex: 30, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                <div style={{ pointerEvents: 'auto', maxWidth: 'calc(100vw - 32px)', display: 'flex', justifyContent: 'center' }}>
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
                          } catch { }
                        }, 400);
                      } catch { }
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
                      } catch (e) { }
                    }}
                    onToggleDnd={async () => {
                      const next = !avState.dnd;
                      try { await avRef.current?.setDoNotDisturb(next); } catch { }
                      try { gameBridge.setDoNotDisturb(next); } catch { }
                      try { gameBridge.setMovementLocked(next); } catch { }
                      if (next) {
                        try { await avRef.current?.setMicrophoneEnabled(false); } catch { }
                        try { await avRef.current?.setCameraEnabled(false); } catch { }
                        try { await avRef.current?.stopScreenshare(); } catch { }
                        try {
                          const room: any = avRef.current?.room as any;
                          if (room?.remoteParticipants) {
                            const participants: any[] = Array.from((room.remoteParticipants as any).values());
                            for (const p of participants) {
                              const sid = (p as any)?.sid;
                              if (sid) {
                                try { avRef.current?.setParticipantVolume(sid, 0); } catch { }
                              }
                            }
                          }
                        } catch { }
                      }
                      dndRef.current = next;
                      setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
                      try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch { }
                      try { volumeRef.current?.update(); } catch { }
                      // Verifiziere echten Zustand nach kurzer Zeit und gleiche UI an
                      setTimeout(async () => {
                        try {
                          const mod: any = await import('../../av/core/localState');
                          const r: any = avRef.current?.room as any;
                          if (!r) return;
                          const realMic = mod.isLocalMicOn(r);
                          const realCam = mod.isLocalCamOn(r);
                          let realShare = false;
                          try { realShare = mod.isLocalShareOn(r); } catch { }
                          setAvState(s => ({ ...s, mic: next ? false : realMic, cam: next ? false : realCam, share: next ? false : realShare }));
                        } catch { }
                      }, 450);
                    }}
                    cameraManual={cameraManual}
                    onRecenter={() => { try { gameBridge.recenterCamera(); } catch { } }}
                  />
                </div>
              </div>
            )}
          </>
        )}

        <Modal open={userModalOpen} onOpenChange={setUserModalOpen} title="Benutzerverwaltung" maxWidth={900} right={<div style={{ display: 'flex', gap: 8 }}><ThemeToggleButton /></div>}>
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
            try { await avRef.current?.leave?.(); } catch { }
            try {
              const room: any = colyseusRef.current;
              const wsReadyState = room?.connection?.ws?.readyState ?? room?.connection?.transport?.ws?.readyState ?? room?.connection?._transport?.ws?.readyState;
              const isOpen = room?.connection?.isOpen === true || wsReadyState === 1;
              if (isOpen) await room.leave();
            } catch { }
            try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { }
            try { localStorage.clear(); } catch { }
            try { sessionStorage.clear(); } catch { }
            try {
              const parts = (document.cookie || '').split(';');
              for (const raw of parts) {
                const name = raw.split('=')[0]?.trim();
                if (!name) continue;
                document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
              }
            } catch { }
            window.location.reload();
          }}
          onToggleEditor={async () => {
            const isCurrentlyActive = editor.active;
            if (isCurrentlyActive) {
              await saveAllToServer().catch(() => { });
            }
            // Toggle über EditorService (wird automatisch mit setEditor synchronisiert)
            if (isCurrentlyActive) {
              EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
            } else {
              EditorService.dispatch({ type: 'ACTIVATE_EDITOR' });
            }
            setMenuOpen(false);
          }}
          editorActive={editor.active}
          onLogout={async () => { try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { setMe(null); setMenuOpen(false); setPage('world'); } }}

        />

      </div>
      {/* Rechte Roster-Leiste (volle Höhe) */}
      <RosterPanel
        roster={roster}
        collapsed={rosterCollapsed}
        onToggleCollapse={() => setRosterCollapsed(v => !v)}
        onJumpTo={(r) => {
          try {
            if (typeof r.x === 'number' && typeof r.y === 'number') {
              manualNavRef.current = { x: r.x!, y: r.y! };
              gameBridge.setDesiredPosition({ x: r.x!, y: r.y! });
              try { (window as any).currentPhaserScene?.cameras?.main?.pan?.(r.x!, r.y!, 250, 'Sine.easeInOut'); } catch { }
            }
          } catch { }
        }} />

      {/* API Token Modal */}
      <ApiTokensOverlay
        open={apiModalOpen}
        onClose={() => setApiModalOpen(false)}
        apiBase={apiBase}
        apiTokens={apiTokens}
        setApiTokens={setApiTokens}
        newTokenName={newTokenName}
        setNewTokenName={setNewTokenName}
        freshToken={freshToken}
        setFreshToken={setFreshToken}
      />

      <EditorWindow
        onSave={saveAllToServer}
        onClose={() => {
          EditorService.dispatch({ type: 'DEACTIVATE_EDITOR' });
        }}
      />

      {/* Tileset Upload Dialog ausgelagert in EditorWindow */}

      {/* Bubble Banner */}
      <BubbleBanner
        active={bubbleUi.active}
        members={bubbleUi.members}
        onLeave={() => {
          const set = bubbleMembersRef.current;
          set.clear();
          try { gameBridge.setBubbleMembers(new Set()); } catch { }
          try { gameBridge.setMovementLocked(false); } catch { }
          // Entferne nur mich aus meiner bestehenden Bubble-Gruppe (Gruppe nicht komplett löschen)
          try {
            const meId = localPosRef.current.id;
            const myGroup = meId ? (bubbleGroupsRef.current[meId] || null) : null;
            if (meId && myGroup) {
              const currentMembers = Object.entries(bubbleGroupsRef.current)
                .filter(([, _gid]) => _gid === myGroup)
                .map(([sid]) => sid);
              const remaining = currentMembers.filter((sid) => sid !== meId);
              colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: remaining });
            }
          } catch { }
          setBubbleUi({ active: false, members: [] });
          setTimeout(() => applyVolumesToUi(), 0);
        }}
      />

      {/* Kontextmenü */}
      {contextMenu.open && contextMenu.playerId && (
        <div onClick={() => setContextMenu({ open: false, x: 0, y: 0, playerId: null })} onContextMenu={(e) => e.preventDefault()} style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: Math.min(Math.max(8, contextMenu.x), window.innerWidth - 196), top: Math.min(Math.max(8, contextMenu.y), window.innerHeight - 96), background: 'rgba(17,17,20,0.98)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
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
            }} style={{ display: 'block', padding: '8px 12px', background: 'transparent', color: '#fff', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)', width: 180, textAlign: 'left', cursor: 'pointer' }}>Folgen</button>
            {/* In fremde Bubble beitreten (wenn Zielspieler in einer Bubble ist und ich nicht bereits in derselben) */}
            {(() => {
              try {
                const target = contextMenu.playerId!;
                const targetGroup = target ? (bubbleGroupsRef.current[target] || null) : null;
                const meId = localPosRef.current.id;
                const myGroup = meId ? (bubbleGroupsRef.current[meId] || null) : null;
                return !!targetGroup && targetGroup !== myGroup;
              } catch { return false; }
            })() && (
                <button onClick={() => {
                  setContextMenu({ open: false, x: 0, y: 0, playerId: null });
                  try {
                    const target = contextMenu.playerId!;
                    const targetGroup = bubbleGroupsRef.current[target];
                    const meId = localPosRef.current.id;
                    if (!target || !targetGroup || !meId) return;
                    // Mitglieder der Ziel-Bubble + mich
                    const currentMembers = Object.entries(bubbleGroupsRef.current)
                      .filter(([, _gid]) => _gid === targetGroup)
                      .map(([sid]) => sid);
                    const next = Array.from(new Set([...currentMembers, meId]));
                    colyseusRef.current?.send?.('bubble_update', { id: targetGroup, members: next });
                  } catch { }
                }} style={{ display: 'block', padding: '8px 12px', background: 'transparent', color: '#fff', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)', width: 180, textAlign: 'left', cursor: 'pointer' }}>Bubble beitreten</button>
              )}
            {/* Zur bestehenden Bubble hinzufügen (nur anzeigen, wenn ich bereits in einer Bubble bin) */}
            {(() => {
              try {
                const meId = localPosRef.current.id;
                const myGroup = meId ? (bubbleGroupsRef.current[meId] || null) : null;
                return !!myGroup;
              } catch { return false; }
            })() && (
                <button onClick={() => {
                  setContextMenu({ open: false, x: 0, y: 0, playerId: null });
                  try {
                    const id = contextMenu.playerId!;
                    const meId = localPosRef.current.id;
                    if (!meId || !id || meId === id) return;
                    const myGroup = bubbleGroupsRef.current[meId];
                    if (!myGroup) return;
                    // Bilde neue Menge: bestehende Gruppenmitglieder + Zielspieler
                    const currentMembers = Object.entries(bubbleGroupsRef.current)
                      .filter(([, _gid]) => _gid === myGroup)
                      .map(([sid]) => sid);
                    const next = Array.from(new Set([...currentMembers, id]));
                    colyseusRef.current?.send?.('bubble_update', { id: myGroup, members: next });
                  } catch { }
                }} style={{ display: 'block', padding: '8px 12px', background: 'transparent', color: '#fff', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.08)', width: 180, textAlign: 'left', cursor: 'pointer' }}>Zur Bubble hinzufügen</button>
              )}
            <button onClick={() => {
              setContextMenu({ open: false, x: 0, y: 0, playerId: null });
              const id = contextMenu.playerId!;
              bubbleStartRef.current?.(id);
            }} style={{ display: 'block', padding: '8px 12px', background: 'transparent', color: '#fff', border: 'none', width: 180, textAlign: 'left', cursor: 'pointer' }}>Bubble starten</button>
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


