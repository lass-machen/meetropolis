import { EditorService } from '../services/EditorService';
import { logger } from '../lib/logger';
import { useMapStore } from '../state/mapStore';
import { getApiBaseFromWindow } from '../lib/runtimeConfig';
import type {
  AutotileRegistration,
  ChunkLayerName,
  ChunkUpdateEntry,
  EditorUpdatePayload,
  GameBridge,
  PlayerDirection,
  RemotePlayerData,
  TilePaintEdit,
  TilesetRegistration,
} from '../types/game';
import type { MapObjectData } from './scenes/main/objectManager';

/**
 * Direction alias kept for backwards compatibility with existing imports
 * (`import { Direction } from '../game/bridge'`). The canonical type lives
 * in `../types/game` as `PlayerDirection`.
 */
export type Direction = PlayerDirection;

/**
 * Internal extension to the public GameBridge contract. bridge.ts owns the
 * SceneApi wiring; `setSceneApi` keeps the wider `unknown` argument from
 * GameBridge but casts internally to the concrete SceneApi type.
 */
interface InternalBridge extends GameBridge {
  /** Pending autotile definitions queued before the scene is ready. */
  _pendingAutotiles?: AutotileRegistration[];
}

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, RemotePlayerData>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setZonesVisible?: (visible: boolean) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: TilePaintEdit) => void;
  registerTileset: (ts: TilesetRegistration) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  fetchAndApplyServerLayers?: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName?: (name: string) => void;
  updateSpeakingStates?: (speakingIds: Set<string>) => void;
  setDoNotDisturb?: (enabled: boolean) => void;
  setAssetPreview?: (
    preview: {
      dataUrl: string;
      width?: number | undefined;
      height?: number | undefined;
      rotation?: number | undefined;
      packUuid?: string | undefined;
      itemId?: string | undefined;
    } | null,
  ) => void;
  // New hooks
  setMovementLocked?: (locked: boolean) => void;
  findFreeSpotNear?: (
    targetId: string,
    options?: { radius?: number; step?: number },
  ) => { x: number; y: number } | null;
  recenterCamera?: () => void;
  setEditorMode?: (enabled: boolean) => void;
  setBackgroundColor?: (hex: string) => void;
  setSpawnMarker?: (pos: { x: number; y: number } | null) => void;
  saveEditorLayersHard?: () => void;
  applyChunkUpdates?: (layerName: ChunkLayerName, updates: ChunkUpdateEntry[]) => void;
  forceReloadMap?: () => void;
  updateTilesetRegistry?: (registry: unknown[]) => void;
  changeHeroAvatar?: (avatarId: string) => void;
  handleObjectsUpdated?: (data: {
    action: 'add' | 'remove' | 'update';
    objects?: MapObjectData[] | undefined;
    objectIds?: number[] | undefined;
  }) => void;
  applyTerrainPaint?: (edit: {
    rect: { startX: number; startY: number; endX: number; endY: number };
    dataUrl: string;
  }) => void;
  paintTerrainRect?: (
    layer: string,
    rect: { x0: number; y0: number; x1: number; y1: number },
    tileRefId: number,
  ) => void;
  eraseTerrainRect?: (rect: { startX: number; startY: number; endX: number; endY: number }) => void;
  applyWallPaint?: (edit: {
    rect: { startX: number; startY: number; endX: number; endY: number };
    wallTypeId: number;
  }) => void;
  captureEditorSnapshot?: () => void;
  restoreEditorSnapshot?: () => void;
  registerAutotileDefinitions?: (items: AutotileRegistration[]) => void;
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

  const base = getApiBaseFromWindow();
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
      spacing: ts.spacing,
    };

    try {
      const res = await fetch(`${base}/maps/${encodeURIComponent(mapId)}/tilesets`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

// Non-editor state (preserved)
let cachedCollisionVisible = false;
let cachedHeroName: string | null = null;
let cachedDoNotDisturb = false;
let remotePlayersCache: Record<string, RemotePlayerData> = {};
let lastDesiredPosition: { x: number; y: number } | null = null;

export const gameBridge: InternalBridge = {
  onLocalMove: () => {},
  onPointerDown: () => {},
  onRightClick: () => {},
  onCameraManualChange: () => {},
  setSceneApi: (api) => {
    // GameBridge declares `api: unknown` to keep the public type free of
    // Phaser dependencies; the runtime caller passes the concrete SceneApi.
    sceneApi = api as SceneApi | null;

    if (sceneApi) {
      // Restore non-editor state
      try {
        sceneApi.setCollisionVisible(cachedCollisionVisible);
      } catch (e) {
        logger.error('Failed to set collision visible', e);
      }

      if (cachedHeroName && sceneApi.setHeroName) {
        try {
          sceneApi.setHeroName(cachedHeroName);
        } catch {}
      }

      if (typeof sceneApi.setDoNotDisturb === 'function') {
        try {
          sceneApi.setDoNotDisturb(cachedDoNotDisturb);
        } catch {}
      }

      // Restore remote players
      try {
        sceneApi.syncRemotePlayers(remotePlayersCache);
      } catch {}

      // Load server layers (map data).
      try {
        sceneApi.fetchAndApplyServerLayers?.();
      } catch (e) {
        logger.error('Failed to fetch server layers', e);
      }
      try {
        sceneApi.reloadEditorLayers();
      } catch (e) {
        logger.error('Failed to reload editor layers', e);
      }
    }
  },
  recenterCamera: () => {
    sceneApi?.recenterCamera?.();
  },
  setEditorMode: (enabled) => {
    sceneApi?.setEditorMode?.(!!enabled);
  },
  syncRemotePlayers: (players) => {
    // Replace the entire cache with the new source of truth
    remotePlayersCache = { ...players };
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  addRemotePlayer: (id, p) => {
    remotePlayersCache[id] = {
      x: p.x,
      y: p.y,
      direction: p.direction,
      name: p.name,
      dnd: p.dnd,
      avatarId: p.avatarId,
      isNpc: p.isNpc,
    };
    sceneApi?.syncRemotePlayers(remotePlayersCache);
  },
  updateRemotePlayer: (id, p) => {
    if (!remotePlayersCache[id]) {
      // If the player does not exist, only create them when enough data is available
      if (p.x !== undefined && p.y !== undefined && p.direction) {
        remotePlayersCache[id] = {
          x: p.x,
          y: p.y,
          direction: p.direction,
          name: p.name,
          dnd: p.dnd,
          avatarId: p.avatarId,
        };
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
    try {
      logger.debug('[Bridge] setDesiredPosition changed to', pos);
    } catch (e) {
      logger.error('Log failed', e);
    }
    sceneApi?.setDesiredPosition(pos);
  },
  // Editor methods: no more caching, pass straight through to the scene
  setZoneOverlay: (polys) => {
    sceneApi?.setZoneOverlay(polys);
  },
  setZonesVisible: (visible) => {
    sceneApi?.setZonesVisible?.(visible);
  },
  // Legacy pointer tile callbacks (no-op, all tools handled by EditorInputHandler in EditorIntegration)
  onPointerDownTile: () => {},
  onPointerMoveTile: () => {},
  onPointerUpTile: () => {},
  setSelectionRect: (rect) => {
    sceneApi?.setSelectionRect(rect);
  },
  applyTilePaint: (edit) => {
    sceneApi?.applyTilePaint(edit);
  },
  // Legacy paint methods (no-op, painting handled by EditorIntegration.applyLocalPaint)
  applyTerrainPaint: () => {},
  applyTerrainPaintV2: () => {},
  eraseTerrainRect: () => {},
  applyWallPaint: () => {},
  captureEditorSnapshot: () => {
    sceneApi?.captureEditorSnapshot?.();
  },
  restoreEditorSnapshot: () => {
    sceneApi?.restoreEditorSnapshot?.();
  },
  registerAutotiles: (items) => {
    if (sceneApi?.registerAutotileDefinitions) {
      sceneApi.registerAutotileDefinitions(items);
    } else {
      // Scene not ready - store for later
      gameBridge._pendingAutotiles = items;
    }
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
        spacing: ts.spacing ?? 0,
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
      setTimeout(() => {
        isReloadingEditorLayers = false;
      }, 100);
    }
  },
  fetchAndApplyServerLayers: () => {
    if (isFetchingServerLayers) return;
    isFetchingServerLayers = true;
    try {
      sceneApi?.fetchAndApplyServerLayers?.();
    } finally {
      setTimeout(() => {
        isFetchingServerLayers = false;
      }, 100);
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
  // Legacy: ghost preview now handled by EditorIntegration
  setAssetPreview: () => {},
  setMovementLocked: (locked) => {
    sceneApi?.setMovementLocked?.(locked);
  },
  findFreeSpotNear: (targetId, options) => {
    return sceneApi?.findFreeSpotNear?.(targetId, options) ?? null;
  },
  handleEditorUpdate: (data: EditorUpdatePayload) => {
    try {
      if (!data) return;
      if (data.type === 'tile_paint' && data.edit) {
        sceneApi?.applyTilePaint?.(data.edit);
        return;
      }
      if (data.type === 'layers' || data.type === 'all') {
        // Reload server layers
        sceneApi?.fetchAndApplyServerLayers?.();
        return;
      }
      if (data.type === 'zone' && Array.isArray(data.polys)) {
        sceneApi?.setZoneOverlay?.(data.polys);
        return;
      }
    } catch (e) {
      logger.error('Failed to handle editor update', e);
    }
  },
  // Editor methods: no caching, pass straight through
  setBackgroundColor: (hex: string) => {
    sceneApi?.setBackgroundColor?.(hex);
  },
  setSpawnMarker: (pos) => {
    sceneApi?.setSpawnMarker?.(pos);
  },
  saveEditorLayersHard: () => {
    try {
      sceneApi?.saveEditorLayersHard?.();
    } catch (e) {
      logger.error('Failed hard save', e);
    }
  },
  applyChunkUpdates: (layerName, updates) => {
    try {
      sceneApi?.applyChunkUpdates?.(layerName, updates);
    } catch (e) {
      logger.error('Failed to apply chunk updates', e);
    }
  },
  forceReloadMap: () => {
    try {
      sceneApi?.forceReloadMap?.();
    } catch (e) {
      logger.error('Failed to force reload map', e);
    }
  },
  // Tileset cache has been removed; no longer required.
  hydrateTilesetsCache: (_tilesets) => {
    // DEPRECATED: caching removed.
  },
  updateTilesetRegistry: (registry) => {
    try {
      sceneApi?.updateTilesetRegistry?.(registry);
    } catch (e) {
      logger.error('Failed to update tileset registry', e);
    }
  },
  handleObjectsUpdated: (data) => {
    try {
      // GameBridge declares objects as unknown[] (because the network payload
      // is loose); the SceneApi narrows to MapObjectData[]. The boundary cast
      // is safe here because the server-side payload is validated upstream.
      sceneApi?.handleObjectsUpdated?.(
        data as { action: 'add' | 'remove' | 'update'; objects?: MapObjectData[]; objectIds?: number[] },
      );
    } catch (e) {
      logger.error('Failed to handle objects update', e);
    }
  },
  changeHeroAvatar: (avatarId) => {
    sceneApi?.changeHeroAvatar?.(avatarId);
  },
};

// Subscribe EditorService to gameBridge for Editor Mode & Collision Visibility sync
const lastSyncedState: {
  active: boolean;
} = {
  active: false,
};

EditorService.subscribe((state) => {
  // Sync editor mode and collision visibility (only when changed).
  if (state.active !== lastSyncedState.active) {
    gameBridge.setEditorMode(state.active);
    gameBridge.setCollisionVisible(state.active);
    lastSyncedState.active = state.active;
  }
});
