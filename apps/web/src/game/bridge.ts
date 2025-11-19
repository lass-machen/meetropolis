export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }>) => void;
  addRemotePlayer: (id: string, p: { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }) => void;
  updateRemotePlayer: (id: string, p: Partial<{ x: number; y: number; direction: Direction; name?: string; dnd?: boolean }>) => void;
  removeRemotePlayer: (id: string) => void;
  updateRemotePlayerDnd: (id: string, dnd: boolean) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setZonesVisible: (visible: boolean) => void;
  onPointerDown: (p: { x: number; y: number }) => void;
  onRightClick: (p: { x: number; y: number; playerId?: string }) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  onPointerDownTile: (p: { tileX: number; tileY: number }) => void;
  onPointerMoveTile: (p: { tileX: number; tileY: number }) => void;
  onPointerUpTile: (p: { tileX: number; tileY: number }) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  fetchAndApplyServerLayers: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName: (name: string) => void;
  updateSpeakingStates: (speakingIds: Set<string>) => void;
  setDoNotDisturb: (enabled: boolean) => void;
  // Asset-Preview im Editor (Ghost-Sprite unter Cursor)
  setAssetPreview: (preview: { dataUrl: string; width?: number; height?: number } | null) => void;
  // New: lock movement and find free spot near a sprite
  setMovementLocked: (locked: boolean) => void;
  findFreeSpotNear: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  // Camera helpers for UI
  recenterCamera: () => void;
  onCameraManualChange?: (active: boolean) => void;
  // Editor mode: disable normal interactions in scene
  setEditorMode: (enabled: boolean) => void;
  handleEditorUpdate?: (data: any) => void;
  // Background color
  setBackgroundColor: (hex: string) => void;
  // Spawn-Marker Overlay (Editor)
  setSpawnMarker: (pos: { x: number; y: number } | null) => void;
  // Force-persist editor layers to server (no size guard)
  saveEditorLayersHard?: () => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setZonesVisible?: (visible: boolean) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  fetchAndApplyServerLayers?: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName?: (name: string) => void;
  updateSpeakingStates?: (speakingIds: Set<string>) => void;
  setDoNotDisturb?: (enabled: boolean) => void;
  setAssetPreview?: (preview: { dataUrl: string; width?: number; height?: number } | null) => void;
  // New hooks
  setMovementLocked?: (locked: boolean) => void;
  findFreeSpotNear?: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  recenterCamera?: () => void;
  setEditorMode?: (enabled: boolean) => void;
  setBackgroundColor?: (hex: string) => void;
  setSpawnMarker?: (pos: { x: number; y: number } | null) => void;
  saveEditorLayersHard?: () => void;
};

let sceneApi: SceneApi | null = null;
let cachedZones: { name: string; points: { x: number; y: number }[] }[] = [];
let cachedZonesVisible: boolean = true;
let cachedAssets: { id: string; key: string; dataUrl: string; x: number; y: number }[] = [];
let cachedCollisionVisible = false;
let cachedHeroName: string | null = null;
let cachedDoNotDisturb = false;
let remotePlayersCache: Record<string, { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }> = {};
let cachedBackgroundColor: string = '#202020';
// Cache, um unnötige Doppel-Aufrufe zu vermeiden (z.B. wiederholt null)
let lastDesiredPosition: { x: number; y: number } | null = null;
let tilesetPersistLastLen = -1;
let tilesetPersistTimer: number | null = null as any;
let cachedSpawnMarker: { x: number; y: number } | null = null;

export const gameBridge: Bridge = {
  onLocalMove: () => {},
  onPointerDown: () => {},
  onRightClick: () => {},
  onCameraManualChange: () => {},
  setSceneApi: (api) => {
    sceneApi = api;
    // Wenn Szene frisch gebunden wird, zuletzt bekannte Overlays/Assets anwenden
    if (sceneApi) {
    // 1) Zonen nur noch aus Server-Daten (via Props/Server-Call) laden. LocalStorage ist NICHT mehr source-of-truth.
    // Alte LocalStorage-Logik entfernt, um Konflikte zu vermeiden.
    try { sceneApi.setZonesVisible?.(cachedZonesVisible); } catch (e) { console.error('Failed to set zones visible', e); }
    try { if (cachedZonesVisible) sceneApi.setZoneOverlay(cachedZones); } catch (e) { console.error('Failed to set zone overlay', e); }
    try { sceneApi.setEditorAssets(cachedAssets); } catch (e) { console.error('Failed to set editor assets', e); }
    try { sceneApi.setCollisionVisible(cachedCollisionVisible); } catch (e) { console.error('Failed to set collision visible', e); }
    // 2) Best-Effort: Serverzustand laden (nur falls die Szene es unterstützt)
    try { sceneApi.fetchAndApplyServerLayers?.(); } catch (e) { console.error('Failed to fetch server layers', e); }
    try { sceneApi.reloadEditorLayers(); } catch (e) { console.error('Failed to reload editor layers', e); }
      // Set cached hero name if available
      if (cachedHeroName && sceneApi.setHeroName) {
        try { sceneApi.setHeroName(cachedHeroName); } catch {}
      }
      if (typeof sceneApi.setDoNotDisturb === 'function') {
        try { sceneApi.setDoNotDisturb(cachedDoNotDisturb); } catch {}
      }
      // WICHTIG: Bereits bekannte Remote-Spieler sofort rendern
      try { sceneApi.syncRemotePlayers(remotePlayersCache); } catch {}
      // Apply cached background color
      try { sceneApi.setBackgroundColor?.(cachedBackgroundColor); } catch {}
      // Apply cached spawn marker
      try { sceneApi.setSpawnMarker?.(cachedSpawnMarker); } catch {}
    }
  },
  recenterCamera: () => {
    sceneApi?.recenterCamera?.();
  },
  setEditorMode: (enabled) => {
    sceneApi?.setEditorMode?.(!!enabled);
  },
  syncRemotePlayers: (players) => {
    // Ersetze den gesamten Cache mit der neuen Quelle der Wahrheit
    remotePlayersCache = { ...players };
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  addRemotePlayer: (id, p) => {
    remotePlayersCache[id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd };
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  updateRemotePlayer: (id, p) => {
    if (!remotePlayersCache[id]) {
      // Wenn Spieler nicht existiert, lege ihn nur an, wenn genug Daten vorhanden sind
      if (p.x !== undefined && p.y !== undefined && p.direction) {
        remotePlayersCache[id] = { x: p.x, y: p.y, direction: p.direction as Direction, name: p.name, dnd: p.dnd };
      } else {
        return;
      }
    } else {
      const curr = remotePlayersCache[id];
      remotePlayersCache[id] = {
        x: p.x !== undefined ? p.x : curr.x,
        y: p.y !== undefined ? p.y : curr.y,
        direction: (p.direction as Direction) || curr.direction,
        name: p.name !== undefined ? p.name : curr.name,
        dnd: p.dnd !== undefined ? p.dnd : curr.dnd
      };
    }
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  removeRemotePlayer: (id) => {
    if (remotePlayersCache[id]) {
      const { [id]: _removed, ...rest } = remotePlayersCache;
      remotePlayersCache = rest;
      sceneApi?.syncRemotePlayers(remotePlayersCache);
    }
  },
  updateRemotePlayerDnd: (id, dnd) => {
    if (remotePlayersCache[id]) {
      remotePlayersCache[id] = { ...remotePlayersCache[id], dnd };
      sceneApi?.syncRemotePlayers(remotePlayersCache);
    }
  },
  setDesiredPosition: (pos) => {
    const prev = lastDesiredPosition;
    const same = (prev === null && pos === null) || (prev && pos && prev.x === pos.x && prev.y === pos.y);
    if (same) return;
    lastDesiredPosition = pos ? { x: pos.x, y: pos.y } : null;
    try { console.debug('[Bridge] setDesiredPosition changed to', pos); } catch (e) { console.error('Log failed', e); }
    sceneApi?.setDesiredPosition(pos);
  },
  setZoneOverlay: (polys) => {
    cachedZones = Array.isArray(polys) ? polys : [];
    if (cachedZonesVisible) sceneApi?.setZoneOverlay(polys);
  },
  setZonesVisible: (visible) => {
    cachedZonesVisible = !!visible;
    try { sceneApi?.setZonesVisible?.(cachedZonesVisible); } catch (e) { console.error('Failed to set zones visible', e); }
    if (cachedZonesVisible) {
      // Re-apply cached zones when becoming visible again
      try { sceneApi?.setZoneOverlay?.(cachedZones); } catch (e) { console.error('Failed to set zone overlay', e); }
    }
  },
  setEditorAssets: (assets) => {
    cachedAssets = Array.isArray(assets) ? assets : [];
    sceneApi?.setEditorAssets(assets);
  },
  // Optional: dedizierter Weg um Bubble-Mitglieder zu cachen (UI steuert dieses Set)
  onPointerDownTile: () => {},
  onPointerMoveTile: () => {},
  onPointerUpTile: () => {},
  setSelectionRect: (rect) => {
    sceneApi?.setSelectionRect(rect);
  },
  applyTilePaint: (edit) => {
    sceneApi?.applyTilePaint(edit);
  },
  registerTileset: (ts) => {
    // 1) Apply to scene
    sceneApi?.registerTileset(ts);
    // 2) Persist best-effort to localStorage and server editor-state
    try {
      // Merge into cached list in localStorage to avoid duplicates
      const stored = (typeof window !== 'undefined') ? localStorage.getItem('meetropolis.tilesets') : null;
      const list: any[] = stored ? JSON.parse(stored) : [];
      const next = Array.isArray(list) ? list.slice() : [];
      const exists = next.find((t: any) => t && t.key === ts.key);
      if (!exists) next.push({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0 });
      try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(next)); } catch (e) { console.warn('Failed to save tilesets to localStorage', e); }
      // Best-effort: debounce server PUT to avoid flooding
      if (next.length !== tilesetPersistLastLen) {
        tilesetPersistLastLen = next.length;
        if (tilesetPersistTimer) {
          clearTimeout(tilesetPersistTimer as any);
        }
        tilesetPersistTimer = setTimeout(() => {
          try {
            const base = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
            const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
            const body = JSON.stringify({ tilesets: next });
            if (body.length < 200_000) {
              fetch(`${base}/maps/${encodeURIComponent(mapName)}/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body }).catch((e)=>{ console.error('Failed to persist tilesets to server', e); });
              try { (window as any).DEBUG_LOGS && console.debug('[ASSETS_DBG][Bridge] persisted tileset to server', { count: next.length }); } catch (e) { console.error('Log failed', e); }
            }
          } catch (e) { console.error('Failed to persist tilesets', e); }
        }, 300) as any;
      }
    } catch (e) { console.error('Failed to register tileset', e); }
  },
  setCollisionVisible: (visible) => {
    cachedCollisionVisible = !!visible;
    sceneApi?.setCollisionVisible(visible);
  },
  reloadEditorLayers: () => {
    sceneApi?.reloadEditorLayers();
  },
  fetchAndApplyServerLayers: () => {
    sceneApi?.fetchAndApplyServerLayers?.();
  },
  setBubbleMembers: (members) => {
    sceneApi?.setBubbleMembers(members);
  },
  setHeroName: (name) => {
    cachedHeroName = name;
    sceneApi?.setHeroName?.(name);
  },
  updateSpeakingStates: (speakingIds) => {
    sceneApi?.updateSpeakingStates?.(speakingIds);
  },
  setDoNotDisturb: (enabled) => {
    cachedDoNotDisturb = !!enabled;
    sceneApi?.setDoNotDisturb?.(enabled);
  },
  setAssetPreview: (preview) => {
    sceneApi?.setAssetPreview?.(preview);
  },
  setMovementLocked: (locked) => {
    sceneApi?.setMovementLocked?.(locked);
  },
  findFreeSpotNear: (targetId, options) => {
    return sceneApi?.findFreeSpotNear?.(targetId, options) ?? null;
  },
  handleEditorUpdate: (data: any) => {
    try {
      if (!data) return;
      if (data.type === 'tile_paint' && data.edit) {
        sceneApi?.applyTilePaint?.(data.edit);
        return;
      }
      if (data.type === 'layers' || data.type === 'all') {
        // Lade Server-Layer neu
        sceneApi?.fetchAndApplyServerLayers?.();
        return;
      }
      if (data.type === 'asset' && Array.isArray(data.assets)) {
        sceneApi?.setEditorAssets?.(data.assets);
        return;
      }
      if (data.type === 'zone' && Array.isArray(data.polys)) {
        sceneApi?.setZoneOverlay?.(data.polys);
        return;
      }
    } catch (e) { console.error('Failed to handle editor update', e); }
  },
  setBackgroundColor: (hex: string) => {
    try { localStorage.setItem('meetropolis.backgroundColor', hex); } catch (e) { console.warn('Failed to save background color', e); }
    cachedBackgroundColor = hex;
    sceneApi?.setBackgroundColor?.(hex);
  },
  setSpawnMarker: (pos) => {
    cachedSpawnMarker = pos ? { x: pos.x, y: pos.y } : null;
    sceneApi?.setSpawnMarker?.(pos);
  },
  saveEditorLayersHard: () => { try { sceneApi?.saveEditorLayersHard?.(); } catch (e) { console.error('Failed hard save', e); } }
};
