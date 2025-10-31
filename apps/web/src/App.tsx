import React, { useEffect, useRef } from 'react';
import { FAIcon } from './ui/FAIcon';
import { ThemeProvider, AppShell, ThemeToggleButton } from './ui/theme';
import { Overlay } from './ui/Overlay';
import { Button, Card, Input, Toolbar, Modal } from './ui/components';
import { AVBar } from './ui/av';
import { TilesetUploadDialog } from './ui/editor/TilesetUploadDialog';
import { UserCardContainer } from './ui/user';
import { EditorPanel } from './ui/editor/EditorPanel';
import { useEditor } from './hooks/useEditor';
import { createPhaserGame, destroyPhaserGame } from './game/phaserGame';
import { gameBridge } from './game/bridge';
import { joinWorld } from './lib/colyseus';
import { AVManager } from './av/avManager';
import { BubbleManager } from './game/bubbleManager';
import { FollowManager } from './game/followManager';
import { ZoneManager } from './game/zoneManager';
import { VolumeManager } from './game/volumeManager';
import { getDisplayName as getDisplayNameLib } from './lib/displayName';
// (removed duplicate incorrect import)

// Helper function for point in polygon check
function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (((pi.y > p.y) !== (pj.y > p.y)) && (p.x < (pj.x - pi.x) * (p.y - pi.y) / (pj.y - pi.y + 1e-9) + pi.x)) {
      c = !c;
    }
  }
  return c;
}

// (lokale Inline-Icons entfernt; Nutzung erfolgt über FAIcon)

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
  const rightClickTimerRef = useRef<any>(null);
  const lastRightClickRef = useRef<{ colyseusId: string; livekitIdentity: string; time: number } | null>(null);
  const localPosRef = useRef<{ id: string; x: number; y: number }>({ id: '', x: 0, y: 0 });
  const remotesRef = useRef<Record<string, { x: number; y: number }>>({});
  const colyseusToLivekitMap = useRef<Record<string, string>>({});
  const identityToNameMap = useRef<Record<string, string>>({});
  // const livekitSidToColyseusMap = useRef<Record<string, string>>({});
  const [hud, setHud] = React.useState<{ zone?: string; follow?: string | null; avRoom?: string | null }>({});
  const [devices, setDevices] = React.useState<{ mics: { id: string; label: string }[]; cams: { id: string; label: string }[] }>({ mics: [], cams: [] });
  const [avState, setAvState] = React.useState<{ mic: boolean; cam: boolean; share: boolean; dnd: boolean }>({ mic: false, cam: false, share: false, dnd: false });
  const [selectedMicId, setSelectedMicId] = React.useState<string | ''>('');
  const [selectedCamId, setSelectedCamId] = React.useState<string | ''>('');
  const [uiParticipants, setUiParticipants] = React.useState<{ sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[]>([]);
  const participantVolumesRef = useRef<Record<string, number>>({});
  const dndRef = useRef<boolean>(false);
  const prevAvBeforeDndRef = React.useRef<{ mic: boolean; cam: boolean } | null>(null);
  const [cameraManual, setCameraManual] = React.useState(false);
  React.useEffect(() => {
    const handler = (active: boolean) => setCameraManual(!!active);
    try { (gameBridge as any).onCameraManualChange = handler; } catch {}
    return () => { try { (gameBridge as any).onCameraManualChange = () => {}; } catch {} };
  }, []);

  // Intercept DND toggles to resume AV after DND is turned off
  React.useEffect(() => {
    const gb: any = gameBridge as any;
    const originalSetDnd = gb.setDoNotDisturb;
    if (typeof originalSetDnd !== 'function') return;
    gb.setDoNotDisturb = (enabled: boolean) => {
      try { originalSetDnd?.(!!enabled); } catch {}
      dndRef.current = !!enabled;
      if (enabled) {
        // Capture current AV publish state to restore later
        try {
          const room: any = avRef.current?.room as any;
          let hasMic = false, hasCam = false;
          const pubs = Array.from(room?.localParticipant?.trackPublications?.values?.() || []);
          for (const pub of pubs) {
            const src = (pub as any)?.source ?? (pub as any)?.track?.source;
            const kind = (pub as any)?.kind ?? (pub as any)?.track?.kind;
            if ((kind === 'audio' || src === 'microphone' || src === 0) && (pub as any)?.track) hasMic = true;
            if (((kind === 'video' && src !== 'screen_share') || src === 'camera' || src === 1) && (pub as any)?.track) hasCam = true;
          }
          prevAvBeforeDndRef.current = { mic: hasMic, cam: hasCam };
        } catch {
          prevAvBeforeDndRef.current = prevAvBeforeDndRef.current || { mic: false, cam: false };
        }
      } else {
        // Resume audio playback (autoplay policies) and restore previous mic/cam
        try { (avRef.current?.room as any)?.startAudio?.(); } catch {}
        const prev = prevAvBeforeDndRef.current;
        prevAvBeforeDndRef.current = null;
        if (prev) {
          try { if (prev.mic) void avRef.current?.setMicrophoneEnabled(true); } catch {}
          try { if (prev.cam) void avRef.current?.setCameraEnabled(true); } catch {}
        }
      }
    };
    return () => { try { gb.setDoNotDisturb = originalSetDnd; } catch {} };
  }, []);
  // Auth state
  const [authChecked, setAuthChecked] = React.useState(false);
  const [me, setMe] = React.useState<{ id: string; email: string; name?: string } | null>(null);
  // API Tokens & Settings
  const [apiModalOpen, setApiModalOpen] = React.useState(false);
  const [apiTokens, setApiTokens] = React.useState<{ id: string; name?: string | null; createdAt: string; lastUsedAt?: string | null }[]>([]);
  const [newTokenName, setNewTokenName] = React.useState('');
  const [freshToken, setFreshToken] = React.useState<string | null>(null);
  // view/state werden in AuthScreen verwaltet
  // Grid Overlay expand/collapse + selection
  const [gridExpanded, setGridExpanded] = React.useState(false);
  const [selectedSid, setSelectedSid] = React.useState<string | null>(null);
  const [overlayZoom, setOverlayZoom] = React.useState(1);
  // Simple view routing
  const [page, setPage] = React.useState<'world' | 'profile'>('world');
  const [userModalOpen, setUserModalOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const editorActiveRef = React.useRef(false);
  const connectLivekitRef = React.useRef<null | (() => Promise<void>)>(null);
  // Bubble UI state
  const [bubbleUi, setBubbleUi] = React.useState<{ active: boolean; members: string[] }>({ active: false, members: [] });
  // Pending bubble navigation until arrival near target
  const bubblePendingRef = React.useRef<{ targetId: string; dest?: { x: number; y: number } } | null>(null);
  // Kontextmenü State
  const [contextMenu, setContextMenu] = React.useState<{ open: boolean; x: number; y: number; playerId: string | null }>({ open: false, x: 0, y: 0, playerId: null });
  // Expose bubble start from effect to JSX
  const bubbleStartRef = React.useRef<null | ((id: string) => void)>(null);
  const disposedRef = React.useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  // Define apiBase before using it
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}:2567`
      : 'http://localhost:2567');

  // Laden der Tokenliste beim Öffnen des Modals
  useEffect(() => {
    if (!apiModalOpen) return;
    (async () => {
      try {
        setFreshToken(null);
        const res = await fetch(`${apiBase}/api-tokens`, { credentials: 'include' });
        if (res.ok) setApiTokens(await res.json());
      } catch {}
    })();
  }, [apiModalOpen, apiBase]);
  const isConnectingRef = React.useRef(false);
  // Map Editor State (moved to hook)
  const [editor, setEditor] = useEditor();
  React.useEffect(() => { editorActiveRef.current = editor.active; }, [editor.active]);
  
  // Collision-Overlay: Sichtbarkeit steuert ausschließlich der Edit-Mode

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
        // Store last position if available
        if (u.lastPosition) {
          localPosRef.current = { id: u.id, x: u.lastPosition.x, y: u.lastPosition.y };
          // Make position available to Phaser scene
          (window as any).initialPlayerPosition = { 
            x: u.lastPosition.x, 
            y: u.lastPosition.y 
          };
        }
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

  // Editor: Tile-basierte Pointer-Events für Drag-Selektion (Terrain, Floor, Walls, Collision)
  useEffect(() => {
    if (page !== 'world') return;
    const scene: any = (window as any).currentPhaserScene;
    const setRectPx = (drag: { startTileX: number; startTileY: number; endTileX: number; endTileY: number }) => {
      try {
        const map = scene?.mapRef;
        if (!map) return;
        const x0 = Math.min(drag.startTileX, drag.endTileX) * map.tileWidth;
        const y0 = Math.min(drag.startTileY, drag.endTileY) * map.tileHeight;
        const x1 = Math.max(drag.startTileX, drag.endTileX) * map.tileWidth + map.tileWidth;
        const y1 = Math.max(drag.startTileY, drag.endTileY) * map.tileHeight + map.tileHeight;
        scene?.setSelectionRect?.({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } catch {}
    };
    gameBridge.onPointerDownTile = ({ tileX, tileY }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY } }));
      setRectPx({ startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY });
    };
    gameBridge.onPointerMoveTile = ({ tileX, tileY }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        setRectPx(drag);
        // Live-Malen während des Drags (kein Broadcast, nur lokale Szene)
        const rect = { startX: drag.startTileX, startY: drag.startTileY, endX: drag.endTileX, endY: drag.endTileY };
        const isErase = s.tool === 'erase';
        if (s.tool === 'terrain' && s.pendingTerrain) {
          if (isErase) {
            try { (window as any).currentPhaserScene?.eraseTerrainRect?.(rect); } catch {}
          } else {
            try { (window as any).currentPhaserScene?.applyTerrainPaint?.({ rect, dataUrl: s.pendingTerrain.dataUrl }); } catch {}
          }
        }
        if ((s.tool === 'floor' || s.tool === 'walls' || isErase) && s.tilePaint) {
          const index = isErase ? -1 : s.tilePaint.tileIndex;
          const layer = s.tool === 'walls' ? 'EditorWalls' : 'EditorGround';
          const edit = { layer: layer as 'EditorGround' | 'EditorWalls', tilesetKey: s.tilePaint.tilesetKey, tileIndex: index, rect };
          try { gameBridge.applyTilePaint(edit); } catch {}
        }
        if (s.tool === 'collision' || isErase) {
          const index = isErase ? -1 : 1;
          const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: index, rect };
          try { (window as any).currentPhaserScene?.applyTilePaint?.(edit); } catch {}
        }
        return { ...s, drag };
      });
    };
    gameBridge.onPointerUpTile = ({ tileX, tileY }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        const rect = { startX: drag.startTileX, startY: drag.startTileY, endX: drag.endTileX, endY: drag.endTileY };
        gameBridge.setSelectionRect(null);
        const isErase = s.tool === 'erase';
        // Terrain: echte Tiles (Variante 2)
        if (s.tool === 'terrain' && s.pendingTerrain) {
          if (isErase) {
            (window as any).currentPhaserScene?.eraseTerrainRect?.(rect);
          } else {
            (window as any).currentPhaserScene?.applyTerrainPaint?.({ rect, dataUrl: s.pendingTerrain.dataUrl });
          }
          return { ...s, drag: null };
        }
        // Boden/Wände
        if ((s.tool === 'floor' || s.tool === 'walls' || isErase) && s.tilePaint) {
          const index = isErase ? -1 : s.tilePaint.tileIndex;
          const layer = s.tool === 'walls' ? 'EditorWalls' : 'EditorGround';
          const edit = { layer: layer as 'EditorGround' | 'EditorWalls', tilesetKey: s.tilePaint.tilesetKey, tileIndex: index, rect };
          gameBridge.applyTilePaint(edit);
          return { ...s, drag: null };
        }
        // Kollision
        if (s.tool === 'collision' || isErase) {
          const index = isErase ? -1 : 1;
          const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: index, rect };
          // Editor-Seite anwenden und gleich speichern (Sichtbarkeit direkt an)
          try { (window as any).currentPhaserScene?.applyTilePaint?.(edit); } catch {}
          return { ...s, drag: null };
        }
        return { ...s, drag: null };
      });
    };
    return () => {
      // Aufräumen: Handler zurücksetzen
      try {
        gameBridge.onPointerDownTile = () => {};
        gameBridge.onPointerMoveTile = () => {};
        gameBridge.onPointerUpTile = () => {};
      } catch {}
    };
  }, [page, setEditor]);

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
          gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0 });
        }
      } catch {}
      // Bereits vorhandene Editor-Layer sofort anwenden (falls vorhanden)
      try { gameBridge.reloadEditorLayers(); } catch {}
      // Server-state laden (best-effort) – bei 404 Map anlegen und lokalen Stand hochladen
      (async () => {
        try {
          const res = await fetch(`${apiBase}/maps/office/editor-state`, { credentials: 'include' });
          console.log("SPEICHERN! 224");
          if (res.ok) {
            const data = await res.json();
            if (data?.tilesets) try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(data.tilesets)); } catch {}
            if (data?.assets) try { localStorage.setItem('meetropolis.assets', JSON.stringify(data.assets)); } catch {}
            if (data?.zones) try {
              const zones = Array.isArray(data.zones) ? data.zones.map((z:any)=>{
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
              if (zones.some(z => Array.isArray(z.points) && z.points.length > 0)) {
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
            if (Array.isArray(data?.editorGround) || Array.isArray(data?.collision)) {
              try { localStorage.setItem('meetropolis.editorLayers', JSON.stringify({ editorGround: data.editorGround, collision: data.collision, w: undefined, h: undefined })); } catch {}
              // Nach erfolgreichem Laden: direkt in Szene anwenden
              try { gameBridge.reloadEditorLayers(); } catch {}
            }
            if (Array.isArray(data?.assets)) {
              // Editor-Assets in UI/Scene anwenden
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
            if (Array.isArray(zones) && zones.some((z:any)=> Array.isArray(z?.points) && z.points.length > 0)) {
              payload.zones = zones;
              payload.replaceZones = true;
            }
            console.log("SPEICHERN! 264", payload);
            const body = JSON.stringify(payload);
            if (body.length < 100000) {
              await fetch(`${apiBase}/maps/office/editor-state`, {
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

  // Grid-basiertes Platzieren von Pack-Items
  React.useEffect(() => {
    const tileSize = 16; // Map tile size (office)

    const placeAsset = (tileX: number, tileY: number) => {
      const p = editor.pendingAsset;
      if (!p) return;
      const x = tileX * tileSize + tileSize / 2;
      const y = tileY * tileSize + tileSize / 2;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: { id: string; key: string; dataUrl: string; x: number; y: number; packUuid?: string; itemId?: string; category?: 'structures' | 'objects'; collide?: boolean; width?: number; height?: number } = { id, key: p.key, dataUrl: p.dataUrl, x, y };
      if (p.packUuid) next.packUuid = p.packUuid;
      if (p.itemId) next.itemId = p.itemId;
      if (p.category) next.category = p.category;
      if (p.collide) next.collide = true;
      if (typeof p.width === 'number') next.width = p.width;
      if (typeof p.height === 'number') next.height = p.height;
      setEditor(s => {
        const assets = [...s.assets, next];
        try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
        try { gameBridge.setEditorAssets(assets); } catch {}
        if (next.collide === true) {
          const wTiles = Math.max(1, Math.round(((next.width ?? tileSize) / tileSize)));
          const hTiles = Math.max(1, Math.round(((next.height ?? tileSize) / tileSize)));
          const startX = tileX - Math.floor(wTiles / 2);
          const startY = tileY - Math.floor(hTiles / 2);
          const endX = startX + wTiles - 1;
          const endY = startY + hTiles - 1;
          try { gameBridge.applyTilePaint({ layer: 'Collision', tilesetKey: 'collision_tiles', tileIndex: 0, rect: { startX, startY, endX, endY } }); } catch {}
        }
        return { ...s, assets };
      });
    };

    const beginDrag = (tileX: number, tileY: number) => {
      setEditor(s => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY } }));
      // Initiales Ghost-Rect
      try {
        const x0 = tileX * tileSize;
        const y0 = tileY * tileSize;
        gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize });
      } catch {}
    };
    const updateDrag = (tileX: number, tileY: number) => {
      setEditor(s => {
        if (!s.drag) return s;
        const next = { ...s.drag, endTileX: tileX, endTileY: tileY };
        try {
          const x0 = Math.min(next.startTileX, next.endTileX) * tileSize;
          const y0 = Math.min(next.startTileY, next.endTileY) * tileSize;
          const x1 = (Math.max(next.startTileX, next.endTileX) + 1) * tileSize;
          const y1 = (Math.max(next.startTileY, next.endTileY) + 1) * tileSize;
          gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        } catch {}
        return { ...s, drag: next };
      });
    };
    const endDragPaint = (layer: 'EditorGround' | 'Collision', tilesetKey: string, tileIndex: number) => {
      setEditor(s => {
        const d = s.drag;
        if (!d) return s;
        const rect = { startX: Math.min(d.startTileX, d.endTileX), startY: Math.min(d.startTileY, d.endTileY), endX: Math.max(d.startTileX, d.endTileX), endY: Math.max(d.startTileY, d.endTileY) };
        try { gameBridge.applyTilePaint({ layer, tilesetKey, tileIndex, rect }); } catch {}
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, drag: null };
      });
    };
    const endDragZone = () => {
      setEditor(s => {
        const d = s.drag;
        if (!d) return s;
        const x0 = Math.min(d.startTileX, d.endTileX) * tileSize;
        const y0 = Math.min(d.startTileY, d.endTileY) * tileSize;
        const x1 = (Math.max(d.startTileX, d.endTileX) + 1) * tileSize;
        const y1 = (Math.max(d.startTileY, d.endTileY) + 1) * tileSize;
        const poly = [ { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 } ];
        const zones = s.zones.slice();
        zones.push({ name: s.name || 'Zone', points: poly } as any);
        try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
        try { gameBridge.setZoneOverlay(zones as any); } catch {}
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, zones, drag: null, editingZoneIndex: null, tool: 'select' };
      });
    };

    const handleDown = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'asset' && editor.pendingAsset) {
        placeAsset(tileX, tileY);
        return;
      }
      if (editor.tool === 'floor' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
        beginDrag(tileX, tileY);
        return;
      }
      if (editor.tool === 'collision' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
        beginDrag(tileX, tileY);
        return;
      }
      if (editor.tool === 'erase' && editor.category === 'terrain') {
        beginDrag(tileX, tileY);
        return;
      }
      if (editor.tool === 'erase' && (editor.category === 'objects' || editor.category === 'structures')) {
        const x = tileX * tileSize + tileSize / 2;
        const y = tileY * tileSize + tileSize / 2;
        setEditor(s => {
          const radius = tileSize / 2;
          const idx = [...s.assets].reverse().findIndex(a => Math.abs(a.x - x) <= radius && Math.abs(a.y - y) <= radius);
          if (idx === -1) return s;
          const realIdx = s.assets.length - 1 - idx;
          const assets = s.assets.slice();
          assets.splice(realIdx, 1);
          try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
          try { gameBridge.setEditorAssets(assets); } catch {}
          return { ...s, assets };
        });
        return;
      }
      if (editor.tool === 'zone') {
        beginDrag(tileX, tileY);
        return;
      }
    };
    const handleMove = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'asset' && editor.pendingAsset) {
        // Vorschau nicht bei jeder Bewegung neu setzen (verursacht Flackern);
        // die Szene aktualisiert die Ghost-Position selbst in pointermove.
        return;
      }
      // Terrain/Zonen Ghost (1x1) und Drag-Update
      if (editor.tool === 'floor' || editor.tool === 'collision') {
        if (editor.drag) {
          updateDrag(tileX, tileY);
        } else if (editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
          const x0 = tileX * tileSize;
          const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      if (editor.tool === 'erase' && editor.category === 'terrain') {
        if (editor.drag) updateDrag(tileX, tileY);
        else {
          const x0 = tileX * tileSize;
          const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      if (editor.tool === 'zone') {
        if (editor.drag) {
          updateDrag(tileX, tileY);
        } else {
          const x0 = tileX * tileSize;
          const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      // Default: keine Vorschau
      try { gameBridge.setSelectionRect(null); } catch {}
    };
    const handleUp = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'floor' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
        if (!editor.drag) return;
        endDragPaint('EditorGround', editor.tilePaint.tilesetKey, editor.tilePaint.tileIndex);
        return;
      }
      if (editor.tool === 'collision' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
        if (!editor.drag) return;
        endDragPaint('Collision', editor.tilePaint.tilesetKey, editor.tilePaint.tileIndex);
        return;
      }
      if (editor.tool === 'erase' && editor.category === 'terrain') {
        if (!editor.drag) return;
        // Erase sowohl Boden als auch Kollision im gewählten Bereich
        setEditor(s => {
          const d = s.drag!;
          const rect = { startX: Math.min(d.startTileX, d.endTileX), startY: Math.min(d.startTileY, d.endTileY), endX: Math.max(d.startTileX, d.endTileX), endY: Math.max(d.startTileY, d.endTileY) };
          try { gameBridge.applyTilePaint({ layer: 'EditorGround', tilesetKey: s.tilePaint?.tilesetKey || 'office_tiles', tileIndex: -1, rect }); } catch {}
          try { gameBridge.applyTilePaint({ layer: 'Collision', tilesetKey: 'collision_tiles', tileIndex: -1, rect }); } catch {}
          try { gameBridge.setSelectionRect(null); } catch {}
          return { ...s, drag: null };
        });
        return;
      }
      if (editor.tool === 'zone') {
        if (!editor.drag) return;
        endDragZone();
        return;
      }
    };
    const noop = () => {};
    try {
      (gameBridge as any).onPointerDownTile = handleDown;
      (gameBridge as any).onPointerMoveTile = handleMove;
      (gameBridge as any).onPointerUpTile = handleUp;
    } catch {}
    return () => {
      try {
        (gameBridge as any).onPointerDownTile = noop;
        (gameBridge as any).onPointerMoveTile = noop;
        (gameBridge as any).onPointerUpTile = noop;
      } catch {}
    };
  }, [editor.active, editor.tool, editor.pendingAsset, editor.tilePaint, editor.drag, editor.name, editor.editingZoneIndex]);

  async function saveAllToServer() {
    try {
      const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
      const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
      const zones = editor.zones;
      const layers = JSON.parse(localStorage.getItem('meetropolis.editorLayers') || '{}');
      const backgroundColor = localStorage.getItem('meetropolis.backgroundColor') || '#202020';
      await fetch(`${apiBase}/maps/office/editor-state`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editorGround: layers.editorGround ?? null, editorWalls: layers.editorWalls ?? null, collision: layers.collision ?? null, tilesets, assets, zones, backgroundColor })
      });
      // Notify other users to reload from server
      colyseusRef.current?.send?.('editor_update', { type: 'reload_all' });
    } catch {}
  }

  // Nutzerverwaltung als Overlay: Spiel/AV laufen weiter
  // (keine Pause mehr beim Wechsel auf 'users')

  // Helper function to get display name for a LiveKit identity (moved to lib)
  const getDisplayName = (identity: string): string => getDisplayNameLib(identity, identityToNameMap.current, me);

  // (verschoben) applyVolumesToUi wird unterhalb von buildParticipantList definiert

  const buildParticipantList = React.useCallback(() => {
    const room: any = avRef.current?.room as any;
    if (!room || !room.localParticipant) {
      // Fallback: Kein LiveKit-Raum – baue Karten aus Colyseus-Remotes + Local (mit Zonenfilter)
      const list: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[] = [];
      try {
        // Local
        const localIdentity = me?.name || me?.email || me?.id || 'You';
        list.push({ sid: 'local', identity: localIdentity, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1 });
        const zones = (zoneRef.current?.getZones?.() || []).map(z => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p:any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p:any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
        const localPos = { x: localPosRef.current.x, y: localPosRef.current.y };
        const localZone = zones.find(z => pointInPolygon(localPos, z.points));
        // Remotes (aus Colyseus)
        for (const [colyseusId, pos] of Object.entries(remotesRef.current || {})) {
          // Zonenfilter
          try {
            const remoteZone = zones.find(z => pointInPolygon(pos as any, z.points));
            if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
              continue;
            }
          } catch {}
          const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
          const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
          // Verwende Colyseus-ID als Pseudo-SID, damit Keys stabil sind
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1 });
        }
      } catch {}
      setUiParticipants(list);
      return;
    }
    // buildParticipantList - participants
    
    // Get current local zone
    const zones = (zoneRef.current?.getZones?.() || []).map(z => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p:any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p:any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
    const localPos = { x: localPosRef.current.x, y: localPosRef.current.y };
    const localZone = zones.find(z => pointInPolygon(localPos, z.points));
    
    const activeSet = new Set<string>((room.activeSpeakers || []).map((p: any) => p.sid));
    const list: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera' | 'screen'; volume?: number }[] = [];
    const pushP = (p: any, isLocal: boolean = false) => {
      if (!p) return;
      
      // Get participant position for zone check
      let participantPos: { x: number; y: number } | null = null;
      if (isLocal) {
        participantPos = localPos;
      } else {
        // Find remote participant position by their identity
        const colyseusId = Object.keys(colyseusToLivekitMap.current).find(
          key => colyseusToLivekitMap.current[key] === p.identity
        );
        if (colyseusId && remotesRef.current[colyseusId]) {
          participantPos = remotesRef.current[colyseusId];
        }
      }
      
      // Zonenfilter: Nur Teilnehmer in gleicher Zone anzeigen. Falls Position unbekannt → konservativ ausblenden.
      if (!isLocal) {
        if (!participantPos) {
          try {
            const publications = Array.from((p.trackPublications?.values?.() || []) as any);
            for (const pub of publications) {
              const source = (pub?.source || pub?.track?.source);
              const kind = pub?.kind ?? pub?.track?.kind;
              if (source === 'camera' || source === 'screen_share' || kind === 'audio') {
                try { pub?.setSubscribed?.(false); } catch {}
              }
            }
          } catch {}
          return;
        }
        const remoteZone = zones.find(z => pointInPolygon(participantPos!, z.points));
        if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
          try {
            const publications = Array.from((p.trackPublications?.values?.() || []) as any);
            for (const pub of publications) {
              const source = (pub?.source || pub?.track?.source);
              const kind = pub?.kind ?? pub?.track?.kind;
              if (source === 'camera' || source === 'screen_share' || kind === 'audio') {
                try { pub?.setSubscribed?.(false); } catch {}
              }
            }
          } catch {}
          return;
        }
      }
      
      try {
        const publications = Array.from((p.trackPublications?.values?.() || []) as any);
        // Erzwinge Subscribe f fcr Remote-Kamera/Screenshare
        if (!isLocal) {
          try {
            for (const pub of publications) {
              const source = (pub?.source || pub?.track?.source);
              if (source === 'camera' || source === 'screen_share') {
                try { pub?.setSubscribed?.(true); } catch {}
                try { pub?.setVideoQuality?.('high'); } catch {}
              }
            }
          } catch {}
        }
        const isVideoPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          // Kamera an nur wenn Camera-Quelle; Screenshare ausklammern
          return (!!pub?.track && (source === 'camera' || source === 1));
        };
        const isMicPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          const kind = pub?.kind ?? pub?.track?.kind;
          return (!!pub?.track && (kind === 'audio' || source === 'microphone' || source === 0));
        };
        const isScreenPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          // Kartenanzeige auch ohne bereits abonnierten Track, sobald screen_share publiziert wurde
          return (source === 'screen_share' || source === 2);
        };
        const hasV = publications.some(isVideoPub);
        const hasMic = publications.some(isMicPub);
        const hasScreen = publications.some(isScreenPub);
      // DisplayName: zuerst Mapping, dann p.name, dann fallback
      let displayName = identityToNameMap.current[p.identity] || p.name || p.identity || 'User';
      if (p && p.sid === room.localParticipant?.sid) {
        displayName = me?.name || me?.email || displayName;
      }
      // Fallback-Kürzung nur wenn immer noch wie rohe ID wirkt
      if (!identityToNameMap.current[p.identity] && !p.name) {
        if (displayName.length > 20 && /^[a-zA-Z0-9]+$/.test(displayName)) {
          displayName = `User ${displayName.substring(0, 6)}`;
        }
      }
      const identity = displayName;
      
      // Get volume for this participant using last computed volumes
      let volume = 1;
      try {
        const last = volumeRef.current?.getLastVolumes?.() || {} as Record<string, number>;
        if (!isLocal) {
          const colyseusIdForIdentity = Object.keys(colyseusToLivekitMap.current).find(
            key => colyseusToLivekitMap.current[key] === p.identity
          );
          if (colyseusIdForIdentity && typeof last[colyseusIdForIdentity] === 'number') {
            volume = last[colyseusIdForIdentity];
          }
        }
      } catch {}
      
      // Kamera-/Audio-Karte: immer anzeigen, wenn der Teilnehmer online ist.
      // hasVideo steuert nur die Videoanzeige, nicht die Sichtbarkeit der Karte.
      list.push({ sid: p.sid, identity, hasVideo: !!hasV, hasMic: !!hasMic, isSpeaking: activeSet.has(p.sid), media: 'camera', volume });
      // Screenshare als eigene Karte (auch wenn Track noch nicht abonniert ist)
      if (hasScreen) {
        list.push({ sid: p.sid + ':screen', identity: `${identity} – Bildschirm`, hasVideo: true, hasMic: false, isSpeaking: false, media: 'screen', volume });
      }
      } catch (e) {
      }
    };
    pushP(room.localParticipant, true); // true = isLocal
    const remotes = Array.from((room.remoteParticipants?.values?.() || room.participants?.values?.() || []) as any);
    // Processing remote participants
    for (const rp of remotes) {
      pushP(rp, false);
    }
    // Merge in Colyseus remotes to avoid gaps when LiveKit has delays (mit Zonenfilter)
    try {
      const presentIdentities = new Set<string>(list.map(p => p.identity));
      for (const [colyseusId, _pos] of Object.entries(remotesRef.current || {})) {
        const livekitIdentity = colyseusToLivekitMap.current[colyseusId] || colyseusId;
        const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
        // Zonenfilter anhand Position
        try {
          const zones = (zoneRef.current?.getZones?.() || []).map(z => ({ ...z, points: (Array.isArray(z.points) ? z.points : []).map((p:any)=> Array.isArray(p) ? { x: p[0], y: p[1] } : p).filter((p:any)=> p && typeof p.x === 'number' && typeof p.y === 'number') }));
          const localPos = { x: localPosRef.current.x, y: localPosRef.current.y };
          const localZone = zones.find(z => pointInPolygon(localPos, z.points));
          const pos = remotesRef.current[colyseusId];
          const remoteZone = pos ? zones.find(z => pointInPolygon(pos, z.points)) : null;
          if ((localZone && !remoteZone) || (!localZone && remoteZone) || (localZone && remoteZone && localZone.name !== remoteZone.name)) {
            continue;
          }
        } catch {}
        if (!presentIdentities.has(name) && !presentIdentities.has(livekitIdentity)) {
          list.push({ sid: `col:${colyseusId}`, identity: name, hasVideo: false, hasMic: false, isSpeaking: false, media: 'camera', volume: 1 });
          presentIdentities.add(name);
        }
      }
    } catch {}
    // Final participant list
    setUiParticipants(list);
    // Trigger early rebuild shortly after to account for late position sync (ensures zone filter applies when remotesRef fills)
    try { setTimeout(() => { if (!disposedRef.current) buildParticipantList(); }, 150); } catch {}
    
    // Update speaking states in the game
    // Use the activeSpeakers from LiveKit directly
    const speakingIds = new Set<string>();
    const activeSpeakers = room.activeSpeakers || [];
    
    // Process active speakers
    
    activeSpeakers.forEach((speaker: any) => {
      // Check if it's the local participant
      if (speaker.sid === room.localParticipant?.sid) {
        speakingIds.add('local');
      } else {
        // For remote participants, we need to find their Colyseus ID
        // The speaker has an identity field which should match what we stored
        // Find ALL matching Colyseus IDs (there might be multiple due to reconnects)
        const matchingColyseusIds = Object.entries(colyseusToLivekitMap.current)
          .filter(([_, livekitIdentity]) => livekitIdentity === speaker.identity)
          .map(([colyseusId]) => colyseusId);
        
        if (matchingColyseusIds.length > 0) {
          // Check which one is currently active in remotesRef
          const activeColyseusId = matchingColyseusIds.find(id => id in remotesRef.current);
          if (activeColyseusId) {
            speakingIds.add(activeColyseusId);
          } else {
          }
        } else {
        }
      }
    });
    
    gameBridge.updateSpeakingStates(speakingIds);
  }, [me]);

  // Wendet berechnete Volumes auf die UI an und baut die Teilnehmerliste neu
  const applyVolumesToUi = React.useCallback(() => {
    const vols = volumeRef.current?.update() || {};
    const next: Record<string, number> = {};
    for (const [colyseusId, vol] of Object.entries(vols)) {
      const livekitIdentity = colyseusToLivekitMap.current[colyseusId];
      if (livekitIdentity) {
        // Map auf LiveKit-Identity
        next[livekitIdentity] = vol;
        // Zusätzlich auf den in der UI verwendeten Anzeigenamen mappen
        try {
          const display = getDisplayName(livekitIdentity);
          if (display) next[display] = vol;
          // Screen-Suffix für Screen-Karten hinzufügen
          next[`${display} – Bildschirm`] = vol;
        } catch {}
      }
    }
    // Mergen statt Ersetzen, um kurzzeitig fehlende Mappings nicht zu verlieren
    participantVolumesRef.current = { ...participantVolumesRef.current, ...next };
    try { buildParticipantList(); } catch {}
  }, [buildParticipantList]);

  useEffect(() => {
    // Suppression-Flag für Zonen-Broadcast (verhindert Echo bei eingehenden Updates)
  }, []);

  const suppressZoneBroadcastRef = React.useRef(false);

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
            // Trigger participant grid build for the new joiner
            try { setTimeout(buildParticipantList, 0); } catch {}
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
            try { setTimeout(buildParticipantList, 50); } catch {}
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
            try { setTimeout(buildParticipantList, 50); } catch {}
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
          try { setTimeout(buildParticipantList, 50); } catch {}
        });
        
        room.onMessage('player_dnd', (data: { id: string; dnd: boolean }) => {
          if (gameBridge?.updateRemotePlayerDnd) {
            gameBridge.updateRemotePlayerDnd(data.id, data.dnd);
          }
          // DND affects visibility/opacity in UI cards
          try { setTimeout(buildParticipantList, 50); } catch {}
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
              try { setTimeout(buildParticipantList, 0); } catch {}
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
            setDndStatus(payload.dnd);
            if (colyseusRef.current) {
              colyseusRef.current.send('dnd_status', { dnd: payload.dnd });
            }
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
        };
        // Add manual state check first
        if (room.state && room.state.players) {
          room.state.players.forEach(() => {});
        }
        
        room.onStateChange((state: any) => {
          
          const players: Record<string, { x: number; y: number; direction: any }> = {};
          
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
                const name = identityToNameMap.current[livekitIdentity] || getDisplayName(livekitIdentity);
                return [id, { ...p, name }];
              })
          );
          gameBridge.syncRemotePlayers(filteredPlayers);
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
        // Remote control commands from server (API-driven)
        room.onMessage('remote_control', async (payload: { mic?: boolean; cam?: boolean; share?: boolean; dnd?: boolean }) => {
          try {
            if (typeof payload.dnd === 'boolean') {
              const next = payload.dnd;
              try { gameBridge.setDoNotDisturb(next); } catch {}
              if (next) {
                try { await avRef.current?.setMicrophoneEnabled(false); } catch {}
                try { await avRef.current?.setCameraEnabled(false); } catch {}
                try { await avRef.current?.stopScreenshare(); } catch {}
              }
              setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
              dndRef.current = next;
              // Send DND status to server
              try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
            }
            if (typeof payload.mic === 'boolean' && !dndRef.current) {
              const enabled = payload.mic;
              try { await avRef.current?.setMicrophoneEnabled(enabled); } catch {}
              setAvState(s => ({ ...s, mic: enabled }));
            }
            if (typeof payload.cam === 'boolean' && !dndRef.current) {
              const enabled = payload.cam;
              try { await avRef.current?.setCameraEnabled(enabled); } catch {}
              setAvState(s => ({ ...s, cam: enabled }));
            }
            if (typeof payload.share === 'boolean' && !dndRef.current) {
              if (payload.share && !avState.share) {
                try { const ok = await avRef.current?.startScreenshare(); if (ok) setAvState(s => ({ ...s, share: true })); } catch {}
              } else if (!payload.share && avState.share) {
                try { await avRef.current?.stopScreenshare(); setAvState(s => ({ ...s, share: false })); } catch {}
              }
            }
          } catch {}
        });

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

    // LiveKit nach User-Geste verbinden
    const identity = me.id;
    const displayName = me.name || me.email || me.id;
    const connectLivekit = async () => {
      // Im Editor-Modus nie LiveKit initialisieren (verhindert Blocking/Errors)
      if (editorActiveRef.current) return;
      if (isConnectingRef.current) return; // Verhindere doppelte Verbindung
      if (avRef.current?.room) return; // Bereits verbunden
      
      isConnectingRef.current = true;
      try {
        avRef.current = new AVManager({ 
          baseUrl: apiBase, 
          identity, 
          displayName,
          useVideo: import.meta.env.VITE_FEATURE_VOICE_ONLY !== 'true' 
        });
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
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.ParticipantDisconnected, () => {
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackPublished, (_publication: any, _participant: any) => {
                  try {
                    const source = (_publication?.source || _publication?.track?.source);
                    const isRemote = _participant?.sid !== room.localParticipant?.sid;
                    if (isRemote && (source === 'screen_share' || source === 'camera')) {
                      try { _publication?.setSubscribed?.(true); } catch {}
                      try { _publication?.setVideoQuality?.('high'); } catch {}
                    }
                  } catch {}
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackUnpublished, () => {
                  setTimeout(buildParticipantList, 100);
                });
                room.on(RoomEvent.TrackSubscribed, (track: any, _publication: any, _participant: any) => {
                  if (((_publication as any)?.source || (track as any)?.source) === 'screen_share') {
                    setTimeout(buildParticipantList, 200);
                  }
                });
                room.on(RoomEvent.ActiveSpeakersChanged, () => {
                  buildParticipantList();
                });
              }
            } catch {}
          })();
        }
        // Mikrofon-Zustand beibehalten: nicht automatisch aktivieren
        // Der sichtbare Zustand wird über LiveKit-Events/buildParticipantList synchronisiert
        // erst listen, dann sicher bauen
        setTimeout(buildParticipantList, 50);
      } catch (e) {
        // Editor weiterhin bedienbar halten
        try { bubbleRef.current?.setAV(null as any); } catch {}
        try { zoneRef.current?.setAV(null as any); } catch {}
        isConnectingRef.current = false; // Reset flag on error
      } finally {
        isConnectingRef.current = false; // Reset flag when done
      }
    };
    connectLivekitRef.current = connectLivekit;
    // Auto-Connect LiveKit (ohne User-Geste) – publiziert keine Tracks automatisch
    setTimeout(() => {
      try {
        if (!editorActiveRef.current && connectLivekitRef.current && !avRef.current?.room && !isConnectingRef.current) {
          connectLivekitRef.current();
        }
      } catch {}
    }, 300);

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
    // Editor-Click-Handler
    gameBridge.onPointerDown = ({ x, y }) => {
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
        
        // Handle legacy asset placement
        if (prev.tool === 'asset' && prev.pendingAsset) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
          const asset = { id, key: prev.pendingAsset.key + ':' + id, dataUrl: prev.pendingAsset.dataUrl, x: snappedX, y: snappedY };
          const assets = [...prev.assets, asset];
          try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
          gameBridge.setEditorAssets(assets);
          return { ...prev, assets, pendingAsset: null };
        }
        return prev;
      });
    };
    
    const activateBubbleNow = (targetId: string) => {
      // Set members
      bubbleMembersRef.current.clear();
      if (localPosRef.current.id) bubbleMembersRef.current.add(localPosRef.current.id);
      bubbleMembersRef.current.add(targetId);
      try { gameBridge.setMovementLocked(true); } catch {}
      // Visuals
      const visual = new Set<string>();
      if (localPosRef.current.id) visual.add('__local__');
      visual.add(targetId);
      try { gameBridge.setBubbleMembers(visual); } catch {}
      // Broadcast
      try { colyseusRef.current?.send?.('bubble_update', { members: Array.from(bubbleMembersRef.current) }); } catch {}
      // UI names
      const names: string[] = [];
      const identity = colyseusToLivekitMap.current[targetId] || targetId;
      const name = identityToNameMap.current[identity] || getDisplayName(identity);
      names.push(name);
      setBubbleUi({ active: true, members: names });
      applyVolumesToUi();
      bubblePendingRef.current = null;
    };

    const startBubbleTo = (targetColyseusId: string) => {
      try { console.debug('[Bubble] startBubbleTo', targetColyseusId); } catch {}
      // Wenn schon nah genug am Ziel, direkt aktivieren
      const targetPos = remotesRef.current[targetColyseusId];
      if (targetPos) {
        const dx0 = (localPosRef.current.x || 0) - targetPos.x;
        const dy0 = (localPosRef.current.y || 0) - targetPos.y;
        if (dx0*dx0 + dy0*dy0 < 20*20) {
          try { console.debug('[Bubble] already near target, activating'); } catch {}
          activateBubbleNow(targetColyseusId);
          return;
        }
      }
      // Während der Navigation: keine Sperre aktivieren
      try { gameBridge.setMovementLocked(false); } catch {}
      bubblePendingRef.current = { targetId: targetColyseusId };
      // Follow immer starten, damit kontinuierliche Interpolation greift
      try { console.debug('[Bubble] start following', targetColyseusId); } catch {}
      followRef.current?.startFollowing?.(targetColyseusId);
      // Optional: freien Spot als initialen Hint setzen
      try {
        const free = gameBridge.findFreeSpotNear(targetColyseusId, { radius: 16, step: 16 });
        if (free) {
          try { console.debug('[Bubble] hint desiredPos (free spot)', free); } catch {}
          gameBridge.setDesiredPosition({ x: free.x, y: free.y });
        } else if (targetPos) {
          try { console.debug('[Bubble] hint desiredPos (target pos)', targetPos); } catch {}
          gameBridge.setDesiredPosition({ x: targetPos.x, y: targetPos.y });
        }
      } catch {}
    };
    bubbleStartRef.current = startBubbleTo;

    gameBridge.onRightClick = ({ x, y, playerId }) => {
      if (editorActiveRef.current) return;
      if (!playerId) return;
      try { console.debug('[UI] context menu for', playerId, 'at', x, y); } catch {}
      // Öffne Kontextmenü-UI
      setContextMenu({ open: true, x, y, playerId });
    };
    // Tile-basierte Selektion/Malen
    gameBridge.onPointerDownTile = ({ tileX, tileY }) => {
      if (!editorActiveRef.current) return; // Only handle in editor mode
      setEditor(s => {
        return { ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY } };
      });
      const tw = 16, th = 16;
      gameBridge.setSelectionRect({ x: tileX * tw, y: tileY * th, w: tw, h: th });
    };
    gameBridge.onPointerMoveTile = ({ tileX, tileY }) => {
      if (!editorActiveRef.current) return; // Only handle in editor mode
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
      if (!editorActiveRef.current) return; // Only handle in editor mode
      setEditor(s => {
        if (!s.drag) {
          return s;
        }
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        const rect = { startX: drag.startTileX, startY: drag.startTileY, endX: drag.endTileX, endY: drag.endTileY };
        gameBridge.setSelectionRect(null);
        const isErase = s.tool === 'erase';
        if (s.tool === 'terrain' && s.pendingTerrain && !isErase) {
          // Neues Terrain-Painting: sende direkt an Szene, kein Tileset nötig
          (window as any).currentPhaserScene?.applyTerrainPaint?.({ rect, dataUrl: s.pendingTerrain.dataUrl });
        }
        if ((s.tool === 'floor' || s.tool === 'walls' || isErase) && s.tilePaint) {
          const index = isErase ? -1 : s.tilePaint.tileIndex;
          const layer = s.tool === 'walls' ? 'EditorWalls' : 'EditorGround';
          const edit = { layer: layer as 'EditorGround' | 'EditorWalls', tilesetKey: s.tilePaint.tilesetKey, tileIndex: index, rect };
          gameBridge.applyTilePaint(edit);
          // Broadcast to other users
          colyseusRef.current?.send?.('editor_update', { type: 'tile_paint', edit });
        }
        if (s.tool === 'collision' || isErase) {
          // Kollisionen als solide (Tile-Index 1) markieren; konkrete Indexe hängen vom Tileset ab
          const index = isErase ? -1 : 1;
          const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: index, rect };
          gameBridge.applyTilePaint(edit);
          // Broadcast to other users
          colyseusRef.current?.send?.('editor_update', { type: 'tile_paint', edit });
        }
        if (s.tool === 'zone' || (s.category === 'zones' && s.tool === 'select')) {
          const x0 = Math.min(rect.startX, rect.endX) * 16;
          const y0 = Math.min(rect.startY, rect.endY) * 16;
          const x1 = (Math.max(rect.startX, rect.endX) + 1) * 16;
          const y1 = (Math.max(rect.startY, rect.endY) + 1) * 16;
          const name = (s.name || `Zone ${s.zones.length+1}`).trim();
          const poly = { name, points: [ {x:x0,y:y0}, {x:x1,y:y0}, {x:x1,y:y1}, {x:x0,y:y1} ] };
          // No-overlap rule: reject if rectangle overlaps any existing zone (except the one being edited)
          const rectsOverlap = (a: {x0:number;y0:number;x1:number;y1:number}, b: {x0:number;y0:number;x1:number;y1:number}) => {
            return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
          };
          const newRect = { x0, y0, x1, y1 };
          const hasOverlap = s.zones.some((z, idx) => {
            const editingIdx = s.editingZoneIndex ?? null;
            if (editingIdx !== null && idx === editingIdx) return false;
            if (!z.points || z.points.length < 4) return false;
            const zx0 = Math.min(z.points[0].x, z.points[3].x);
            const zy0 = Math.min(z.points[0].y, z.points[1].y);
            const zx1 = Math.max(z.points[1].x, z.points[2].x);
            const zy1 = Math.max(z.points[2].y, z.points[3].y);
            return rectsOverlap(newRect, { x0: zx0, y0: zy0, x1: zx1, y1: zy1 });
          });
          if (hasOverlap) {
            try { console.warn('[Editor] Zone-Overlap verhindert'); } catch {}
            return { ...s, drag: null };
          }
          const editingIdx = s.editingZoneIndex ?? null;
          const zones = Array.isArray(s.zones) ? s.zones.slice() : [];
          if (editingIdx !== null && editingIdx >= 0 && editingIdx < zones.length) {
            zones[editingIdx] = poly;
          } else {
            zones.push(poly);
          }
          try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
          gameBridge.setZoneOverlay(zones);
          zoneRef.current?.setZones?.(zones as any);
          // Broadcast to other clients
          try { colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: zones }); } catch {}
          // Server speichern (best-effort) – nur wenn Zonen vorhanden
          (async ()=>{ 
            try { 
              const payload: any = {};
              if (Array.isArray(zones) && zones.some(z => Array.isArray((z as any)?.points) && (z as any).points.length > 0)) {
                payload.zones = zones;
                payload.replaceZones = true;
              }
              const body = JSON.stringify(payload);
              console.log("SPEICHERN!");
              if (body.length < 100000 && Object.keys(payload).length > 0) {
                await fetch(`${apiBase}/maps/office/editor-state`, { 
                  method: 'PUT', 
                  credentials: 'include', 
                  headers: { 'Content-Type': 'application/json' }, 
                  body 
                });
              } else {
              }
            } catch {} 
          })();
          return { ...s, zones, drag: null, editingZoneIndex: null };
        }
        return { ...s, drag: null };
      });
    };

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

    // Save position on visibility change/unload to increase reliability
    const onVisibility = () => {
      if (document.hidden) {
        void savePosition({ immediate: true });
      } else {
        // Tab sichtbar: Audio-Wiedergabe wieder anstoßen (Autoplay-Policy)
        try { (avRef.current?.room as any)?.startAudio?.(); } catch {}
        // Versuche die Colyseus-Verbindung zu berühren; falls getrennt, wird so ein Fehler sichtbar
        try { (colyseusRef.current as any)?.send?.('poke', {}); } catch {}
      }
    };
    const onFocus = () => {
      // Auf Fenster-Fokus ebenfalls Audio-Start versuchen
      try { (avRef.current?.room as any)?.startAudio?.(); } catch {}
    };
    const onBeforeUnload = () => { void savePosition({ immediate: true }); };
    const onPageHide = () => { void savePosition({ immediate: true }); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('focus', onFocus);
    
    // Track zone for participant list updates
    let participantListLastZone: string | null = null;
    let lastParticipantUpdate = 0;
    
    const hudTimer = setInterval(() => {
      const z = zoneRef.current?.getCurrent?.();
      const next: { zone?: string; follow?: string | null; avRoom?: string | null } = {
        follow: followRef.current?.getTarget?.() ?? null,
        avRoom: avRef.current?.activeRoom ?? null,
      };
      if (typeof z === 'string') next.zone = z;
      setHud(next);
      
      // Pending bubble navigation handling: check arrival
      if (bubblePendingRef.current && localPosRef.current) {
        const { dest, targetId } = bubblePendingRef.current;
        const targetPos = remotesRef.current[targetId];
        // Consider arrived if near dest OR near the (possibly moving) target
        let arrived = false;
        if (dest) {
          const dx = (localPosRef.current.x || 0) - dest.x;
          const dy = (localPosRef.current.y || 0) - dest.y;
          arrived = (dx*dx + dy*dy) < 12*12;
        }
        if (!arrived && targetPos) {
          const dx = (localPosRef.current.x || 0) - targetPos.x;
          const dy = (localPosRef.current.y || 0) - targetPos.y;
          arrived = (dx*dx + dy*dy) < 20*20;
        }
        if (arrived) {
          // Stop follow and desired motion, then activate bubble
          try { followRef.current?.stop?.(); } catch {}
          try { gameBridge.setDesiredPosition(null); } catch {}
          activateBubbleNow(targetId);
        }
      }
      
      // Check if zone changed for participant list
      if (z !== participantListLastZone || Date.now() - lastParticipantUpdate > 2000) {
        participantListLastZone = z;
        lastParticipantUpdate = Date.now();
        setTimeout(buildParticipantList, 0);
      }

      const room: any = avRef.current?.room as any;
      if (room && room.localParticipant && room.localParticipant.trackPublications) {
        const pubs = Array.from(room.localParticipant.trackPublications?.values?.() || []);
        const isVideoPub = (pub: any) => {
          const source = (pub?.source ?? pub?.track?.source);
          // Kamera zählt nur, wenn Quelle 'camera' ist (Screenshare nicht)
          return (!!pub?.track && (source === 'camera' || source === 1));
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
      const volumes = volumeRef.current?.update();
      if (volumes) {
        participantVolumesRef.current = volumes;
      }
    }, 250);

    return () => {
      disposed = true;
      try { gameBridge.setSceneApi?.(null); } catch {}
      destroyPhaserGame(game);
      colyseusRef.current?.leave?.();
      try { avRef.current?.leave?.(); } catch {}
      try { if (colyseusReconnectTimerRef.current) clearTimeout(colyseusReconnectTimerRef.current); } catch {}
      clearInterval(hudTimer);
      if (moveTimeoutRef) {
        clearTimeout(moveTimeoutRef);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('focus', onFocus);
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
        (audio as any).playsInline = true;
        audio.volume = 1.0;
        // Important: Add audio element to DOM for autoplay to work
        audio.style.display = 'none';
        document.body.appendChild(audio);
        
        // Try to attach and play, but handle autoplay policy gracefully
        track.attach(audio).catch((err: any) => {
          console.warn('Audio autoplay blocked, will retry on user interaction', err);
          // Store for retry on user interaction
          (window as any).pendingAudioTracks = (window as any).pendingAudioTracks || [];
          (window as any).pendingAudioTracks.push({ track, audio, participantId });
        });
        
        audioElements.set(participantId, audio);
      } catch (e) {
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
      }
    };

    const handleTrackSubscribed = (track: any, _publication: any, participant: any) => {
      if (track.kind === 'audio' && participant.sid !== room.localParticipant?.sid) {
        attachAudioTrack(track, participant.sid);
      }
    };

    const handleTrackUnsubscribed = (track: any, _publication: any, participant: any) => {
      if (track.kind === 'audio') {
        detachAudioTrack(participant.sid);
      }
    };

    // Initial setup for existing participants
    const participants = Array.from((room as any).remoteParticipants?.values?.() || (room as any).participants?.values?.() || []);
    
    participants.forEach((participant: any) => {
      if (participant.sid === room.localParticipant?.sid) return;
      
      const audioTracks = Array.from(participant.trackPublications.values())
        .filter((pub: any) => pub.kind === 'audio' && pub.track)
        .map((pub: any) => pub.track);
      
      
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
    // Wait for user interaction before connecting (browser autoplay policy)
    const firstInteract = () => {
      if (!avRef.current?.room && connectLivekitRef.current && !isConnectingRef.current) {
        try { connectLivekitRef.current?.(); } catch {}
      }
      
      // Retry any pending audio tracks after user interaction
      const pendingTracks = (window as any).pendingAudioTracks;
      if (pendingTracks && pendingTracks.length > 0) {
        pendingTracks.forEach(({ track, audio }: any) => {
          try {
            track.attach(audio);
          } catch (e) {
            console.warn('Failed to attach audio track after interaction', e);
          }
        });
        (window as any).pendingAudioTracks = [];
      }
    };
    window.addEventListener('pointerdown', firstInteract, { once: true } as any);
    window.addEventListener('keydown', firstInteract, { once: true } as any);
    // DND Shortcut: Ctrl/Cmd + Shift + D
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        const next = !dndRef.current;
        try { gameBridge.setDoNotDisturb(next); } catch {}
        try { gameBridge.setMovementLocked(next); } catch {}
        if (next) {
          try { avRef.current?.setMicrophoneEnabled(false); } catch {}
          try { avRef.current?.setCameraEnabled(false); } catch {}
          try { avRef.current?.stopScreenshare(); } catch {}
        }
        dndRef.current = next;
        setAvState(s => ({ ...s, dnd: next, mic: next ? false : s.mic, cam: next ? false : s.cam, share: next ? false : s.share }));
        // Send DND status to server
        try { colyseusRef.current?.send?.('dnd_status', { dnd: next }); } catch {}
        try { volumeRef.current?.update(); } catch {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', firstInteract);
      window.removeEventListener('keydown', firstInteract);
      window.removeEventListener('keydown', onKey);
    };
  }, [editor.active, page, authChecked, me]);

  // Wenn Editor-Zonen sich ändern, ins Game-Overlay + ZoneManager schieben (ohne Autosave)
  useEffect(() => {
    const zonesToShow = editor.active ? editor.zones : [];
    gameBridge.setZoneOverlay(zonesToShow);
    zoneRef.current?.setZones?.(editor.zones as any);
    try { localStorage.setItem('meetropolis.zones', JSON.stringify(editor.zones || [])); } catch {}
    if (!suppressZoneBroadcastRef.current) {
      try { colyseusRef.current?.send?.('editor_update', { type: 'zone', polys: editor.zones || [] }); } catch {}
    }
  }, [editor.active, editor.zones]);

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
          {/* Participants Grid Overlay (hidden in editor mode; hidden in DND) */}
          {!editor.active && !avState.dnd && (() => {
            const minCard = gridExpanded ? 480 : 260;
            const gap = gridExpanded ? 18 : 12;
            const count = participantsToRender.length || 1;
            const cols = Math.max(1, Math.min(count, gridExpanded ? 3 : 4));
            
            return (
              <UserCardContainer
                expanded={gridExpanded}
                columns={cols}
                gap={gap}
                onToggleExpand={() => setGridExpanded(e => !e)}
                expandButton={gridExpanded ? <FAIcon size="sm" name="down-left-and-up-right-to-center" variant="solid" ariaLabel="Verkleinern" /> : <FAIcon size="sm" name="up-right-and-down-left-from-center" variant="solid" ariaLabel="Vergrößern" />}
              >
                {participantsToRender.map(p => (
                  <div key={p.sid} onClick={() => setSelectedSid(s => s === p.sid ? null : p.sid)} style={{ cursor: 'pointer', transition: 'transform 180ms ease' }}>
                    <ParticipantCard part={p} roomGetter={getRoom} compact={!gridExpanded} />
                  </div>
                ))}
              </UserCardContainer>
            );
          })()}
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%', position: 'relative' }}
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

          {/* HUD (links oben klein) */}
          <div style={{ position: 'absolute', top: 12, left: 12, background: 'var(--glass)', color: 'var(--fg)', padding: 8, borderRadius: 8, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, backdropFilter: 'blur(6px)', border: '1px solid var(--border)' }}>
            <div>Zone: {hud.zone ?? '-'}</div>
            <div>AV: {hud.avRoom ?? 'lobby'}</div>
            <div>Following: {hud.follow ?? 'no'}</div>
          </div>
          {/* Single Card Fullscreen Overlay (hidden in editor mode; hidden in DND) */}
          {!editor.active && !avState.dnd && selectedSid && (() => {
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
                  await avRef.current?.setMicrophoneEnabled(enabled);
                  setAvState(s => ({ ...s, mic: enabled }));
                }}
                onSelectMic={async (id: string) => {
                  setSelectedMicId(id);
                  await avRef.current?.useMicrophoneDevice(id);
                }}
                onToggleCam={async () => {
                  const enabled = !avState.cam;
                  try {
                    await avRef.current?.setCameraEnabled(enabled);
                    setAvState(s => ({ ...s, cam: enabled }));
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

      <Overlay open={userModalOpen} onClose={()=>setUserModalOpen(false)} title="Benutzerverwaltung" right={<div style={{ display:'flex', gap:8 }}><ThemeToggleButton /></div>}>
        <UserManagement baseUrl={apiBase} onBack={() => setUserModalOpen(false)} />
      </Overlay>

      {/* Profil-Seite ist (noch) nicht implementiert; Stub entfernt */}

      {/* Settings & Theme (oben rechts) */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 40, display: 'flex', gap: 8 }}>
        <ThemeToggleButton />
        <button onClick={() => setMenuOpen(v => !v)} title="Einstellungen" style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--glass)', cursor: 'pointer' }}>
          <GearIcon />
        </button>
        {menuOpen && (
          <div style={{ position: 'absolute', top: 44, right: 0, background: 'rgba(17,17,20,0.96)', color: '#fff', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 8, display: 'grid', gap: 6, minWidth: 260, boxShadow: '0 16px 40px rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}>
            <button onClick={() => { setUserModalOpen(true); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Benutzer verwalten</button>
            <button onClick={() => { setPage('world'); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Zurück zur Welt</button>
            <button onClick={() => { setApiModalOpen(true); setMenuOpen(false); }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>API-Tokens & Doku</button>
            <button onClick={async () => { 
              if (editor.active) { 
                await saveAllToServer().catch(()=>{}); 
              } 
              setEditor(s => ({ ...s, active: !s.active })); 
              setMenuOpen(false); 
              // Update UI based on new editor state after state change
              setTimeout(() => {
                const newEditorState = !editor.active;
                if (newEditorState) {
                  // Enabling editor - show zones
                  gameBridge.setZoneOverlay(editor.zones);
                  // Collision visibility will be handled by useEffect
                } else {
                  // Disabling editor - hide zones
                  gameBridge.setZoneOverlay([]);
                  // Collision visibility will be handled by useEffect
                }
                // Assets are always visible - they are part of the map
              }, 0);
            }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: editor.active ? 'rgba(16,185,129,0.18)' : 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>{editor.active ? 'Editor beenden' : 'Map-Editor öffnen'}</button>
            <button onClick={async () => { try { await fetch(`${apiBase}/auth/logout`, { method: 'POST', credentials: 'include' }); } finally { setMe(null); setMenuOpen(false); setPage('world'); } }} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--glass)', color: 'var(--fg)', cursor: 'pointer' }}>Logout</button>
          </div>
        )}
      </div>

      {/* API Token Modal */}
      <Overlay open={apiModalOpen} onClose={()=>setApiModalOpen(false)} title="API-Zugriff" right={<></>}>
        <div style={{ display:'grid', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#e5e7eb' }}>Mit persönlichen Tokens kannst du dein Mikro, Kamera, Screenshare und den Nicht-stören-Modus remote steuern – solange du online bist.</div>
              <div style={{ display:'flex', gap: 12, alignItems:'center' }}>
                <input value={newTokenName} onChange={e=>setNewTokenName(e.target.value)} placeholder="Token-Name (optional)" style={{ flex:1, padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)', color:'#fff' }} />
                <button onClick={async()=>{
                  try {
                    const res = await fetch(`${apiBase}/api-tokens`, { method:'POST', headers:{ 'Content-Type':'application/json' }, credentials:'include', body: JSON.stringify({ name: newTokenName || undefined }) });
                    if (!res.ok) throw new Error('Token konnte nicht erstellt werden');
                    const data = await res.json();
                    setFreshToken(data.token);
                    setNewTokenName('');
                    // refresh list
                    const list = await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json());
                    setApiTokens(list);
                  } catch (e:any) {
                    alert(e.message || 'Fehler beim Erstellen');
                  }
                }} style={{ padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(16,185,129,0.2)', color:'#10b981' }}>Neuen Token erstellen</button>
              </div>
              {freshToken && (
                <div style={{ padding:10, borderRadius:8, border:'1px solid rgba(16,185,129,0.35)', background:'rgba(16,185,129,0.12)', color:'#d1fae5' }}>
                  <div style={{ fontWeight:600, marginBottom:6 }}>Dein neuer Token (zeige ihn nur einmal an):</div>
                  <code style={{ userSelect:'all' }}>{freshToken}</code>
                </div>
              )}
              <div style={{ fontWeight:600, marginTop: 4 }}>Deine Tokens</div>
              <div style={{ display:'grid', gap:6 }}>
                {(apiTokens||[]).map(t => (
                  <div key={t.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', border:'1px solid rgba(255,255,255,0.12)', borderRadius:8, padding:'8px 10px' }}>
                    <div>
                      <div style={{ fontWeight:600 }}>{t.name || 'Token'}</div>
                      <div style={{ fontSize:12, opacity:0.75 }}>Erstellt: {new Date(t.createdAt).toLocaleString()} {t.lastUsedAt ? `· Zuletzt genutzt: ${new Date(t.lastUsedAt).toLocaleString()}` : ''}</div>
                    </div>
                    <button onClick={async()=>{ try{ await fetch(`${apiBase}/api-tokens/${t.id}`, { method:'DELETE', credentials:'include' }); setApiTokens(await fetch(`${apiBase}/api-tokens`, { credentials:'include' }).then(r=>r.json())); } catch(e:any){ alert(e.message||'Fehler beim Löschen'); } }} style={{ padding:'6px 8px', borderRadius:6, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(239,68,68,0.15)', color:'#fca5a5' }}>Löschen</button>
                  </div>
                ))}
                {!apiTokens?.length && <div style={{ fontSize:13, opacity:0.7 }}>Noch keine Tokens erstellt.</div>}
              </div>
              <div style={{ fontWeight:600 }}>API-Dokumentation</div>
              <div>
                <div style={{ fontWeight:600, marginBottom:6 }}>Base URL</div>
                <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>{apiBase}</code>
              </div>
              <div>
                <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Authentifizierung</div>
                <div style={{ fontSize:13, opacity:0.85 }}>Setze den HTTP Header Authorization: Bearer YOUR_TOKEN</div>
              </div>
              <div>
                <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Steuer-Endpunkt</div>
                <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>POST /controls</code>
                <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Body (JSON, mindestens ein Feld):</div>
                <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)' }}>{`{ "mic": true|false, "cam": true|false, "share": true|false, "dnd": true|false }`}</code>
                <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Antwort: <code>{"{ \"ok\": true, \"delivered\": n }"}</code></div>
                <div style={{ fontSize:13, opacity:0.85, marginTop:6 }}>Hinweise: DND schaltet Mic/Kamera/Share automatisch aus. Steuerung funktioniert nur, wenn du online bist.</div>
              </div>
              <div>
                <div style={{ fontWeight:600, margin:'10px 0 6px' }}>Beispiel</div>
                <code style={{ display:'block', padding:'8px 10px', borderRadius:8, border:'1px solid rgba(255,255,255,0.12)', background:'rgba(0,0,0,0.35)', whiteSpace:'pre-wrap' }}>{`curl -X POST "${apiBase}/controls" \\n- H "Authorization: Bearer YOUR_TOKEN" \\\n- H "Content-Type: application/json" \\\n- d '{ "mic": false, "dnd": true }'`}</code>
              </div>
        </div>
      </Overlay>

      {/* Editor Panel */}
      {editor.active && (
        <div style={{ position: 'absolute', top: 64, right: 12, zIndex: 35, width: 360 }}>
          <div style={{ background: 'rgba(17,17,20,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: 0, color: '#fff', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>Map-Editor</div>
            </div>
            
            {/* Category Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
              <button onClick={() => setEditor(s => ({ ...s, category: 'terrain', tool: 'floor' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='terrain'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='terrain'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Terrain</button>
              <button onClick={() => setEditor(s => ({ ...s, category: 'structures', tool: 'walls' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='structures'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='structures'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Strukturen</button>
              <button onClick={() => setEditor(s => ({ ...s, category: 'objects', tool: 'asset' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='objects'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='objects'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Objekte</button>
              <button onClick={() => setEditor(s => ({ ...s, category: 'zones', tool: 'zone' }))} style={{ flex: 1, padding: '10px 12px', border: 'none', borderBottom: editor.category==='zones'?'2px solid #3b82f6':'2px solid transparent', background: 'transparent', color: editor.category==='zones'?'#3b82f6':'#9ca3af', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Zonen</button>
            </div>
            
            {/* Content */}
            <EditorPanel
              editor={editor}
              setEditor={setEditor}
              onOpenUpload={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const buf = await file.arrayBuffer();
                      const base64 = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result as string);
                        reader.readAsDataURL(new Blob([buf], { type: file.type || 'image/png' }));
                      });
                      setEditor(s => ({ 
                        ...s, 
                        uploadDialog: {
                          open: true,
                          dataUrl: base64,
                          fileName: file.name,
                          tileWidth: file.name.toLowerCase().includes('little') ? 32 : 16,
                          tileHeight: file.name.toLowerCase().includes('little') ? 32 : 16,
                          margin: 0,
                          spacing: 0,
                          category: s.category
                        }
                      }));
              }}
              onSave={async () => {
                try {
                  console.log("SPEICHERN! 2099");
                  const tilesets = JSON.parse(localStorage.getItem('meetropolis.tilesets') || '[]');
                  const assets = JSON.parse(localStorage.getItem('meetropolis.assets') || '[]');
                  const zones = editor.zones;
                  const layers = JSON.parse(localStorage.getItem('meetropolis.editorLayers') || '{}');
                  const backgroundColor = localStorage.getItem('meetropolis.backgroundColor') || '#202020';
                  const payload: any = { editorGround: layers.editorGround ?? null, collision: layers.collision ?? null, tilesets, assets, backgroundColor };
                  if (Array.isArray(zones) && zones.some((z:any) => Array.isArray(z?.points) && z.points.length > 0)) {
                    payload.zones = zones;
                    payload.replaceZones = true;
                  }
                  await fetch(`${apiBase}/maps/office/editor-state`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                  try { colyseusRef.current?.send?.('editor_update', { type: 'reload_all' }); } catch {}
                } catch {}
              }}
            />
          </div>
        </div>
      )}
      
      {/* Tileset Upload Dialog */}
      {editor.uploadDialog?.open && (
        <TilesetUploadDialog
          open
          dialog={editor.uploadDialog as any}
          onCancel={() => setEditor(s => ({ ...s, uploadDialog: null }))}
          setDialog={(next) => setEditor(s => ({ ...s, uploadDialog: next }))}
          onConfirm={(tileset) => {
                gameBridge.registerTileset(tileset);
                setEditor(s => {
                  const tilesets = [...(s.tilesets || [])];
              if (!tilesets.find(t => t.key === tileset.key)) tilesets.push(tileset);
                  try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(tilesets)); } catch {}
              return { ...s, tilesets, uploadDialog: null, tilePaint: { ...tileset, tilesetKey: tileset.key, tileIndex: 0 } } as any;
            });
          }}
        />
      )}

      {/* Bubble Banner */}
      {bubbleUi.active && (
        <div style={{ position: 'absolute', bottom: 140, left: '50%', transform: 'translateX(-50%)', zIndex: 40 }}>
          <div style={{ display:'flex', alignItems:'center', gap: 12, background:'rgba(17,17,20,0.9)', border:'1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '10px 14px', color:'#fff', boxShadow:'0 12px 32px rgba(0,0,0,0.5)' }}>
            <span style={{ fontWeight:600 }}>In Bubble mit:</span>
            <span>{bubbleUi.members.join(', ')}</span>
            <button onClick={() => {
              // Leave bubble immediately
              const set = bubbleMembersRef.current;
              set.clear();
              try { gameBridge.setBubbleMembers(new Set()); } catch {}
              try { gameBridge.setMovementLocked(false); } catch {}
              try { colyseusRef.current?.send?.('bubble_update', { members: [] }); } catch {}
              setBubbleUi({ active: false, members: [] });
              setTimeout(() => applyVolumesToUi(), 0);
            }} style={{ marginLeft: 8, padding:'6px 10px', borderRadius:8, border:'1px solid rgba(244,63,94,0.4)', background:'rgba(244,63,94,0.18)', color:'#fff', cursor:'pointer' }}>Bubble verlassen</button>
          </div>
        </div>
      )}

      {/* Kontextmenü */}
      {contextMenu.open && contextMenu.playerId && (
        <div onClick={() => setContextMenu({ open: false, x: 0, y: 0, playerId: null })} style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
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
function ParticipantCard(props: { part: { sid: string; identity: string; hasVideo: boolean; hasMic: boolean; isSpeaking: boolean; media: 'camera'|'screen'; volume?: number }, roomGetter: () => any | undefined, compact?: boolean, full?: boolean, zoom?: number }) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const { part, roomGetter, compact, full, zoom = 1 } = props;
  const [isVideoRendering, setIsVideoRendering] = React.useState(false);
  const [isLocal, setIsLocal] = React.useState(false);

  useEffect(() => {
    const room: any = roomGetter();
    const el = videoRef.current;
    if (!room || !room.localParticipant || !el) return;
    let baseSid = (part.sid || '').split(':')[0];
    const isLocalNow = room.localParticipant?.sid === baseSid;
    setIsLocal(isLocalNow);
    let p: any = isLocalNow ? room.localParticipant : (room.participants?.get?.(baseSid) || room.remoteParticipants?.get?.(baseSid));
    
    // If not found by SID, try to match by identity
    if (!p && !isLocalNow) {
      const allParticipants = Array.from(room.remoteParticipants?.values() || []);
      
      
      // For screenshare, remove the " – Bildschirm" suffix to find the base participant
      const searchIdentity = part.media === 'screen' && part.identity.endsWith(' – Bildschirm') 
        ? part.identity.slice(0, -14) // Remove " – Bildschirm"
        : part.identity;
      
      // First try to find by display name
      p = allParticipants.find((participant: any) => {
        const pName = participant.name || participant.identity;
        return pName === searchIdentity;
      });
      
      if (!p) {
        // Try to find by identity (LiveKit ID)
        p = allParticipants.find((participant: any) => participant.identity === searchIdentity);
      }
      
      if (p) {
        // Update baseSid for event matching
        baseSid = p.sid;
      } else if (part.media === 'screen') {
        // For screenshare, also try finding by name with suffix
        p = allParticipants.find((participant: any) => {
          const pName = participant.name || participant.identity;
          return part.identity.startsWith(pName + ' –');
        });
        if (p) {
          baseSid = p.sid;
        }
      }
    }
    
    // For screenshare of remote participants, ensure we wait for the track
    if (!p && part.media === 'screen' && !isLocalNow) {
      // The tryAttach polling will handle this case
    }
    
    if (!p || !p.trackPublications) {
      return;
    }
    const pubs: any[] = Array.from(p.trackPublications?.values?.() || []);
    const wantedPub = pubs.find(pub => {
      const src = (pub?.source || pub?.track?.source);
      const isScreenShare = src === 'screen_share';
      const isCamera = src === 'camera';
      if (part.media === 'screen') {
        return isScreenShare;
      }
      return isCamera;
    });
    const track = (part.media === 'screen'
      ? pubs.find(pub => (pub?.source || pub?.track?.source) === 'screen_share')?.track
      : pubs.find(pub => (pub?.source || pub?.track?.source) === 'camera')?.track);
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
        el.muted = true; // Immer stumm schalten, damit Autoplay zuverlässig funktioniert
        track.attach(el);
        cleanup = () => { try { track.detach(el); } catch {} };
        // Check if video is actually playing
        setTimeout(() => {
          if (el.videoWidth > 0 && el.videoHeight > 0) {
          } else {
            // Video not ready yet
          }
        }, 500);
      } catch (e) {
      }
    } else {
      // No track found yet
    }

    // Aggressiver Fallback: pollt kurzzeitig und versucht zu attachen, wenn Track verzögert verfügbar wird
    const tryAttach = () => {
      try {
        // For screenshare, also try to find participant again if not found initially
        let currentP = p;
        if (!currentP && part.media === 'screen' && !isLocalNow) {
          const allParticipants = Array.from(room.remoteParticipants?.values() || []);
          const searchIdentity = part.identity.endsWith(' – Bildschirm') 
            ? part.identity.slice(0, -14) 
            : part.identity;
          // Try to find by display name first
          currentP = allParticipants.find((participant: any) => {
            const pName = participant.name || participant.identity;
            return pName === searchIdentity || part.identity.startsWith(pName + ' –');
          });
          
          if (!currentP) {
            // Try by identity
            currentP = allParticipants.find((participant: any) => 
              participant.identity === searchIdentity ||
              part.identity.startsWith(participant.identity + ' –')
            );
          }
          if (currentP && currentP !== p) {
            p = currentP;
            baseSid = currentP.sid;
          }
        }
        
        if (!currentP) return;
        
        const pubsNow: any[] = Array.from(currentP.trackPublications?.values?.() || []);
        if (part.media === 'screen' && pubsNow.length > 0) {
          // Screen share publications found
        }
        const cam = pubsNow.find((pub: any) => {
          const src = (pub?.source || pub?.track?.source);
          if (part.media === 'screen') return src === 'screen_share';
          return src === 'camera';
        });
        const trackObj = (cam as any)?.track;
        if (trackObj && el && !el.srcObject) {
          try { 
            el.muted = true; // Immer stumm schalten
            trackObj.attach(el); 
            setIsVideoRendering(false); 
            clearInterval(pollTimer);
            // Check video status after attach
            setTimeout(() => {
              if (el.videoWidth > 0 && el.videoHeight > 0) {
              }
            }, 500);
          } catch (e) {
          }
        }
      } catch {}
    };
    pollTimer = setInterval(tryAttach, 400);
    setTimeout(() => { try { clearInterval(pollTimer); } catch {} }, 6000);

    // Fallback: auf spätere Publishes/Subscribes reagieren und (re-)attachen
    const onTrackSubscribed = (t: any, _publication: any, participant: any) => {
      try {
        const src = (t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
        const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
        if (participant?.sid === baseSid && isDesired && el) {
          try { 
            el.muted = true; // Immer stumm schalten
            t.attach(el); 
            setIsVideoRendering(false);
            setTimeout(() => {
              if (el.videoWidth > 0 && el.videoHeight > 0) {
              } else {
              }
            }, 500);
          } catch (e) {
          }
        } else if (participant?.sid === baseSid) {
          // Sicherstellen, dass wir die gewünschte Quelle abonnieren (screen oder camera)
          try { _publication?.setSubscribed?.(true); } catch {}
          try { _publication?.setVideoQuality?.('high'); } catch {}
        } else {
        }
      } catch {}
    };
    const onTrackUnsubscribed = (_t: any, _publication: any, participant: any) => {
      try {
        if (participant?.sid?.startsWith?.(baseSid) && el) {
        }
      } catch {}
    };
    const onTrackPublished = (t: any, _publication: any, participant: any) => {
      try {
        const src = (_publication?.source || t?.source || t?.mediaStreamTrack?.kind) as string | undefined;
        const isDesired = part.media === 'screen' ? (src === 'screen_share') : (src === 'camera');
        if (participant?.sid === baseSid && isDesired && _publication?.track && el) {
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
              const wantCamera = (part.media === 'camera' && src === 'camera');
              const wantScreen = (part.media === 'screen' && src === 'screen_share');
              if (isLocalNow && (wantCamera || wantScreen) && publication?.track && el) {
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

  // Calculate opacity based on volume
  const volume = part.volume ?? 1;
  const opacity = isLocal ? 1 : (0.4 + (volume * 0.6)); // Min 40%, max 100% opacity
  
  const borderColor = part.isSpeaking ? '#22d3ee' : 'var(--border)';
  const glow = part.isSpeaking ? '0 0 0 2px rgba(34,211,238,0.35), var(--shadow)' : 'var(--shadow)';
  const bg = `var(--glass)`;
  const headerBg = `rgba(17,17,20,${0.6 * opacity})`;
  const badgeOn = 'rgba(16,185,129,0.25)';
  const badgeOff = 'rgba(244,63,94,0.25)';
  const borderOn = 'rgba(16,185,129,0.5)';
  const borderOff = 'rgba(244,63,94,0.5)';

  // Größenlogik:
  // - Kamera: in der kleinen Ansicht quadratisch, groß etwas höher
  // - Screenshare: soll nicht abgeschnitten werden -> 16:9 in klein, 16:9 in groß
  const isScreen = part.media === 'screen';
  const aspect = full ? undefined : (isScreen ? '16 / 9' : '16 / 9');
  const targetSize = full ? undefined : (compact ? '100%' : '36vh');
  const minW = full ? undefined : (compact ? 260 : 420);

  // Interaktion für "außerhalb Bubble" sperren (Volume ~ outsideBubbleAttenuation)
  const disabled = !isLocal && (volume <= 0.1);

  return (
    <div style={{
      width: full ? 'min(calc(100vw - 64px), 1920px)' : `min(${targetSize}, 100%)`,
      minWidth: minW as any,
      maxHeight: full ? 'calc(100vh - 64px)' : (targetSize as any),
      aspectRatio: aspect as any,
      position: 'relative', borderRadius: 14, overflow: 'hidden', background: 'var(--uc-glass)', border: `1px solid ${borderColor}`, boxShadow: glow,
      opacity: opacity,
      transition: 'opacity 0.3s ease-in-out',
      pointerEvents: disabled ? 'none' : 'auto',
      filter: disabled ? 'grayscale(90%) brightness(0.8)' : undefined,
      height: full ? 'auto' : 'min(140px, 30vh)'
    }}>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: full ? 'auto' : '100%', maxHeight: full ? 'calc(100vh - 64px)' : undefined, objectFit: isScreen ? 'contain' : (full ? 'contain' : 'cover'), background: 'transparent', transform: (isLocal && part.media==='camera') ? `scaleX(-1) scale(${zoom})` : `scale(${zoom})`, transformOrigin: 'center center' }} />
      {!(part.hasVideo || isVideoRendering) && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--fg)', fontWeight: 600, fontSize: 14 }}>
          {part.identity}
        </div>
      )}
      <div style={{ position: 'absolute', top: 6, left: 6, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-btn-bg, var(--glass))', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: 12, color: 'var(--fg)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{part.identity}</div>
      </div>
      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 8 }}>
        <div title={part.hasMic ? 'Mikro an' : 'Mikro aus'} style={{ display:   'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: part.hasMic ? badgeOn : badgeOff, border: `1px solid ${part.hasMic ? borderOn : borderOff}` }}>
          <FAIcon size="sm" name={part.hasMic ? 'microphone' : 'microphone-slash'} variant="solid" ariaLabel={part.hasMic ? 'Mikro an' : 'Mikro aus'} />
        </div>
        <div title={part.hasVideo ? 'Kamera an' : 'Kamera aus'} style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 999, background: (part.hasVideo || isVideoRendering) ? badgeOn : badgeOff, border: `1px solid ${(part.hasVideo || isVideoRendering) ? borderOn : borderOff}` }}>
          <FAIcon size="sm" name={(part.hasVideo || isVideoRendering) ? 'video' : 'video-slash'} variant="solid" ariaLabel={(part.hasVideo || isVideoRendering) ? 'Kamera an' : 'Kamera aus'} />
        </div>
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <FAIcon name="gear" variant="solid" ariaLabel="Einstellungen" className="btn-text-color" />
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
  // Expose loader for external refresh (invite modal)
  React.useEffect(() => {
    (document as any).__userManagementLoad = load;
    return () => { delete (document as any).__userManagementLoad; };
  }, []);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', display: 'grid', gap: 20, padding: '20px' }}>
      <Toolbar
        left={<>
          <Button onClick={onBack} style={{ 
            background: 'rgba(255,255,255,0.05)', 
            border: '1px solid rgba(255,255,255,0.12)',
            padding: '8px 16px',
            borderRadius: 8
          }}>
            ← Zurück
          </Button>
          <div style={{ 
            padding: '6px 12px', 
            borderRadius: 20, 
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', 
            fontSize: 12, 
            color: '#fff',
            fontWeight: 600
          }}>
            Admin
          </div>
        </>}
        right={<>
          <Button 
            variant="primary" 
            onClick={() => { setInviteCode(null); setNewEmail(''); setNewName(''); setCreateOpen(true); }}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontWeight: 600
            }}
          >
            + Neuer Benutzer
          </Button>
        </>}
        style={{ 
          background: 'transparent',
          border: 'none',
          padding: 0
        }}
      />

      {error && (
        <Card style={{ 
          background: 'rgba(239,68,68,0.1)', 
          border: '1px solid rgba(239,68,68,0.3)'
        }}>
          <div style={{ color: '#fca5a5' }}>{error}</div>
        </Card>
      )}
      {loading ? (
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          textAlign: 'center',
          padding: 40
        }}>
          <div style={{ color: 'rgba(255,255,255,0.6)' }}>Lade Benutzerdaten...</div>
        </Card>
      ) : (
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: 0,
          overflow: 'hidden'
        }}>
          <div style={{ display: 'grid', gap: 0 }}>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
              gap: 16, 
              padding: '16px 24px', 
              background: 'rgba(255,255,255,0.03)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              fontWeight: 600, 
              color: 'rgba(255,255,255,0.7)',
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.05em'
            }}>
              <div>E-Mail</div>
              <div>Name</div>
              <div>Aktionen</div>
            </div>
            {users.map(u => (
              <div key={u.id} style={{ 
                display: 'grid', 
                gridTemplateColumns: 'minmax(150px, 1fr) minmax(150px, 1fr) minmax(160px, 180px)', 
                gap: 16, 
                padding: '16px 24px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                transition: 'background 0.2s',
                background: edit?.id === u.id ? 'rgba(59,130,246,0.1)' : 'transparent'
              }}>
                {edit?.id === u.id ? (
                  <>
                    <Input 
                      value={edit.email} 
                      onChange={e => setEdit({ ...(edit as any), email: e.target.value })}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        padding: '8px 12px',
                        fontSize: 14
                      }}
                    />
                    <Input 
                      value={edit.name ?? ''} 
                      onChange={e => setEdit({ ...(edit as any), name: e.target.value })}
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        padding: '8px 12px',
                        fontSize: 14
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        variant="primary" 
                        onClick={() => save(edit!)}
                        style={{
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          border: 'none',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        ✓
                      </Button>
                      <Button 
                        onClick={() => setEdit(null)}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', color: '#fff', fontSize: 14 }}>{u.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', color: u.name ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 14 }}>{u.name ?? '—'}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button 
                        onClick={() => setEdit({ id: u.id, email: u.email, name: u.name ?? '' })}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        Bearbeiten
                      </Button>
                      <Button 
                        variant="danger" 
                        onClick={() => remove(u.id)}
                        style={{
                          background: 'rgba(239,68,68,0.1)',
                          border: '1px solid rgba(239,68,68,0.3)',
                          color: '#f87171',
                          padding: '6px 16px',
                          borderRadius: 6,
                          fontSize: 13
                        }}
                      >
                        Löschen
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {users.length === 0 && (
              <div style={{ 
                padding: 40, 
                textAlign: 'center', 
                color: 'rgba(255,255,255,0.4)' 
              }}>
                Keine Benutzer vorhanden
              </div>
            )}
          </div>
        </Card>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Neuen Benutzer einladen" maxWidth={520} footer={<>
        <Button onClick={() => setCreateOpen(false)}>Abbrechen</Button>
        <Button variant="primary" onClick={async () => {
          setError(null);
          try {
            // Einladung erzeugen
            const res = await fetch(`${baseUrl}/auth/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ email: newEmail, name: newName || undefined }) });
            if (!res.ok) throw new Error((await res.json())?.error || 'Fehler beim Einladen');
            const data = await res.json();
            setInviteCode(data.code || null);
            // Liste neu laden, damit eingeladener User angezeigt wird
            try { await (document as any).__userManagementLoad?.(); } catch {}
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

  const commonStyle: React.CSSProperties = { display: 'grid', gap: 16, width: '100%' };

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'grid', 
      placeItems: 'center',
      background: 'linear-gradient(135deg, rgba(17,17,20,0.98) 0%, rgba(30,30,35,0.98) 100%)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Animated background pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 20% 50%, rgba(59,130,246,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 80%, rgba(147,51,234,0.08) 0%, transparent 50%), radial-gradient(circle at 40% 20%, rgba(16,185,129,0.08) 0%, transparent 50%)',
      }} />
      
      <div style={{ 
        position: 'relative',
        width: '100%',
        maxWidth: 440,
        padding: '0 20px'
      }}>
        {/* Logo and Title */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ 
            fontSize: 48, 
            fontWeight: 900, 
            background: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #34d399 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent as any',
            marginBottom: 8,
            letterSpacing: '-0.02em'
          }}>
            Meetropolis
          </div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>Dein virtueller Arbeitsplatz</div>
        </div>
        
        <Card style={{ 
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: 32,
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          position: 'relative'
        }}>
          <div style={{ position: 'absolute', top: 16, right: 16 }}>
            <ThemeToggleButton />
          </div>
          <div style={commonStyle}>
        {view === 'login' && (
          <>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#fff' }}>Willkommen zurück</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Passwort</label>
                <Input 
                  placeholder="••••••••" 
                  type="password" 
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
            </div>
            <Button 
              variant="primary" 
              onClick={async()=>{ try{ await post('/auth/login',{email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}
              style={{ 
                width: '100%', 
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                border: 'none',
                borderRadius: 8
              }}
            >
              Einloggen
            </Button>
            <div style={{ display:'flex', justifyContent:'space-between', fontSize: 13 }}>
              <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none' }} onClick={()=>setView('forgot')}>Passwort vergessen?</a>
              <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none' }} onClick={()=>setView('register')}>Einladung einlösen</a>
            </div>
          </>
        )}
        {view === 'register' && (
          <>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#fff' }}>Registrierung</h2>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Einladungscode</label>
                <Input 
                  placeholder="Code eingeben" 
                  value={invite} 
                  onChange={e=>setInvite(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Name (optional)</label>
                <Input 
                  placeholder="Max Mustermann" 
                  value={name} 
                  onChange={e=>setName(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>E-Mail</label>
                <Input 
                  placeholder="name@beispiel.de" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', display: 'block', marginBottom: 6 }}>Passwort</label>
                <Input 
                  placeholder="••••••••" 
                  type="password" 
                  value={password} 
                  onChange={e=>setPassword(e.target.value)}
                  style={{ 
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '12px 16px',
                    fontSize: 14
                  }}
                />
              </div>
            </div>
            <Button 
              variant="primary" 
              onClick={async()=>{ try{ await post('/auth/register',{code:invite,name,email,password}); onDone(); } catch(e:any){ setMsg(e.message); } }}
              style={{ 
                width: '100%', 
                padding: '12px 24px',
                fontSize: 15,
                fontWeight: 600,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                border: 'none',
                borderRadius: 8
              }}
            >
              Registrieren
            </Button>
            <a style={{ cursor:'pointer', color: '#60a5fa', textDecoration: 'none', fontSize: 13, textAlign: 'center' }} onClick={()=>setView('login')}>Zurück zum Login</a>
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
        {msg && (
          <div style={{ 
            padding: '12px 16px', 
            borderRadius: 8, 
            background: 'rgba(239,68,68,0.1)', 
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5',
            fontSize: 14,
            marginTop: 8
          }}>
            {msg}
          </div>
        )}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default App;
