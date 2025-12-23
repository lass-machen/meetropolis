import { EditorService } from '../services/EditorService';
import { logger } from '../lib/logger';

export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined }>) => void;
  addRemotePlayer: (id: string, p: { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined }) => void;
  updateRemotePlayer: (id: string, p: Partial<{ x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined }>) => void;
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
  setAssetPreview: (preview: { dataUrl: string; width?: number | undefined; height?: number | undefined } | null) => void;
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
  applyChunkUpdates?: (layerName: 'ground' | 'walls' | 'collision', updates: Array<{ key: string; version: number; encoding: string; data: string }>) => void;
  forceReloadMap?: () => void;
  // Expose method to hydrate tileset cache from outside (e.g. serverSync)
  hydrateTilesetsCache: (tilesets: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }[]) => void;
  // Update tileset registry in scene
  updateTilesetRegistry: (registry: any[]) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined }>) => void;
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
  setAssetPreview?: (preview: { dataUrl: string; width?: number | undefined; height?: number | undefined } | null) => void;
  // New hooks
  setMovementLocked?: (locked: boolean) => void;
  findFreeSpotNear?: (targetId: string, options?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  recenterCamera?: () => void;
  setEditorMode?: (enabled: boolean) => void;
  setBackgroundColor?: (hex: string) => void;
  setSpawnMarker?: (pos: { x: number; y: number } | null) => void;
  saveEditorLayersHard?: () => void;
  applyChunkUpdates?: (layerName: 'ground' | 'walls' | 'collision', updates: Array<{ key: string; version: number; encoding: string; data: string }>) => void;
  forceReloadMap?: () => void;
  updateTilesetRegistry?: (registry: any[]) => void;
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

  const anyWin = window as Record<string, unknown>;
  const base = (anyWin.desktop as { apiBase?: string })?.apiBase
    || anyWin.__MEETROPOLIS_API_BASE__ as string
    || anyWin.VITE_API_BASE as string
    || (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
    || `${window.location.protocol}//${window.location.hostname}:2567`;
  const mapName = (anyWin.__map_name as string) || (anyWin.MAP_NAME as string) || 'office';

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
      const res = await fetch(`${base}/maps/${encodeURIComponent(mapName)}/tilesets`, {
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
let remotePlayersCache: Record<string, { x: number; y: number; direction: Direction; name?: string | undefined; dnd?: boolean | undefined }> = {};
let lastDesiredPosition: { x: number; y: number } | null = null;

// Editor-State-Caching ENTFERNT - EditorService ist jetzt Single Source of Truth
// cachedZones, cachedAssets, cachedSpawnMarker, cachedTilesets, cachedBackgroundColor -> GELÖSCHT

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

    switch (state.tool) {
      case 'zone':
        EditorService.dispatch({ type: 'START_ZONE_DRAG', tileX, tileY });
        break;
      case 'asset':
        if (state.pendingAsset) {
          EditorService.dispatch({ type: 'START_ASSET_DRAG', tileX, tileY });
        }
        break;
      case 'spawn':
        // Spawn wird bei PointerUp gesetzt
        break;
      case 'erase':
        // Check if clicking on an asset to delete
        const tileSize = 16; // TODO: Get from map
        const worldX = tileX * tileSize + tileSize / 2;
        const worldY = tileY * tileSize + tileSize / 2;
        const asset = state.assets.find(a => {
          const dx = Math.abs(a.x - worldX);
          const dy = Math.abs(a.y - worldY);
          return dx < tileSize && dy < tileSize;
        });
        if (asset) {
          EditorService.dispatch({ type: 'DELETE_ASSET', id: asset.id });
        }
        break;
    }
  },
  onPointerMoveTile: (p) => {
    const state = EditorService.getState();
    if (!state.active || !state.dragState) return;

    const { tileX, tileY } = p;

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
      case 'asset':
        if (state.pendingAsset) {
          EditorService.dispatch({ type: 'UPDATE_ASSET_DRAG', tileX, tileY });
          // Update visual selection
          if (state.dragState) {
            const drag = state.dragState;
            const tileSize = 16;
            const x0 = Math.min(drag.startTileX, tileX) * tileSize;
            const y0 = Math.min(drag.startTileY, tileY) * tileSize;
            const x1 = (Math.max(drag.startTileX, tileX) + 1) * tileSize;
            const y1 = (Math.max(drag.startTileY, tileY) + 1) * tileSize;
            gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
          }
        }
        break;
    }
  },
  onPointerUpTile: (p) => {
    const state = EditorService.getState();
    logger.debug('[Bridge] onPointerUpTile', p, state.tool);
    if (!state.active) return;

    const { tileX, tileY } = p;

    switch (state.tool) {
      case 'zone':
        if (state.dragState) {
          EditorService.dispatch({ type: 'COMPLETE_ZONE', tileX, tileY });
          gameBridge.setSelectionRect(null);
        }
        break;
      case 'asset':
        if (state.pendingAsset) {
          if (state.dragState) {
            EditorService.dispatch({ type: 'COMPLETE_ASSET_DRAG', tileX, tileY });
          } else {
            EditorService.dispatch({ type: 'PLACE_ASSET', tileX, tileY });
          }
          gameBridge.setSelectionRect(null);
        }
        break;
      case 'spawn':
        const tileSize = 16;
        const x = tileX * tileSize + tileSize / 2;
        const y = tileY * tileSize + tileSize / 2;
        logger.debug('[Bridge] Dispatching SET_SPAWN', { x, y });
        EditorService.dispatch({ type: 'SET_SPAWN', x, y });
        break;
    }
  },
  setSelectionRect: (rect) => {
    sceneApi?.setSelectionRect(rect);
  },
  applyTilePaint: (edit) => {
    sceneApi?.applyTilePaint(edit);
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
    try { sceneApi?.updateTilesetRegistry?.(registry); } catch (e) { logger.error('Failed to update tileset registry', e); }
  }
};

// Subscribe EditorService zu gameBridge für automatische Synchronisation
// WICHTIG: Nur bei tatsächlichen Änderungen updaten, um Render-Loops zu vermeiden
let lastSyncedState: {
  zonesLength: number;
  assetsLength: number;
  spawn: any;
  pendingAsset: any;
  active: boolean;
} = {
  zonesLength: 0,
  assetsLength: 0,
  spawn: null,
  pendingAsset: null,
  active: false,
};

// Debounce für Asset-Updates um initiale Multi-Calls zu vermeiden
let assetUpdateTimeout: ReturnType<typeof setTimeout> | null = null;

EditorService.subscribe((state) => {
  // Sync Zones (nur wenn Anzahl geändert - schneller als JSON.stringify)
  if (state.zones.length !== lastSyncedState.zonesLength) {
    gameBridge.setZoneOverlay(state.zones);
    lastSyncedState.zonesLength = state.zones.length;
  }

  // Sync Assets (debounced um initiale Multi-Calls zu vermeiden)
  const assetsChanged = state.assets.length !== lastSyncedState.assetsLength;
  if (assetsChanged) {
    lastSyncedState.assetsLength = state.assets.length;

    // Clear existing timeout
    if (assetUpdateTimeout) {
      clearTimeout(assetUpdateTimeout);
    }

    // Debounce Asset-Updates (50ms)
    assetUpdateTimeout = setTimeout(() => {
      gameBridge.setEditorAssets(state.assets);
      assetUpdateTimeout = null;
    }, 50);
  }

  // Sync Spawn (nur wenn geändert)
  const spawnChanged = JSON.stringify(state.spawn) !== JSON.stringify(lastSyncedState.spawn);
  if (spawnChanged) {
    gameBridge.setSpawnMarker(state.spawn);
    lastSyncedState.spawn = state.spawn;
  }

  // Sync Asset Preview (nur wenn geändert)
  const pendingAssetChanged = JSON.stringify(state.pendingAsset) !== JSON.stringify(lastSyncedState.pendingAsset);
  if (pendingAssetChanged) {
    if (state.pendingAsset) {
      gameBridge.setAssetPreview({
        dataUrl: state.pendingAsset.dataUrl,
        width: state.pendingAsset.width,
        height: state.pendingAsset.height,
      });
    } else {
      gameBridge.setAssetPreview(null);
    }
    lastSyncedState.pendingAsset = state.pendingAsset;
  }

  // Sync Editor Mode & Collision Visibility (nur wenn geändert)
  if (state.active !== lastSyncedState.active) {
    gameBridge.setEditorMode(state.active);
    gameBridge.setCollisionVisible(state.active);
    lastSyncedState.active = state.active;
  }
});
