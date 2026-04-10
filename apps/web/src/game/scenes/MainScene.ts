import Phaser from 'phaser';
import { GameSystem } from '../systems/types';
import { gameBridge } from '../bridge';
import { V2State } from '../../lib/mapV2';
import { logger } from '../../lib/logger';
import { setBubbleMembers as uiSetBubbleMembers } from '../ui/bubbles';
import { ensureRecenterUi, updateRecenterUiVisibility } from '../camera/recenterUi';
import { setCollisionVisible, updateCollisionOverlay } from '../collision/overlay';
import { setAssetPreview } from '../editor/editorAssets';
import { fetchAndApplyServerLayers } from '../map/serverSync';
import { loadVisibleChunks, applyChunkUpdates } from '../map/chunks';
import type { ChunkLayerName } from '../map/chunks';
import { registerTileset } from '../map/tilesets';
import { EditorService } from '../../services/EditorService';
import { EditorIntegration } from '../editor/integration';
import { AutotileGrid, AutotileRenderer } from '../autotile';
import { avatarRegistry } from '../avatarRegistry';
import { useMapStore } from '../../state/mapStore';
import {
  PlayerManager,
  RemotePlayersManager,
  CameraController,
  CollisionManager,
  TileManager,
  UIManager,
  NameLabelManager,
  SceneInitializer,
  ObjectManager,
} from './main';
import type { ObjectsUpdatedPayload } from './main';

export class MainScene extends Phaser.Scene {
  private playerManager!: PlayerManager;
  private remotePlayersManager!: RemotePlayersManager;
  private cameraController!: CameraController;
  private collisionManager!: CollisionManager;
  private tileManager!: TileManager;
  private uiManager!: UIManager;
  private nameLabelManager!: NameLabelManager;
  private objectManager!: ObjectManager;

  private mapRef?: Phaser.Tilemaps.Tilemap;
  private editorGround?: Phaser.Tilemaps.TilemapLayer;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  private dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private bubbleOutlines: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  private loadedChunks: Set<string> = new Set();
  private systems: GameSystem[] = [];
  private editorMode = false;
  private editorMapObjectsSnapshot: import('../../services/EditorTypes').MapObjectRecord[] | null = null;
  public autotileGrid?: AutotileGrid;
  public autotileRenderer?: AutotileRenderer;
  private _lastCamSig: string | null = null;

  public currentMapId: string = (() => {
    try { return useMapStore.getState().currentMapId || ''; } catch { return ''; }
  })();
  public currentMapName: string = (() => {
    try { return useMapStore.getState().currentMapName || 'office'; } catch { return 'office'; }
  })();
  public terrainTilesetSources: Map<string, string> = new Map();
  public collisionVisible: boolean = false;
  public collisionOverlay?: Phaser.GameObjects.Graphics;
  public editorSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  public pendingTextures: Set<string> = new Set();
  private editorIntegration?: EditorIntegration;

  constructor() {
    super('Main');
  }

  create() {
    // Re-read currentMapId/Name on every create() since Phaser reuses scene instances
    this.currentMapId = useMapStore.getState().currentMapId || '';
    this.currentMapName = useMapStore.getState().currentMapName || 'office';

    // Clear stale chunk cache from previous map (Phaser reuses scene instances)
    this.loadedChunks.clear();
    this._lastCamSig = null;

    const mapData = SceneInitializer.initializeMap(this);
    Object.assign(this, mapData);

    const cameraData = SceneInitializer.initializeCamera(this, this.mapRef!);
    (this as any).labelLayer = cameraData.labelLayer;
    (this as any).labelCamera = cameraData.labelCamera;

    this.autotileGrid = new AutotileGrid();
    this.autotileRenderer = new AutotileRenderer(this, this.autotileGrid, this.mapRef?.tileWidth ?? 16);

    this.loadVisibleChunks('ground');
    this.loadVisibleChunks('walls');
    this.loadVisibleChunks('collision');
    this.loadVisibleChunks('walls_auto');

    this.initializeManagers();
    this.setupInputHandlers();
    this.setupEditorSubscriptions();
    this.loadServerData();
    this.setupCleanup();

    // Initialize EditorIntegration with tilemap references for local paint application
    this.editorIntegration = new EditorIntegration(this, this.mapRef?.tileWidth ?? 16, {
      tileManager: this.tileManager,
      autotileGrid: this.autotileGrid,
      autotileRenderer: this.autotileRenderer,
      collisionManager: this.collisionManager,
    });

    // Check for pending autotile registrations (deferred from bridge before scene was ready)
    const pending = (gameBridge as any)._pendingAutotiles;
    if (pending) {
      this.registerAutotileDefinitions(pending);
      delete (gameBridge as any)._pendingAutotiles;
    }
  }

  private initializeManagers() {
    const initialPos = (window as any).initialPlayerPosition || { x: 80, y: 120 };

    const avatarId = localStorage.getItem('avatarId') || 'default-characters:businessman1';
    this.playerManager = new PlayerManager({ scene: this, physics: this.physics, anims: this.anims, mapRef: this.mapRef!, initialPos, avatarId });
    this.nameLabelManager = new NameLabelManager(this);
    this.nameLabelManager.createHeroLabel('Loading...', initialPos.x, initialPos.y);
    this.remotePlayersManager = new RemotePlayersManager(this);
    this.cameraController = new CameraController({ scene: this, camera: this.cameras.main, hero: this.playerManager.getHero(), editorMode: this.editorMode });
    this.cameraController.init(this.input);
    this.cameras.main.startFollow(this.playerManager.getHero(), true, 0.1, 0.1);
    ensureRecenterUi(this as any);
    updateRecenterUiVisibility(this as any);
    this.collisionManager = new CollisionManager({ scene: this, hero: this.playerManager.getHero(), collisionLayer: this.collisionLayer, mapRef: this.mapRef! });
    this.collisionManager.ensureCollisionCollider();
    this.tileManager = new TileManager({ scene: this, mapRef: this.mapRef!, v2: this.v2, editorGround: this.editorGround, wallsLayer: this.wallsLayer, collisionLayer: this.collisionLayer, dynamicTilesets: this.dynamicTilesets });
    this.tileManager.updateBackgrounds();
    this.tileManager.updateGrid();
    this.uiManager = new UIManager({ scene: this, getEditorMode: () => this.editorMode });
    this.uiManager.init();
    this.objectManager = new ObjectManager({ scene: this as any });
  }

  private setupInputHandlers() {
    // Register SPACE key to prevent default browser behavior (scrolling)
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.editorMode) {
        if (this.uiManager.getHoveredSprite()) this.uiManager.setHoveredSprite(null);
        this.uiManager.updateCursor(this.cameraController?.isPanning() || false, this.cameraController?.isSpaceHeld() || false);
        return;
      }
      const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      let foundHover = false;
      for (const [_id, sprite] of this.remotePlayersManager.getAllRemotes()) {
        if (sprite.getBounds().contains(worldPoint.x, worldPoint.y)) {
          if (this.uiManager.getHoveredSprite() !== sprite) this.uiManager.setHoveredSprite(sprite);
          foundHover = true;
          break;
        }
      }
      if (!foundHover && this.uiManager.getHoveredSprite()) this.uiManager.setHoveredSprite(null);
      this.uiManager.updateCursor(this.cameraController?.isPanning() || false, this.cameraController?.isSpaceHeld() || false);
    });

    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (this.editorMode) return;
      if (p.rightButtonDown()) {
        try { (p.event as any)?.preventDefault?.(); } catch { }
        const worldPoint = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
        for (const [id, sprite] of this.remotePlayersManager.getAllRemotes()) {
          if (sprite.getBounds().contains(worldPoint.x, worldPoint.y)) {
            const evt = (p.event as any) as MouseEvent | undefined;
            gameBridge.onRightClick({ x: evt?.clientX ?? p.x, y: evt?.clientY ?? p.y, playerId: id });
            break;
          }
        }
      }
    });

    try { this.input.mouse?.disableContextMenu?.(); } catch { }
    this.game.canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); return false; });

    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      this.playerManager.update(this.input.keyboard!.createCursorKeys(), (data) => gameBridge.onLocalMove(data));
      const hero = this.playerManager.getHero();
      this.nameLabelManager.updateHeroLabel(hero.x, hero.y);
      this.nameLabelManager.updateAllRemoteLabels(this.remotePlayersManager.getAllRemotes());
      this.remotePlayersManager.update();
      this.cameraController?.autoFollowIfHeroOutOfView?.();
      updateRecenterUiVisibility(this as any);
      if (this.editorMode) this.cameraController.updateEditorPan(this.input.keyboard!.createCursorKeys(), this.game.loop.delta);
    });
  }

  private setupEditorSubscriptions() {
    EditorService.subscribe(() => {
      this.tileManager.updateBackgrounds();
      this.tileManager.updateGrid();
      this.uiManager.updateCursor(this.cameraController?.isPanning() || false, this.cameraController?.isSpaceHeld() || false);
      // Spawn rendering is now handled by EditorRenderer via EditorIntegration
    });
  }

  private loadServerData() {
    setTimeout(() => {
      this.fetchAndApplyServerLayers().then(() => {
        if (!this.editorMode) try { this.collisionLayer?.setVisible(false); } catch (e) { logger.error('[MainScene] Failed to hide collision layer', e); }
      }).catch(e => logger.error('[MainScene] Failed to load server layers', e));
    }, 100);
    if (this.v2) try { this.collisionLayer?.setVisible(false); } catch (e) { logger.error('[MainScene] Failed to hide collision layer', e); }

    const pendingTilesets = (window as any).pendingTilesets;
    if (pendingTilesets && Array.isArray(pendingTilesets)) {
      setTimeout(() => pendingTilesets.forEach((ts: any) => this.registerTileset(ts)), 100);
      (window as any).pendingTilesets = null;
    }
  }

  private setupCleanup() {
    gameBridge.setSceneApi(this);
    (window as any).currentPhaserScene = this;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { try { this.editorIntegration?.destroy(); } catch { } try { this.objectManager.destroy(); } catch { } try { gameBridge.setSceneApi(null); } catch { } });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => { try { this.editorIntegration?.destroy(); } catch { } try { this.objectManager.destroy(); } catch { } try { gameBridge.setSceneApi(null); } catch { } });
  }

  recenterCamera() {
    this.cameraController.recenterCamera();
    updateRecenterUiVisibility(this as any);
  }

  setEditorMode(enabled: boolean) {
    this.editorMode = !!enabled;
    this.cameraController.setEditorMode(enabled);
    this.playerManager.setMovementLocked(enabled);

    if (enabled) {
      this.uiManager.setHoveredSprite(null);
      this.captureEditorSnapshot();
      try { setCollisionVisible(this as any, true); } catch { }
      try { this.collisionLayer?.setVisible(false); } catch { }
      updateRecenterUiVisibility(this as any);
      this.nameLabelManager.setHeroLabelVisibility(false);
      this.nameLabelManager.setAllRemoteLabelsVisibility(false);
      try { this.bubbleOutlines.forEach(g => g.setVisible(false)); } catch { }
      try { this.objectManager.setAllSpritesVisible(false); } catch { }
      try { this.remotePlayersManager.setVisibility(false); } catch { }
      try { this.playerManager.setVisible(false); } catch { }
      try { this.fetchAndApplyServerLayers(); } catch { }
    } else {
      this.nameLabelManager.setHeroLabelVisibility(true);
      this.nameLabelManager.setAllRemoteLabelsVisibility(true);
      try { this.bubbleOutlines.forEach(g => g.setVisible(true)); } catch { }
      try { this.objectManager.setAllSpritesVisible(true); } catch { }
      try { this.remotePlayersManager.setVisibility(true); } catch { }
      try { this.playerManager.setVisible(true); } catch { }
      this.uiManager.hideEditorOverlays();
      if (this.v2) try { this.collisionLayer?.setVisible(false); } catch { }
    }

    try {
      this.systems.forEach((s) => s.init());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { try { this.systems.forEach((s) => s.destroy()); } catch { } });
    } catch { }
  }

  captureEditorSnapshot() {
    const currentObjects = EditorService.getState().mapObjects;
    this.editorMapObjectsSnapshot = JSON.parse(JSON.stringify(currentObjects));
    logger.debug('[MainScene] Editor snapshot captured', { objectCount: currentObjects.length });
  }

  restoreEditorSnapshot() {
    if (!this.editorMapObjectsSnapshot) return;

    // Restore mapObjects in EditorService
    EditorService.dispatch({ type: 'LOAD_MAP_OBJECTS', objects: this.editorMapObjectsSnapshot });
    EditorService.dispatch({ type: 'CLEAR_PENDING_CHANGES' });

    // Force reload map from server to restore terrain/collision/walls state
    this.forceReloadMap();

    logger.debug('[MainScene] Editor snapshot restored', { objectCount: this.editorMapObjectsSnapshot.length });
    this.editorMapObjectsSnapshot = null;
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up' | 'down' | 'left' | 'right'; prevX?: number; prevY?: number; name?: string | undefined; dnd?: boolean | undefined; avatarId?: string | undefined; isNpc?: boolean | undefined }>) {
    const localSession: string | undefined = (typeof window !== 'undefined' ? (window as any).__localSessionId : undefined);
    const hero = this.playerManager.getHero();

    const filteredPlayers: typeof players = {};
    for (const [id, p] of Object.entries(players)) {
      if (localSession && id === localSession) continue;
      if (hero && Math.abs(p.x - hero.x) < 0.01 && Math.abs(p.y - hero.y) < 0.01) continue;
      filteredPlayers[id] = p;
    }

    this.remotePlayersManager.syncRemotePlayers(filteredPlayers, localSession);
    this.collisionManager.setRemotes(this.remotePlayersManager.getAllRemotes());

    for (const [id, p] of Object.entries(filteredPlayers)) {
      if (!this.nameLabelManager.getRemoteLabel(id)) {
        this.nameLabelManager.createRemoteLabel(id, p.name || `User ${id.substring(0, 6)}`, p.x, p.y, (p as any).isNpc);
      }
      if (p && typeof (p as any).name === 'string' && (p as any).name) {
        this.nameLabelManager.updateRemoteLabelName(id, (p as any).name);
      }
      if ((p as any).dnd !== undefined) {
        this.nameLabelManager.setRemoteLabelAlpha(id, (p as any).dnd ? 0.6 : 1);
      }
      this.nameLabelManager.updateRemoteLabel(id, p.x, p.y);
    }

    for (const id of Array.from(this.nameLabelManager.getAllRemoteLabels().keys())) {
      if (!filteredPlayers[id]) this.nameLabelManager.removeRemoteLabel(id);
    }
  }

  setDoNotDisturb(enabled: boolean) {
    this.playerManager.setTransparency(enabled ? 0.35 : 1);
    this.nameLabelManager.setHeroLabelAlpha(enabled ? 0.6 : 1);
    this.remotePlayersManager.setVisibility(true);
    this.nameLabelManager.setAllRemoteLabelsVisibility(true);
    this.bubbleOutlines.forEach((g) => g.setVisible(true));
  }

  setDesiredPosition(pos: { x: number; y: number } | null) { this.playerManager.setDesiredPosition(pos); }
  setMovementLocked(locked: boolean) { this.playerManager.setMovementLocked(locked); }
  findFreeSpotNear(targetId: string, options?: { radius?: number; step?: number }): { x: number; y: number } | null { return this.collisionManager.findFreeSpotNear(targetId, options); }
  setZoneOverlay(_polys: { name: string; points: any[] }[]) { /* Handled by EditorRenderer */ }
  setZonesVisible(visible: boolean) { this.uiManager.setZonesVisible(visible); }
  setSpawnMarker(_pos: { x: number; y: number } | null) { /* Handled by EditorRenderer */ }
  setAssetPreview(preview: { dataUrl: string; width?: number | undefined; height?: number | undefined; rotation?: number | undefined; packUuid?: string | undefined; itemId?: string | undefined } | null) {
    if (this.editorIntegration) {
      this.editorIntegration.getRenderer().renderGhost(preview);
    } else {
      // Fallback auf alte Implementierung
      setAssetPreview(this, preview);
    }
  }
  public getEditorRenderer() { return this.editorIntegration?.getRenderer() ?? null; }
  async applyTerrainPaint(edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string; attempt?: number }) { void edit; }
  eraseTerrainRect(rect: { startX: number; startY: number; endX: number; endY: number }) { this.tileManager.eraseTerrainRect(rect); }
  paintTerrainRect(layer: string, rect: { x0: number; y0: number; x1: number; y1: number }, tileRefId: number) {
    this.tileManager?.paintTerrainRect(layer, rect, tileRefId);
  }
  applyWallPaint(edit: { rect: { startX: number; startY: number; endX: number; endY: number }; wallTypeId: number }) {
    if (!this.autotileGrid || !this.autotileRenderer) return;
    const { rect, wallTypeId } = edit;
    const x0 = Math.min(rect.startX, rect.endX);
    const y0 = Math.min(rect.startY, rect.endY);
    const x1 = Math.max(rect.startX, rect.endX);
    const y1 = Math.max(rect.startY, rect.endY);
    const affected: Array<{ x: number; y: number }> = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (wallTypeId > 0) {
          this.autotileGrid.set(tx, ty, wallTypeId);
        } else {
          this.autotileGrid.remove(tx, ty);
        }
        affected.push({ x: tx, y: ty });
        // Also include neighbors for bitmask recalculation
        affected.push({ x: tx, y: ty - 1 });
        affected.push({ x: tx + 1, y: ty });
        affected.push({ x: tx, y: ty + 1 });
        affected.push({ x: tx - 1, y: ty });
      }
    }
    this.autotileRenderer.updateArea(affected);
  }
  setSelectionRect(_rect: { x: number; y: number; w: number; h: number } | null) {
    // Handled by EditorRenderer via EditorIntegration
  }
  applyTilePaint(edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) {
    this.tileManager.applyTilePaint(edit, this.collisionVisible, () => {
      this.collisionManager.ensureCollisionCollider();
      this.collisionManager.rebuildStaticColliders();
      if (this.collisionVisible) updateCollisionOverlay(this as any);
    });
  }
  saveEditorLayersHard() { }
  reloadEditorLayers() { }
  async fetchAndApplyServerLayers() { await fetchAndApplyServerLayers(this as any); }
  registerTileset(ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }) { registerTileset(this as any, ts); }
  setCollisionVisible(visible: boolean) { setCollisionVisible(this as any, visible); }
  setBubbleMembers(members: Set<string>) { uiSetBubbleMembers(this as any, members); }
  setHeroName(name: string) { this.nameLabelManager.setHeroName(name); }
  updateSpeakingStates(speakingIds: Set<string>) { this.nameLabelManager.updateSpeakingStates(speakingIds); }
  changeHeroAvatar(avatarId: string) {
    const textureKey = avatarRegistry.getTextureKey(avatarId);
    if (this.textures.exists(textureKey)) {
      this.playerManager.changeAvatar(avatarId);
    } else {
      avatarRegistry.preloadAvatar(this, avatarId);
      this.load.once('complete', () => {
        this.playerManager.changeAvatar(avatarId);
      });
      this.load.start();
    }
  }
  handleObjectsUpdated(data: ObjectsUpdatedPayload) { this.objectManager.handleObjectsUpdated(data); }
  setBackgroundColor(hex: string) { try { this.cameras.main.setBackgroundColor(hex); } catch { } }
  private async loadVisibleChunks(layerName: ChunkLayerName) { await loadVisibleChunks(this as any, layerName); }
  public applyChunkUpdates(layerName: ChunkLayerName, updates: Array<{ key: string; version: number; encoding: string; data: string }>) { applyChunkUpdates(this as any, layerName, updates); }

  override update(time: number, delta: number) {
    super.update(time, delta);
    try { this.systems.forEach((s) => s.update(time, delta)); } catch { }
    if (this.v2) {
      const vw = this.cameras.main.worldView;
      const camSig = `${Math.floor(vw.x)}:${Math.floor(vw.y)}:${Math.floor(vw.width)}:${Math.floor(vw.height)}:${this.cameras.main.zoom.toFixed(2)}`;
      if (camSig !== this._lastCamSig) {
        this._lastCamSig = camSig;
        this.loadVisibleChunks('ground');
        this.loadVisibleChunks('walls');
        this.loadVisibleChunks('collision');
        this.loadVisibleChunks('walls_auto');
        this.objectManager.loadVisibleChunks(this.cameras.main);
      }
    }
  }

  forceReloadMap() {
    if (this.v2) {
      this.loadedChunks.clear();
      this._lastCamSig = null;
      try { logger.debug('[MainScene] Forced full map reload (chunks cleared)'); } catch { }
      this.loadVisibleChunks('ground');
      this.loadVisibleChunks('walls');
      this.loadVisibleChunks('collision');
      this.loadVisibleChunks('walls_auto');
      this.fetchAndApplyServerLayers().catch(() => { });
    } else {
      this.fetchAndApplyServerLayers().catch(() => { });
    }
  }

  rebuildStaticColliders() { this.collisionManager.rebuildStaticColliders(); }
  ensureCollisionCollider() { this.collisionManager.ensureCollisionCollider(); }
  ensureEditorLayers() { this.tileManager.ensureEditorLayers(); }
  updateCollisionOverlay() { updateCollisionOverlay(this as any); }

  async waitForTilesetsReady(keys: string[], timeoutMs: number = 1500): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (keys.every(key => this.textures.exists(key))) return;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  public updateTilesetRegistry(registry: any[]) { this.tileManager.updateTilesetRegistry(registry); }

  registerAutotileDefinitions(items: Array<{
    wallTypeId: number;
    key: string;
    textureUrl: string;
    tileWidth: number;
    tileHeight: number;
    variants: Record<string, { col: number; row: number }>;
    packUuid: string;
  }>): void {
    for (const item of items) {
      const textureKey = `autotile_${item.packUuid}_${item.key}`;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!this.textures.exists(textureKey)) {
          this.textures.addSpriteSheet(textureKey, img, {
            frameWidth: item.tileWidth,
            frameHeight: item.tileHeight,
          });
        }
        this.autotileRenderer?.registerDefinition(item.wallTypeId, {
          key: item.key,
          tileWidth: item.tileWidth,
          tileHeight: item.tileHeight,
          gridHeight: 4,
          variants: item.variants,
          textureKey,
        });
        // Re-render all visible autotiles with the new definition
        this.autotileRenderer?.updateAllVisible();
      };
      img.src = item.textureUrl;
    }
  }
}
