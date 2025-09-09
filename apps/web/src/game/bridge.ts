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
  // New: lock movement and find free spot near a sprite
  setMovementLocked: (locked: boolean) => void;
  findFreeSpotNear: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  // Camera helpers for UI
  recenterCamera: () => void;
  onCameraManualChange?: (active: boolean) => void;
  // Editor mode: disable normal interactions in scene
  setEditorMode: (enabled: boolean) => void;
  handleEditorUpdate?: (data: any) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
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
  // New hooks
  setMovementLocked?: (locked: boolean) => void;
  findFreeSpotNear?: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  recenterCamera?: () => void;
  setEditorMode?: (enabled: boolean) => void;
};

let sceneApi: SceneApi | null = null;
let cachedZones: { name: string; points: { x: number; y: number }[] }[] = [];
let cachedAssets: { id: string; key: string; dataUrl: string; x: number; y: number }[] = [];
let cachedCollisionVisible = false;
let cachedHeroName: string | null = null;
let cachedDoNotDisturb = false;
let remotePlayersCache: Record<string, { x: number; y: number; direction: Direction; name?: string; dnd?: boolean }> = {};

export const gameBridge: Bridge = {
  onLocalMove: () => {},
  onPointerDown: () => {},
  onRightClick: () => {},
  onCameraManualChange: () => {},
  setSceneApi: (api) => {
    sceneApi = api;
    // Wenn Szene frisch gebunden wird, zuletzt bekannte Overlays/Assets anwenden
    if (sceneApi) {
      // 1) Zonen aus LocalStorage lesen (falls vorhanden) und anwenden
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('meetropolis.zones') : null;
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored)) {
          cachedZones = stored;
        }
      } catch {}
      try { sceneApi.setZoneOverlay(cachedZones); } catch {}
      try { sceneApi.setEditorAssets(cachedAssets); } catch {}
      try { sceneApi.setCollisionVisible(cachedCollisionVisible); } catch {}
      // 2) Best-Effort: Serverzustand laden (nur falls die Szene es unterstützt)
      try { sceneApi.fetchAndApplyServerLayers?.(); } catch {}
      try { sceneApi.reloadEditorLayers(); } catch {}
      // Set cached hero name if available
      if (cachedHeroName && sceneApi.setHeroName) {
        try { sceneApi.setHeroName(cachedHeroName); } catch {}
      }
      if (typeof sceneApi.setDoNotDisturb === 'function') {
        try { sceneApi.setDoNotDisturb(cachedDoNotDisturb); } catch {}
      }
      // WICHTIG: Bereits bekannte Remote-Spieler sofort rendern
      try { sceneApi.syncRemotePlayers(remotePlayersCache); } catch {}
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
    try { console.debug('[Bridge] setDesiredPosition called', pos); } catch {}
    sceneApi?.setDesiredPosition(pos);
  },
  setZoneOverlay: (polys) => {
    cachedZones = Array.isArray(polys) ? polys : [];
    sceneApi?.setZoneOverlay(polys);
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
    sceneApi?.registerTileset(ts);
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
    } catch {}
  }
};
