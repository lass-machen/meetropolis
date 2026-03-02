import { EditorService } from '../services/EditorService';
import { logger } from '../lib/logger';
import { useMapStore } from '../state/mapStore';
import { splitTileRefId, fetchStateV2, baseUrl as mapV2BaseUrl } from '../lib/mapV2';

export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined; isNpc?: boolean | undefined }>) => void;
  addRemotePlayer: (id: string, p: { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined; isNpc?: boolean | undefined }) => void;
  updateRemotePlayer: (id: string, p: Partial<{ x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined }>) => void;
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
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  fetchAndApplyServerLayers: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName: (name: string) => void;
  updateSpeakingStates: (speakingIds: Set<string>) => void;
  setDoNotDisturb: (enabled: boolean) => void;
  // Asset-Preview im Editor (Ghost-Sprite unter Cursor)
  setAssetPreview: (preview: { dataUrl: string; width?: number | undefined; height?: number | undefined; rotation?: number | undefined; packUuid?: string | undefined; itemId?: string | undefined } | null) => void;
  // New: lock movement and find free spot near a sprite
  setMovementLocked: (locked: boolean) => void;
  findFreeSpotNear: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  // Camera helpers for UI
  recenterCamera: () => void;
  onCameraManualChange?: (active: boolean) => void;
  // Editor mode: disable normal interactions in scene
  setEditorMode: (enabled: boolean) => void;
  handleEditorUpdate?: (data: any) => void;
  // MapObject live updates
  handleObjectsUpdated: (data: { action: 'add' | 'remove' | 'update'; objects?: any[] | undefined; objectIds?: number[] | undefined }) => void;
  // Background color
  setBackgroundColor: (hex: string) => void;
  // Spawn-Marker Overlay (Editor)
  setSpawnMarker: (pos: { x: number; y: number } | null) => void;
  // Force-persist editor layers to server (no size guard)
  saveEditorLayersHard?: () => void;
  applyChunkUpdates?: (layerName: 'ground' | 'walls' | 'collision' | 'walls_auto', updates: Array<{ key: string; version: number; encoding: string; data: string }>) => void;
  forceReloadMap?: () => void;
  // Expose method to hydrate tileset cache from outside (e.g. serverSync)
  hydrateTilesetsCache: (tilesets: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }[]) => void;
  // Update tileset registry in scene
  updateTilesetRegistry: (registry: any[]) => void;
  // Live avatar switching
  changeHeroAvatar: (avatarId: string) => void;
  applyTerrainPaint: (edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string }) => void;
  applyTerrainPaintV2: (edit: { rect: { x0: number; y0: number; x1: number; y1: number }; tileRefId: number; layer: string }) => void;
  eraseTerrainRect: (rect: { startX: number; startY: number; endX: number; endY: number }) => void;
  applyWallPaint: (edit: { rect: { startX: number; startY: number; endX: number; endY: number }; wallTypeId: number }) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined; isNpc?: boolean | undefined }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setZonesVisible?: (visible: boolean) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  fetchAndApplyServerLayers?: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName?: (name: string) => void;
  updateSpeakingStates?: (speakingIds: Set<string>) => void;
  setDoNotDisturb?: (enabled: boolean) => void;
  setAssetPreview?: (preview: { dataUrl: string; width?: number | undefined; height?: number | undefined; rotation?: number | undefined; packUuid?: string | undefined; itemId?: string | undefined } | null) => void;
  // New hooks
  setMovementLocked?: (locked: boolean) => void;
  findFreeSpotNear?: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  recenterCamera?: () => void;
  setEditorMode?: (enabled: boolean) => void;
  setBackgroundColor?: (hex: string) => void;
  setSpawnMarker?: (pos: { x: number; y: number } | null) => void;
  saveEditorLayersHard?: () => void;
  applyChunkUpdates?: (layerName: 'ground' | 'walls' | 'collision' | 'walls_auto', updates: Array<{ key: string; version: number; encoding: string; data: string }>) => void;
  forceReloadMap?: () => void;
  updateTilesetRegistry?: (registry: any[]) => void;
  changeHeroAvatar?: (avatarId: string) => void;
  handleObjectsUpdated?: (data: { action: 'add' | 'remove' | 'update'; objects?: any[] | undefined; objectIds?: number[] | undefined }) => void;
  applyTerrainPaint?: (edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string }) => void;
  paintTerrainRect?: (layer: string, rect: { x0: number; y0: number; x1: number; y1: number }, tileRefId: number) => void;
  eraseTerrainRect?: (rect: { startX: number; startY: number; endX: number; endY: number }) => void;
  applyWallPaint?: (edit: { rect: { startX: number; startY: number; endX: number; endY: number }; wallTypeId: number }) => void;
};

let sceneApi: SceneApi | null = null;

// Tileset registration queue - processes requests sequentially to avoid server overload
const tilesetQueue: Array<{
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
}> = [];
const registeredTilesets = new Set<string>();
let isProcessingTilesets = false;

async function processTilesetQueue(): Promise<void> {
  if (isProcessingTilesets || tilesetQueue.length === 0) return;
  isProcessingTilesets = true;

  const anyWin = window as unknown as Record<string, unknown>;
  const base = (anyWin.desktop as { apiBase?: string })?.apiBase
    || anyWin.__MEETROPOLIS_API_BASE__ as string
    || anyWin.VITE_API_BASE as string
    || (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
    || `${window.location.protocol}//${window.location.hostname}:2567`;
  const mapId = useMapStore.getState().currentMapId;
  if (!mapId) {
    isProcessingTilesets = false;
    return;
  }

  while (tilesetQueue.length > 0) {
    const ts = tilesetQueue.shift()!;

    if (registeredTilesets.has(ts.key)) {
      continue;
    }

    const payload = {
      key: ts.key,
      imageUrl: ts.dataUrl,
      tileWidth: ts.tileWidth,
      tileHeight: ts.tileHeight,
      margin: ts.margin,
      spacing: ts.spacing
    };

    try {
      const res = await fetch(`${base}/maps/${encodeURIComponent(mapId)}/tilesets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        await res.json();
        registeredTilesets.add(ts.key);
        logger.debug(`[Bridge] Tileset "${ts.key}" registered successfully`);
      } else {
        logger.warn(`[Bridge] Tileset registration failed: ${res.status} for key="${ts.key}"`);
      }
    } catch (e) {
      logger.error('[Bridge] Failed to register tileset on server', e);
    }
  }

  isProcessingTilesets = false;
}

// Deduplication flags for expensive operations
let isFetchingServerLayers = false;
let isReloadingEditorLayers = false;

// Non-Editor State (behalten)
let cachedCollisionVisible = false;
let cachedHeroName: string | null = null;
let cachedDoNotDisturb = false;
let remotePlayersCache: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined; isNpc?: boolean | undefined }> = {};
let lastDesiredPosition: { x: number; y: number } | null = null;

// Editor-State-Caching ENTFERNT - EditorService ist jetzt Single Source of Truth
// cachedZones, cachedAssets, cachedSpawnMarker, cachedTilesets, cachedBackgroundColor -> GELÖSCHT

// V2 tileset cache for terrain ghost preview (populated via updateTilesetRegistry or lazy fetch)
let v2TilesetCache: Array<{ slot: number; key: string; imageUrl: string; tileWidth: number; tileHeight: number; margin?: number | null; spacing?: number | null }> = [];
let terrainPreviewGeneration = 0;

function resolveImageUrl(url: string): string {
  if (url.startsWith('data:')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${mapV2BaseUrl()}${url}`;
}

export const gameBridge: Bridge = {
  onLocalMove: () => { },
  onPointerDown: () => { },
  onRightClick: () => { },
  onCameraManualChange: () => { },
  setSceneApi: (api) => {
    sceneApi = api;

    if (sceneApi) {
      // Nicht-Editor State wiederherstellen
      try { sceneApi.setCollisionVisible(cachedCollisionVisible); } catch (e) { logger.error('Failed to set collision visible', e); }

      if (cachedHeroName && sceneApi.setHeroName) {
        try { sceneApi.setHeroName(cachedHeroName); } catch { }
      }

      if (typeof sceneApi.setDoNotDisturb === 'function') {
        try { sceneApi.setDoNotDisturb(cachedDoNotDisturb); } catch { }
      }

      // Remote-Spieler wiederherstellen
      try { sceneApi.syncRemotePlayers(remotePlayersCache); } catch { }

      // Server-Layers laden (für Map-Daten)
      try { sceneApi.fetchAndApplyServerLayers?.(); } catch (e) { logger.error('Failed to fetch server layers', e); }
      try { sceneApi.reloadEditorLayers(); } catch (e) { logger.error('Failed to reload editor layers', e); }
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
    remotePlayersCache[id] = { x: p.x, y: p.y, direction: p.direction, name: p.name, dnd: p.dnd, avatarId: p.avatarId, isNpc: p.isNpc };
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  updateRemotePlayer: (id, p) => {
    if (!remotePlayersCache[id]) {
      // Wenn Spieler nicht existiert, lege ihn nur an, wenn genug Daten vorhanden sind
      if (p.x !== undefined && p.y !== undefined && p.direction) {
        remotePlayersCache[id] = { x: p.x, y: p.y, direction: p.direction as Direction, name: p.name, dnd: p.dnd, avatarId: p.avatarId };
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
        dnd: p.dnd !== undefined ? p.dnd : curr.dnd,
        avatarId: p.avatarId !== undefined ? p.avatarId : curr.avatarId,
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
    try { logger.debug('[Bridge] setDesiredPosition changed to', pos); } catch (e) { logger.error('Log failed', e); }
    sceneApi?.setDesiredPosition(pos);
  },
  // Editor-Methoden: Kein Caching mehr, direkt an Scene durchreichen
  setZoneOverlay: (polys) => {
    sceneApi?.setZoneOverlay(polys);
  },
  setZonesVisible: (visible) => {
    sceneApi?.setZonesVisible?.(visible);
  },
  setEditorAssets: (assets) => {
    sceneApi?.setEditorAssets(assets);
  },
  // Optional: dedizierter Weg um Bubble-Mitglieder zu cachen (UI steuert dieses Set)
  onPointerDownTile: (p) => {
    const state = EditorService.getState();
    if (!state.active) return;

    const { tileX, tileY } = p;

    // Note: 'asset', 'spawn', 'erase' tools are handled by EditorInputHandler (new system).
    // Only zone and legacy tools are still dispatched through the bridge.
    switch (state.tool) {
      case 'zone':
        EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX, tileY });
        break;
    }
  },
  onPointerMoveTile: (p) => {
    const state = EditorService.getState();
    if (!state.active || !state.dragState) return;

    const { tileX, tileY } = p;

    // Note: 'asset' drag is handled by EditorInputHandler (new system).
    switch (state.tool) {
      case 'zone':
        EditorService.dispatch({ type: 'UPDATE_ZONE_DRAG', tileX, tileY });
        // Update visual selection via setSelectionRect
        if (state.dragState) {
          const drag = state.dragState;
          const tileSize = 16;
          const x0 = Math.min(drag.startTileX, tileX) * tileSize;
          const y0 = Math.min(drag.startTileY, tileY) * tileSize;
          const x1 = (Math.max(drag.startTileX, tileX) + 1) * tileSize;
          const y1 = (Math.max(drag.startTileY, tileY) + 1) * tileSize;
          gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
        break;
    }
  },
  onPointerUpTile: (p) => {
    const state = EditorService.getState();
    logger.debug('[Bridge] onPointerUpTile', p, state.tool);
    if (!state.active) return;

    const { tileX, tileY } = p;

    // Note: 'asset' and 'spawn' tools are handled by EditorInputHandler (new system).
    switch (state.tool) {
      case 'zone':
        if (state.dragState) {
          EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX, tileY });
          EditorService.dispatch({ type: 'MARK_ZONES_MODIFIED' });
          gameBridge.setSelectionRect(null);
        }
        break;
    }
  },
  setSelectionRect: (rect) => {
    sceneApi?.setSelectionRect(rect);
  },
  applyTilePaint: (edit) => {
    sceneApi?.applyTilePaint(edit);
  },
  applyTerrainPaint: (edit) => {
    sceneApi?.applyTerrainPaint?.(edit);
  },
  applyTerrainPaintV2: (edit) => {
    sceneApi?.paintTerrainRect?.(edit.layer, edit.rect, edit.tileRefId);
  },
  eraseTerrainRect: (rect) => {
    sceneApi?.eraseTerrainRect?.(rect);
  },
  applyWallPaint: (edit) => {
    sceneApi?.applyWallPaint?.(edit);
  },
  registerTileset: (ts) => {
    sceneApi?.registerTileset(ts);

    if (!registeredTilesets.has(ts.key)) {
      tilesetQueue.push({
        key: ts.key,
        dataUrl: ts.dataUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        margin: ts.margin ?? 0,
        spacing: ts.spacing ?? 0
      });
      void processTilesetQueue();
    }
  },
  setCollisionVisible: (visible) => {
    cachedCollisionVisible = !!visible;
    sceneApi?.setCollisionVisible(visible);
  },
  reloadEditorLayers: () => {
    if (isReloadingEditorLayers) return;
    isReloadingEditorLayers = true;
    try {
      sceneApi?.reloadEditorLayers();
    } finally {
      setTimeout(() => { isReloadingEditorLayers = false; }, 100);
    }
  },
  fetchAndApplyServerLayers: () => {
    if (isFetchingServerLayers) return;
    isFetchingServerLayers = true;
    try {
      sceneApi?.fetchAndApplyServerLayers?.();
    } finally {
      setTimeout(() => { isFetchingServerLayers = false; }, 100);
    }
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
    } catch (e) { logger.error('Failed to handle editor update', e); }
  },
  // Editor-Methoden: Kein Caching, direkt durchreichen
  setBackgroundColor: (hex: string) => {
    sceneApi?.setBackgroundColor?.(hex);
  },
  setSpawnMarker: (pos) => {
    sceneApi?.setSpawnMarker?.(pos);
  },
  saveEditorLayersHard: () => { try { sceneApi?.saveEditorLayersHard?.(); } catch (e) { logger.error('Failed hard save', e); } },
  applyChunkUpdates: (layerName, updates) => {
    try { sceneApi?.applyChunkUpdates?.(layerName, updates); } catch (e) { logger.error('Failed to apply chunk updates', e); }
  },
  forceReloadMap: () => {
    try { sceneApi?.forceReloadMap?.(); } catch (e) { logger.error('Failed to force reload map', e); }
  },
  // Tileset-Cache entfernt - nicht mehr benötigt
  hydrateTilesetsCache: (_tilesets) => {
    // DEPRECATED: Caching entfernt
  },
  updateTilesetRegistry: (registry) => {
    v2TilesetCache = Array.isArray(registry) ? registry : [];
    try { sceneApi?.updateTilesetRegistry?.(registry); } catch (e) { logger.error('Failed to update tileset registry', e); }
  },
  handleObjectsUpdated: (data) => {
    try { sceneApi?.handleObjectsUpdated?.(data); } catch (e) { logger.error('Failed to handle objects update', e); }
  },
  changeHeroAvatar: (avatarId) => {
    sceneApi?.changeHeroAvatar?.(avatarId);
  },
};

// Subscribe EditorService zu gameBridge für automatische Synchronisation
// WICHTIG: Nur bei tatsächlichen Änderungen updaten, um Render-Loops zu vermeiden
let lastSyncedState: {
  active: boolean;
  selectedTileRefId: number;
  tool: string;
} = {
  active: false,
  selectedTileRefId: 0,
  tool: '',
};

EditorService.subscribe((state) => {
  // Zone, Asset, Spawn, and Asset-Preview sync are now handled by EditorRenderer via EditorIntegration.
  // Only Terrain Ghost Preview and Editor Mode toggling remain here.

  // Sync Terrain Ghost Preview (EditorRenderer does NOT handle terrain ghost)
  const tileRefChanged = state.selectedTileRefId !== lastSyncedState.selectedTileRefId || state.tool !== lastSyncedState.tool;
  if (tileRefChanged) {
    lastSyncedState.selectedTileRefId = state.selectedTileRefId;
    lastSyncedState.tool = state.tool;

    if (state.tool === 'terrain' && state.selectedTileRefId > 0) {
      const gen = ++terrainPreviewGeneration;
      void (async () => {
        try {
          // Lazy-load V2 tileset cache if empty
          if (v2TilesetCache.length === 0) {
            const mapId = useMapStore.getState().currentMapId;
            if (mapId) {
              const v2State = await fetchStateV2(mapId);
              if (v2State?.tilesetRegistry) {
                v2TilesetCache = v2State.tilesetRegistry;
              }
            }
          }

          if (gen !== terrainPreviewGeneration) return;

          const { slot, tileIndex } = splitTileRefId(state.selectedTileRefId);
          const ts = v2TilesetCache.find(t => t.slot === slot);
          if (!ts || !ts.imageUrl) return;

          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = resolveImageUrl(ts.imageUrl);
          });

          if (gen !== terrainPreviewGeneration) return;

          const tw = ts.tileWidth || 16;
          const th = ts.tileHeight || 16;
          const margin = ts.margin ?? 0;
          const spacing = ts.spacing ?? 0;
          const cols = Math.max(1, Math.floor((img.width - 2 * margin + spacing) / (tw + spacing)));
          const col = tileIndex % cols;
          const row = Math.floor(tileIndex / cols);
          const sx = margin + col * (tw + spacing);
          const sy = margin + row * (th + spacing);

          const canvas = document.createElement('canvas');
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, sx, sy, tw, th, 0, 0, tw, th);
            const dataUrl = canvas.toDataURL('image/png');
            sceneApi?.setAssetPreview?.({ dataUrl, width: tw, height: th });
          }
        } catch (e) {
          logger.debug('[Bridge] Failed to create terrain ghost preview', e);
        }
      })();
    } else if (state.tool !== 'asset' && !state.pendingAsset) {
      ++terrainPreviewGeneration;
      sceneApi?.setAssetPreview?.(null);
    }
  }

  // Sync Editor Mode & Collision Visibility (nur wenn geändert)
  if (state.active !== lastSyncedState.active) {
    gameBridge.setEditorMode(state.active);
    gameBridge.setCollisionVisible(state.active);
    lastSyncedState.active = state.active;
  }
});
