import Phaser from 'phaser';
import { GameSystem } from '../systems/types';
import { gameBridge } from '../bridge';
// editorLog removed - using console methods instead
import { V2State, computeFirstGids, decodeRLE, fetchChunks, tileRefIdToGid } from '../../lib/mapV2';
import { createNameLabel as uiCreateNameLabel, drawNameLabel as uiDrawNameLabel, updateNameLabel as uiUpdateNameLabel, setHeroName as uiSetHeroName, updateSpeakingStates as uiUpdateSpeakingStates } from '../ui/nameLabels';
import { setBubbleMembers as uiSetBubbleMembers, updateBubbleOutline as uiUpdateBubbleOutline } from '../ui/bubbles';
import { ensureRecenterUi as camEnsureRecenterUi, updateRecenterUiVisibility as camUpdateRecenterUiVisibility, recenterCamera as camRecenterCamera } from '../camera/recenterUi';
import { setCollisionVisible as colSetVisible, updateCollisionOverlay as colUpdateOverlay } from '../collision/overlay';
import { ensureCollisionCollider as colEnsureCollider, rebuildStaticColliders as colRebuildStatic } from '../collision/collider';
// Old editor imports removed - now using EditorRenderer and EditorService
// import { setEditorAssets as edSetAssets, setAssetPreview as edSetPreview } from '../editor/assets';
// import { applyTerrainPaint as edApplyTerrainPaint, eraseTerrainRect as edEraseTerrainRect, applyTilePaint as edApplyTilePaint, ensureTerrainTilesetFor as edEnsureTerrainTilesetFor } from '../editor/painting';
// Editor layers import removed - deprecated file deleted
// import { saveEditorLayers as mapSaveLayers, saveEditorLayersHard as mapSaveLayersHard, loadEditorLayers as mapLoadLayers, reloadEditorLayers as mapReloadLayers } from '../map/editorLayers';
// Temporäre Editor-Funktionen bis EditorRenderer vollständig integriert ist
import { setEditorAssets as edSetAssets, setAssetPreview as edSetAssetPreview } from '../editor/assets-temp';
import { fetchAndApplyServerLayers as mapFetchAndApply } from '../map/serverSync';
import { loadVisibleChunks as mapLoadVisibleChunks, applyChunkUpdates as mapApplyChunkUpdates } from '../map/chunks';
import { registerTileset as mapRegisterTileset } from '../map/tilesets';
import { EditorService } from '../../services/EditorService';

export class MainScene extends Phaser.Scene {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private desiredPos: { x: number; y: number } | null = null;
  private zoneG?: Phaser.GameObjects.Graphics;
  private zonesVisible: boolean = true;
  private spawnG?: Phaser.GameObjects.Graphics;
  private editorSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private pendingTextures: Set<string> = new Set();
  private selectionG?: Phaser.GameObjects.Graphics;
  private mapRef?: Phaser.Tilemaps.Tilemap;
  private editorGround?: Phaser.Tilemaps.TilemapLayer;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  private staticColliders?: Phaser.Physics.Arcade.StaticGroup;
  private dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
  private collisionOverlay?: Phaser.GameObjects.Graphics;
  private backgroundGraphics?: Phaser.GameObjects.Graphics;
  private borderGraphics?: Phaser.GameObjects.Graphics;
  private gridGraphics?: Phaser.GameObjects.Graphics;
  private collisionVisible = false;
  private hoveredSprite: Phaser.GameObjects.Sprite | null = null;
  private hoverOutline?: Phaser.GameObjects.Graphics;
  private bubbleOutlines: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private nameLabels: Map<string, Phaser.GameObjects.Container> = new Map();
  private heroNameLabel?: Phaser.GameObjects.Container;
  private movementLocked = false;
  private pendingTilesetRegistrations?: any[];
  private doNotDisturb = false;
  // Camera & interaction additions
  private manualCameraActive = false;
  private recenterUi?: Phaser.GameObjects.Container;
  private panState: { isPanning: boolean; lastX: number; lastY: number } = { isPanning: false, lastX: 0, lastY: 0 };
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private leftDragCandidate: { active: boolean; startX: number; startY: number } | null = null;
  private editorMode = false;
  private spaceHeld = false;
  private editorPanKeys?: { up?: Phaser.Input.Keyboard.Key; down?: Phaser.Input.Keyboard.Key; left?: Phaser.Input.Keyboard.Key; right?: Phaser.Input.Keyboard.Key };
  // Zweite Kamera nur für Labels/UI (kein Zoom)
  private labelCamera?: Phaser.Cameras.Scene2D.Camera;
  private labelLayer?: Phaser.GameObjects.Layer;
  private ghostSprite?: Phaser.GameObjects.Image;
  private ghostTextureKey?: string;
  private terrainTilesetSources: Map<string, string> = new Map();
  private editorCurrentTool: 'terrain' | 'collision' | 'erase' | 'select' = 'select';
  // v2
  private v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  private loadedChunks: Set<string> = new Set();
  private heroVsTilesCollider?: Phaser.Physics.Arcade.Collider;
  private currentMapName: string = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
  // Debounced Editor-Layer Autosave
  private editorSaveTimer: number | null = null as any;
  private systems: GameSystem[] = [];

  private ensureEditorLayers() {
    if (!this.mapRef) return;
    // Wähle irgendein verfügbares Tileset
    const anyTileset = (() => {
      const dyn = Array.from(this.dynamicTilesets.values());
      if (dyn.length > 0) return dyn[0];
      if (this.mapRef!.tilesets && this.mapRef!.tilesets.length > 0) return this.mapRef!.tilesets[0];
      return null;
    })();
    if (!anyTileset) return;
    try {
      if (!this.editorGround) {
        const l = this.mapRef.createBlankLayer('EditorGround', anyTileset, 0, 0, this.mapRef.width, this.mapRef.height, this.mapRef.tileWidth, this.mapRef.tileHeight);
        this.editorGround = l as any;
        try { this.editorGround?.setDepth(1); } catch { }
      }
    } catch { }
    try {
      if (!this.wallsLayer) {
        const l = this.mapRef.createBlankLayer('EditorWalls', anyTileset, 0, 0, this.mapRef.width, this.mapRef.height, this.mapRef.tileWidth, this.mapRef.tileHeight);
        this.wallsLayer = l as any;
        try { this.wallsLayer?.setDepth(2); } catch { }
      }
    } catch { }
    try {
      if (!this.collisionLayer) {
        const l = this.mapRef.createBlankLayer('Collision', anyTileset, 0, 0, this.mapRef.width, this.mapRef.height, this.mapRef.tileWidth, this.mapRef.tileHeight);
        this.collisionLayer = l as any;
        try { this.collisionLayer?.setVisible(false); } catch { }
      }
    } catch { }
  }

  private async waitForTilesetsReady(requiredKeys: string[], timeoutMs: number = 1500): Promise<void> {
    const start = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        try {
          const allReady = requiredKeys.every((k) => {
            if (!k) return true;
            const inDyn = this.dynamicTilesets.has(k);
            const inMap = !!this.mapRef?.tilesets?.find(t => t.name === k);
            return inDyn || inMap;
          });
          if (allReady || Date.now() - start > timeoutMs) {
            resolve();
            return;
          }
        } catch { }
        setTimeout(check, 50);
      };
      check();
    });
  }

  constructor() {
    super('Main');
  }

  private autoFollowIfHeroOutOfView() {
    try {
      const cam = this.cameras.main;
      if (!cam || !this.hero) return;
      // Wenn Kamera bereits folgt und nicht manuell, nichts tun
      const isFollowing = (cam as any).follow === this.hero;
      if (!this.manualCameraActive && isFollowing) return;

      const view = cam.worldView;
      const margin = 8; // kleiner Puffer in Weltpixeln
      const outLeft = this.hero.x < view.x - margin;
      const outRight = this.hero.x > view.right + margin;
      const outTop = this.hero.y < view.y - margin;
      const outBottom = this.hero.y > view.bottom + margin;
      const isOutside = outLeft || outRight || outTop || outBottom;

      // Nur automatisch reaktivieren, wenn wir nicht im Editor sind und gerade nicht pannen/zoomen
      if (isOutside && !this.editorMode && !this.panState.isPanning) {
        try { cam.startFollow(this.hero, true, 0.1, 0.1); } catch { }
        this.manualCameraActive = false;
        this.updateRecenterUiVisibility();
      }
    } catch { }
  }

  create() {
    const pre = (window as any).__v2_state as V2State | undefined;
    if (pre && pre.mapMeta.width && pre.mapMeta.height && pre.mapMeta.tileWidth && pre.mapMeta.tileHeight) {
      // v2: blank tilemap
      const map = this.make.tilemap({ width: pre.mapMeta.width, height: pre.mapMeta.height, tileWidth: pre.mapMeta.tileWidth, tileHeight: pre.mapMeta.tileHeight });
      this.mapRef = map;
      // Register tilesets from registry
      for (const ts of pre.tilesetRegistry) {
        try {
          const phTs = map.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
          if (phTs) this.dynamicTilesets.set(ts.key, phTs);
        } catch { }
      }
      // Layers
      const allTs = Array.from(this.dynamicTilesets.values());
      this.editorGround = map.createBlankLayer('Ground', allTs[0] || undefined as any, 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
      this.wallsLayer = map.createBlankLayer('Walls', allTs[0] || undefined as any, 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
      this.collisionLayer = map.createBlankLayer('Collision', allTs[0] || undefined as any, 0, 0, pre.mapMeta.width, pre.mapMeta.height, pre.mapMeta.tileWidth, pre.mapMeta.tileHeight) as any;
      this.editorGround?.setDepth(0);
      this.wallsLayer?.setDepth(5);
      this.collisionLayer?.setDepth(10);
      // Kollision-Layer ist standardmäßig unsichtbar (nur Collider), Overlay nur im Editor
      try { this.collisionLayer?.setVisible(false); } catch { }
      // Any non -1 index will collide
      try { this.collisionLayer?.setCollisionByExclusion([-1], true); } catch { }
      // Compute firstgids for tileRefId->gid
      const firstGids = computeFirstGids(pre.tilesetRegistry, this);
      this.v2 = { state: pre, firstGids, chunkSize: pre.mapMeta.chunkSize };
      // initial chunks load
      this.loadVisibleChunks('ground');
      this.loadVisibleChunks('walls');
      this.loadVisibleChunks('collision');
    } else {
      throw new Error('Missing V2 state in MainScene');
    }

    // Binde Tilesets
    const map = this.mapRef!;
    const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
    const furniture = map.addTilesetImage('furniture_tiles', 'furniture_tiles', 16, 16, 0, 0);
    const decor = map.addTilesetImage('decor_tiles', 'decor_tiles', 16, 16, 0, 0);
    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);

    // Initialize Backgrounds
    this.updateBackgrounds();
    // Initial grid update
    this.updateGrid();
    EditorService.subscribe(() => {
      this.updateBackgrounds();
      this.updateGrid();
      this.updateCursor();
      this.setSpawnMarker(EditorService.getState().spawn || null);
    });

    if (!office) {
      // Tileset office_tiles not found
    }

    // Tile-Layer erstellen (verwende verfügbare Tilesets)
    // Ensure unique tileset names to avoid Phaser confusion when same file uploaded multiple times
    const uniq = new Map<string, Phaser.Tilemaps.Tileset>();
    [office, furniture, decor, collision].filter(Boolean).forEach(ts => {
      if (!uniq.has((ts as any).name)) uniq.set((ts as any).name, ts!);
    });
    const available = Array.from(uniq.values());
    // Beim Erzeugen von Layern können fehlende Tileset-Namen zu Phaser-Warnungen führen.
    // Im v2-Pfad wurden Blank-Layer bereits erstellt; nutze diese statt neue zu erzeugen.
    const ground = this.editorGround;
    const walls = this.wallsLayer;

    ground?.setDepth(0);
    walls?.setDepth(5);

    // Collision-Layer einlesen und statische Physik-Körper erzeugen
    let collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined = this.collisionLayer;
    try {
      if (collisionLayer) {
        try { (collisionLayer as any).setTilesets(available); } catch { }
      }

      // Fix: Check if collision layer has wrong data dimensions
      const layerData = (collisionLayer as any)?.layer;
      if (layerData && layerData.data) {
        const expectedRows = map.height;
        const actualRows = layerData.data.length;

        if (actualRows < expectedRows) {
          console.log(`[MainScene] Collision layer has wrong dimensions: ${actualRows} rows instead of ${expectedRows}, fixing...`);

          // Extend the data array to have the correct number of rows
          while (layerData.data.length < expectedRows) {
            // Create a new row filled with empty tiles
            const newRow = new Array(map.width);
            for (let x = 0; x < map.width; x++) {
              // Create empty tile
              newRow[x] = new Phaser.Tilemaps.Tile(
                layerData,
                -1, // index -1 means empty
                x,
                layerData.data.length,
                map.tileWidth,
                map.tileHeight,
                map.tileWidth,
                map.tileHeight
              );
            }
            layerData.data.push(newRow);
          }

          // Update layer dimensions
          layerData.height = expectedRows;

          console.log(`[MainScene] Fixed collision layer dimensions to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);

          // Verify the fix worked
          const testY = 30; // Test a row that should exist now
          if (layerData.data[testY]) {
            console.log(`[MainScene] Verification: Row ${testY} exists with ${layerData.data[testY].length} tiles`);
          } else {
            console.error(`[MainScene] Verification failed: Row ${testY} still doesn't exist!`);
          }
        }
      }
    } catch (e) {
      console.log('[MainScene] Collision layer setup failed');
      // Create blank collision layer if it doesn't exist
      if (available.length > 0) {
        // Use the first available tileset for blank layer creation
        const firstTs = available[0]!;
        collisionLayer = map.createBlankLayer('Collision', firstTs, 0, 0, map.width, map.height, map.tileWidth, map.tileHeight) as any;
        console.log(`[MainScene] Created blank collision layer: ${map.width}x${map.height}`);
      }
    }
    if (collisionLayer) {
      this.collisionLayer = collisionLayer;
    } else {
      // With exactOptionalPropertyTypes, assign by deleting the property instead of setting undefined
      delete (this as any).collisionLayer;
    }

    // Debug: Check collision layer dimensions
    if (collisionLayer) {
      console.log('[MainScene] Collision layer created');
    }

    if (collisionLayer) {
      collisionLayer.setDepth(10);
      collisionLayer.setVisible(false); // Hide the actual collision layer - we use overlay for visualization
    } else {
      console.log('[MainScene] No collision layer created');
    }

    // Register collision tileset in dynamicTilesets
    if (collision) {
      this.dynamicTilesets.set('collision_tiles', collision);

      // IMPORTANT: Set all tilesets to collision layer immediately
      if (this.collisionLayer) {
        const allTilesets = [office, furniture, decor, collision].filter(Boolean) as Phaser.Tilemaps.Tileset[];
        (this.collisionLayer as any).setTilesets(allTilesets);
      }
    }

    // Editor-Layer (zusätzlicher Boden, den wir bemalen können)
    let editorGround: Phaser.Tilemaps.TilemapLayer | undefined;
    // Im v2-Pfad wurden Blank-Layer bereits erstellt; nutze diese
    editorGround = this.editorGround;

    if (!editorGround) {
      // Wenn Layer nicht existiert, erzeugen wir einen Dummy-Layer (leere Kacheln), indem wir eine neue Schicht hinzufügen
      try {
        // Phaser API lässt das direkte Erzeugen leerer Layer außerhalb Tiled begrenzt zu; wir nutzen Workaround: ein weiterer Layer mit gleichen Tilesets
        const tmp = map.createBlankLayer('EditorGround', available[0], 0, 0, map.width, map.height, map.tileWidth, map.tileHeight);
        this.editorGround = tmp as any;
      } catch {
        // Fallback ignorieren
      }
    } else {
      editorGround.setDepth(1);
    }

    // Editor-Walls Layer (zusätzliche Wände, die wir bemalen können)
    let editorWalls: Phaser.Tilemaps.TilemapLayer | undefined;
    editorWalls = this.wallsLayer;

    if (!editorWalls) {
      try {
        const tmp = map.createBlankLayer('EditorWalls', available[0], 0, 0, map.width, map.height, map.tileWidth, map.tileHeight);
        this.wallsLayer = tmp as any;
      } catch {
        // Fallback ignorieren
      }
    } else {
      editorWalls.setDepth(6); // Higher than regular walls
    }

    // Ensure walls layer can use all tilesets
    if (this.wallsLayer && available.length > 0) {
      (this.wallsLayer as any).tileset = available;
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);
    // Ensure camera respects world size and starts centered nicely
    cam.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

    // Label-Layer und zweite Kamera einrichten
    this.labelLayer = this.add.layer();
    this.labelLayer.setDepth(10000);
    // Hauptkamera ignoriert Label-Layer (damit er nicht zoomt/scrollt)
    cam.ignore(this.labelLayer);
    // Zweite Kamera, die nur den Label-Layer rendert, ohne Zoom
    const labelCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    labelCam.setZoom(1);
    labelCam.setScroll(0, 0);
    labelCam.setRoundPixels(true);
    this.labelCamera = labelCam;
    // Diese Kamera soll nur den Label-Layer sehen: alles andere ignorieren
    const refreshLabelCamIgnore = () => {
      if (!this.labelCamera || !this.labelLayer) return;
      const labelMembers = new Set(this.labelLayer.list as Phaser.GameObjects.GameObject[]);
      labelMembers.add(this.labelLayer as unknown as Phaser.GameObjects.GameObject);
      const toIgnore = this.children.list.filter(o => !labelMembers.has(o as Phaser.GameObjects.GameObject));
      this.labelCamera.ignore(toIgnore as any);
    };
    // initial und fortlaufend (für dynamisch erstellte Objekte)
    refreshLabelCamIgnore();
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, refreshLabelCamIgnore);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // Get initial position from global window object (set by App.tsx after DB load)
    const initialPos = (window as any).initialPlayerPosition || { x: 80, y: 120 };
    this.hero = this.physics.add.sprite(initialPos.x, initialPos.y, 'hero_walk_down', 0);
    // Ensure arcade body configured for reliable collisions
    try {
      this.hero.setCollideWorldBounds(true);
      this.hero.body.setSize(map.tileWidth * 0.8, map.tileHeight * 0.9);
      (this.hero.body as Phaser.Physics.Arcade.Body).offset.set(map.tileWidth * 0.1, map.tileHeight * 0.1);
    } catch { }
    this.hero.setDepth(10);
    // Vermeide Doppel-Kollision: kein zusätzlicher Collider gegen statische Bodies
    // Ensure tilemap collision collider
    this.ensureCollisionCollider();

    // Create name label for hero (will be set later when we get the actual name)
    this.heroNameLabel = this.createNameLabel('Loading...', 'local');
    this.updateNameLabel(this.heroNameLabel, this.hero.x, this.hero.y);

    this.anims.create({ key: 'walk_down', frames: this.anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_up', frames: this.anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_left', frames: this.anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_right', frames: this.anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });

    const cursors = this.input.keyboard!.createCursorKeys();
    // WASD for editor camera pan
    try {
      this.editorPanKeys = this.input.keyboard!.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        right: Phaser.Input.Keyboard.KeyCodes.D,
      }) as any;
    } catch { }
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
    this.manualCameraActive = false;
    this.ensureRecenterUi();
    this.updateRecenterUiVisibility();


    // Allow typing into HTML inputs (do not capture SPACE in Phaser when an input is focused)
    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase?.();
      if (tag === 'input' || tag === 'textarea') return true;
      if ((el as any).isContentEditable) return true;
      return false;
    };
    const keyBlocker = (ev: KeyboardEvent) => {
      // Track SPACE state regardless of focus, so space+drag pan works while typing
      if (ev.code === 'Space') {
        this.spaceHeld = ev.type === 'keydown';
        this.updateCursor();
      }
      if (isEditableTarget(ev.target)) {
        // Stop bubbling to Phaser keyboard plugin, but keep default browser behavior
        ev.stopPropagation();
      }
    };
    window.addEventListener('keydown', keyBlocker, true);
    window.addEventListener('keyup', keyBlocker, true);
    window.addEventListener('blur', () => { this.spaceHeld = false; this.updateCursor(); }, true);

    // Zoom via mouse wheel (trackpad supported)
    this.input.on('wheel', (pointer: any, _over: any, _dx: number, dy: number) => {
      const camera = this.cameras.main;
      // Zoom factor per wheel step
      const zoomDelta = -dy * 0.002;
      const prevZoom = camera.zoom;
      let nextZoom = Phaser.Math.Clamp(prevZoom + zoomDelta, 1, 5);
      if (Math.abs(nextZoom - prevZoom) < 1e-3) return;

      // Zoom always centers on character (or snaps back to it)
      camera.setZoom(nextZoom);

      // Force follow hero immediately
      if (this.hero) {
        camera.startFollow(this.hero, true, 0.1, 0.1);
        this.manualCameraActive = false;
        this.updateRecenterUiVisibility();
      }
    });

    // Drag-pan with middle mouse, or Space + left drag
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      const isLeft = p.leftButtonDown();
      const isMiddle = p.middleButtonDown();
      const spaceDown = this.spaceHeld; // rely only on tracked state
      const allowPan = isMiddle || (spaceDown && isLeft);
      if (allowPan) {
        // Mark left drag candidate to avoid triggering movement click later
        if (isLeft) {
          this.leftDragCandidate = { active: true, startX: p.x, startY: p.y };
        }
        this.panState.isPanning = true;
        this.panState.lastX = p.x;
        this.panState.lastY = p.y;
        this.cameras.main.stopFollow();
        this.manualCameraActive = true;
        this.updateRecenterUiVisibility();
        try { (p.event as any)?.preventDefault?.(); } catch { }
        try { (p.event as any)?.stopPropagation?.(); } catch { }
        this.updateCursor();
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!this.panState.isPanning) return;
      const camera = this.cameras.main;
      const dx = p.x - this.panState.lastX;
      const dy = p.y - this.panState.lastY;
      this.panState.lastX = p.x;
      this.panState.lastY = p.y;
      camera.scrollX -= dx / camera.zoom;
      camera.scrollY -= dy / camera.zoom;
      // If we moved enough, keep left drag marked
      if (this.leftDragCandidate && this.leftDragCandidate.active) {
        const mdx = Math.abs(p.x - this.leftDragCandidate.startX);
        const mdy = Math.abs(p.y - this.leftDragCandidate.startY);
        if (mdx + mdy > 3) {
          // Prevent click actions later
          try { (p.event as any)?.preventDefault?.(); } catch { }
          try { (p.event as any)?.stopPropagation?.(); } catch { }
        }
      }
    });
    const stopPan = (p?: Phaser.Input.Pointer) => {
      this.panState.isPanning = false;
      // If we had a left-drag candidate, cancel map click if movement happened
      if (this.leftDragCandidate && this.leftDragCandidate.active && p) {
        const mdx = Math.abs(p.x - this.leftDragCandidate.startX);
        const mdy = Math.abs(p.y - this.leftDragCandidate.startY);
        if (mdx + mdy > 3) {
          try { (p.event as any)?.preventDefault?.(); } catch { }
          try { (p.event as any)?.stopPropagation?.(); } catch { }
        }
      }
      this.leftDragCandidate = null;
      this.updateCursor();
    };
    this.input.on(Phaser.Input.Events.POINTER_UP, stopPan);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, stopPan as any);

    // On resize, keep camera bounds correct
    this.scale.on('resize', () => {
      const c = this.cameras.main;
      c.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      this.updateRecenterUiVisibility();
      // Label-Kamera an neue Größe anpassen
      if (this.labelCamera) {
        this.labelCamera.setSize(this.scale.width, this.scale.height);
      }
    });

    // Track current direction
    let currentDirection: 'up' | 'down' | 'left' | 'right' = 'down';
    // Defensive cleanup: if any remote for self was created before localSessionId was known, remove it now
    try {
      const selfId = (typeof window !== 'undefined' ? (window as any).__localSessionId : undefined);
      if (selfId && this.remotes.has(selfId)) {
        this.remotes.get(selfId)?.destroy();
        this.remotes.delete(selfId);
        const lbl = this.nameLabels.get(selfId);
        if (lbl) { lbl.destroy(); this.nameLabels.delete(selfId); }
      }
    } catch { }

    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      const speed = 80;
      const body = this.hero.body;
      body.setVelocity(0);
      // Programmgesteuerte Zielbewegung hat Vorrang und ist auch bei movementLocked erlaubt
      if (this.desiredPos) {
        const dx = this.desiredPos.x - this.hero.x;
        const dy = this.desiredPos.y - this.hero.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 2) {
          this.desiredPos = null;
          this.hero.anims.stop();
        } else {
          const nx = dx / Math.max(Math.hypot(dx, dy), 1e-6);
          const ny = dy / Math.max(Math.hypot(dx, dy), 1e-6);
          body.setVelocity(nx * speed, ny * speed);
          if (Math.abs(nx) > Math.abs(ny)) {
            currentDirection = nx > 0 ? 'right' : 'left';
            this.hero.play(nx > 0 ? 'walk_right' : 'walk_left', true);
          } else {
            currentDirection = ny > 0 ? 'down' : 'up';
            this.hero.play(ny > 0 ? 'walk_down' : 'walk_up', true);
          }
        }
      } else if (!this.movementLocked) {
        if (cursors.left?.isDown) {
          body.setVelocityX(-speed);
          this.hero.play('walk_left', true);
          currentDirection = 'left';
        }
        else if (cursors.right?.isDown) {
          body.setVelocityX(speed);
          this.hero.play('walk_right', true);
          currentDirection = 'right';
        }
        else if (cursors.up?.isDown) {
          body.setVelocityY(-speed);
          this.hero.play('walk_up', true);
          currentDirection = 'up';
        }
        else if (cursors.down?.isDown) {
          body.setVelocityY(speed);
          this.hero.play('walk_down', true);
          currentDirection = 'down';
        }
        else {
          this.hero.anims.stop();
          const base: any = { up: 'hero_walk_up', down: 'hero_walk_down', left: 'hero_walk_left', right: 'hero_walk_right' };
          this.hero.setTexture(base[currentDirection] || 'hero_walk_down', 0);
        }
      } else {
        // Locked und keine Zielbewegung: stoppen
        body.setVelocity(0, 0);
        this.hero.anims.stop();
        const base: any = { up: 'hero_walk_up', down: 'hero_walk_down', left: 'hero_walk_left', right: 'hero_walk_right' };
        this.hero.setTexture(base[currentDirection] || 'hero_walk_down', 0);
      }

      gameBridge.onLocalMove({ x: this.hero.x, y: this.hero.y, direction: currentDirection });

      // Update hero name label position
      if (this.heroNameLabel) {
        this.updateNameLabel(this.heroNameLabel, this.hero.x, this.hero.y);
      }
      // Update recenter visibility depending on camera vs hero position
      this.updateRecenterUiVisibility();
      // Auto-follow wieder aktivieren, wenn der Held den sichtbaren Bereich verlässt
      this.autoFollowIfHeroOutOfView();

      // Editor: Keyboard Camera Pan (WASD + Pfeile)
      try {
        if (this.editorMode && !this.panState.isPanning) {
          const cam = this.cameras.main;
          const dt = Math.max(this.game.loop.delta, 16) / 1000; // seconds
          const base = 600; // px/s
          const step = (base * dt) / Math.max(cam.zoom, 0.001);
          const anyCursors: any = cursors;
          const keys = this.editorPanKeys || {} as any;
          if (anyCursors.left?.isDown || keys.left?.isDown) cam.scrollX -= step;
          if (anyCursors.right?.isDown || keys.right?.isDown) cam.scrollX += step;
          if (anyCursors.up?.isDown || keys.up?.isDown) cam.scrollY -= step;
          if (anyCursors.down?.isDown || keys.down?.isDown) cam.scrollY += step;
          if (anyCursors.left?.isDown || anyCursors.right?.isDown || anyCursors.up?.isDown || anyCursors.down?.isDown || keys.left?.isDown || keys.right?.isDown || keys.up?.isDown || keys.down?.isDown) {
            try { cam.stopFollow(); } catch { }
            this.manualCameraActive = true;
            this.updateRecenterUiVisibility();
          }
        }
      } catch { }
    });

    // Tile-basierte Eingabe für Editor
    const toTile = (p: Phaser.Input.Pointer) => {
      const wp = p.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      if (!this.mapRef) return { tileX: 0, tileY: 0 };
      const tileX = Math.floor(wp.x / this.mapRef.tileWidth);
      const tileY = Math.floor(wp.y / this.mapRef.tileHeight);
      return { tileX, tileY };
    };
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
      // If we are about to pan (middle OR space+left), skip movement logic
      const isPanStart = (pointer.middleButtonDown() || ((this.spaceHeld || !!this.spaceKey?.isDown) && pointer.leftButtonDown()));

      if (pointer.rightButtonDown()) {
        // Prevent browser context menu
        try { (pointer.event as any)?.preventDefault?.(); } catch { }
        // Handle right click on remote sprites
        for (const [id, sprite] of this.remotes) {
          const bounds = sprite.getBounds();
          if (bounds.contains(worldPoint.x, worldPoint.y)) {
            const evt = (pointer.event as any) as MouseEvent | undefined;
            const sx = evt?.clientX ?? pointer.x;
            const sy = evt?.clientY ?? pointer.y;
            gameBridge.onRightClick({ x: sx, y: sy, playerId: id });
            break;
          }
        }
        return;
      }

      // If asset preview is active, suppress non-asset editor interactions
      const assetPreviewActive = !!(this as any).ghostSprite;
      // Editor-Interaktionen nur im Editor-Modus (sonst keine Auswahlrechtecke)
      if (!isPanStart && this.editorMode) {
        if (!assetPreviewActive) {
          gameBridge.onPointerDown({ x: worldPoint.x, y: worldPoint.y });
        }
        const { tileX, tileY } = toTile(pointer);
        try { window.dispatchEvent(new CustomEvent('editor:tileDown', { detail: { tileX, tileY } })); } catch { }
        gameBridge.onPointerDownTile({ tileX, tileY });
        // Szene-eigene Drag-Auswahl starten (Terrain/Collision und Erase im Terrain-Tab)
        try {
          const editorState = EditorService.getState();
          const editorTool = editorState.tool;
          const isTerrainCollisionTool = editorTool === 'terrain' || editorTool === 'collision';
          const isEraseForTerrain = editorTool === 'erase' && editorState.category === 'terrain';
          const isEraseForCollision = editorTool === 'erase' && editorState.category === 'collisions';
          if (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision) {
            (this as any)._dragStartTile = { x: tileX, y: tileY };
            if (this.mapRef) {
              const x = tileX * this.mapRef.tileWidth;
              const y = tileY * this.mapRef.tileHeight;
              this.setSelectionRect({ x, y, w: this.mapRef.tileWidth, h: this.mapRef.tileHeight });
            }
          }
        } catch { }
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      try { if (this.editorMode && !this.panState.isPanning) window.dispatchEvent(new CustomEvent('editor:tileMove', { detail: { tileX, tileY } })); } catch { }
      if (this.editorMode && !this.panState.isPanning) gameBridge.onPointerMoveTile({ tileX, tileY });
      // Move ghost preview sprite with cursor (snap to tile center)
      if (this.ghostSprite && this.mapRef) {
        const x = tileX * this.mapRef.tileWidth + this.mapRef.tileWidth / 2;
        const y = tileY * this.mapRef.tileHeight + this.mapRef.tileHeight / 2;
        // Set only when actually changed to avoid overdraw/flicker
        if (Math.abs(this.ghostSprite.x - x) > 0.01 || Math.abs(this.ghostSprite.y - y) > 0.01) {
          this.ghostSprite.setPosition(x, y);
        }
      }
      // Szene-eigene Drag-Auswahl zeichnen (Terrain/Collision und Erase im Terrain-Tab)
      // Zone/Asset-Drag wird von gameBridge-Handlern verwaltet
      try {
        const ds = (this as any)._dragStartTile as { x: number; y: number } | undefined;
        const editorState = EditorService.getState();
        const editorTool = editorState.tool;
        const isTerrainCollisionTool = editorTool === 'terrain' || editorTool === 'collision';
        const isEraseForTerrain = editorTool === 'erase' && editorState.category === 'terrain';
        const isEraseForCollision = editorTool === 'erase' && editorState.category === 'collisions';
        if (this.editorMode && ds && pointer.leftButtonDown() && !this.panState.isPanning && this.mapRef && (isTerrainCollisionTool || isEraseForTerrain || isEraseForCollision)) {
          const sx = Math.min(ds.x, tileX) * this.mapRef.tileWidth;
          const sy = Math.min(ds.y, tileY) * this.mapRef.tileHeight;
          const ex = Math.max(ds.x, tileX) * this.mapRef.tileWidth + this.mapRef.tileWidth;
          const ey = Math.max(ds.y, tileY) * this.mapRef.tileHeight + this.mapRef.tileHeight;
          this.setSelectionRect({ x: sx, y: sy, w: ex - sx, h: ey - sy });
        }
      } catch { }
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      if (this.editorMode && !this.panState.isPanning) {
        console.log('[MainScene] pointerup tile:', tileX, tileY);
        try { window.dispatchEvent(new CustomEvent('editor:tileUp', { detail: { tileX, tileY } })); } catch { }
        gameBridge.onPointerUpTile({ tileX, tileY });
      }
      // Szene-eigene Terrain-Anwendung bei aktivem Ghost und Drag-Start
      try {
        const ds = (this as any)._dragStartTile as { x: number; y: number } | undefined;
        const editorState = EditorService.getState();
        const editorTool = editorState.tool;
        if (this.editorMode && ds && this.ghostSprite && (this as any)._ghostDataUrl && editorTool === 'terrain') {
          const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };
          this.applyTerrainPaint({ rect, dataUrl: (this as any)._ghostDataUrl as string });
        } else if (this.editorMode && ds && (editorTool === 'collision' || editorTool === 'erase')) {
          const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };

          // Logic Separation:
          // 1. Terrain Tab + Erase -> Erase Terrain
          // 2. Collision Tab + Erase -> Erase Collision
          // 3. Collision Tab + Draw -> Draw Collision

          if (editorState.category === 'terrain' && editorTool === 'erase') {
            this.eraseTerrainRect(rect);
          } else if (editorState.category === 'collisions') {
            // Im Collision Tab: Erase löscht Collision, Draw setzt Collision
            const tileIndex = editorTool === 'erase' ? -1 : 1;
            const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex, rect };
            this.applyTilePaint(edit);
          } else if (editorState.category === 'terrain' && editorTool === 'collision') {
            // Legacy Support: Falls jemand doch noch im Terrain Tab Collision nutzt (sollte durch UI verhindert sein)
            const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: 1, rect };
            this.applyTilePaint(edit);
          }
        }
      } catch { }
      // Cleanup nur für Terrain/Collision Tools - Zone/Asset-Tools werden von gameBridge verwaltet
      const editorTool = EditorService.getState().tool;
      const isTerrainCollisionTool = editorTool === 'terrain' || editorTool === 'collision' || editorTool === 'erase';
      if (isTerrainCollisionTool) {
        this.setSelectionRect(null);
        (this as any)._dragStartTile = undefined;
      }
      this.updateCursor();
    });

    // Global pointer up/down to suppress OS/browser context menu
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        try { (p.event as any)?.preventDefault?.(); } catch { }
        try { (p.event as any)?.stopPropagation?.(); } catch { }
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (p.rightButtonReleased()) {
        try { (p.event as any)?.preventDefault?.(); } catch { }
        try { (p.event as any)?.stopPropagation?.(); } catch { }
      }
    });

    // Create hover outline graphics
    this.hoverOutline = this.add.graphics();
    this.hoverOutline.setDepth(11); // Above sprites

    // Set up pointer move event for hover detection
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;

      // Check if hovering over any remote sprite
      let foundHover = false;
      for (const [_id, sprite] of this.remotes) {
        const bounds = sprite.getBounds();
        if (bounds.contains(worldPoint.x, worldPoint.y)) {
          if (this.hoveredSprite !== sprite) {
            this.hoveredSprite = sprite;
            this.updateHoverOutline();
          }
          foundHover = true;
          break;
        }
      }

      if (!foundHover && this.hoveredSprite) {
        this.hoveredSprite = null;
        this.updateHoverOutline();
      }
      this.updateCursor();
    });

    // Removed duplicate handler - combined with main pointerdown below

    // Disable browser context menu on canvas and via Phaser input
    try { this.input.mouse?.disableContextMenu?.(); } catch { }
    this.game.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });

    gameBridge.setSceneApi(this);
    // Make scene globally accessible for editor updates
    (window as any).currentPhaserScene = this;

    // Register pending tilesets
    const pendingTilesets = (window as any).pendingTilesets;
    if (pendingTilesets && Array.isArray(pendingTilesets)) {
      // Store ALL tilesets for registration
      this.pendingTilesetRegistrations = pendingTilesets;

      // Register all tilesets after a short delay to ensure the map is ready
      setTimeout(() => {
        this.pendingTilesetRegistrations?.forEach((ts: any) => {
          this.registerTileset(ts);
        });
      }, 100);

      (window as any).pendingTilesets = null;
    }

    // Nach dem Aufbau: IMMER vom Server laden für konsistenten State
    setTimeout(() => {
      // WICHTIG: Auch für V2-Maps müssen dynamische Server-Daten (Kollision, Editor-Paints) geladen werden!
      // Sonst haben normale User keine Kollisionen, da diese nicht im statischen Map-Build enthalten sind.
      this.fetchAndApplyServerLayers().then(() => {
        // Nach dem Laden: Kollision für Nicht-Editoren verstecken
        if (!this.editorMode) {
          try { this.collisionLayer?.setVisible(false); } catch (e) { console.error('[MainScene] Failed to hide collision layer', e); }
        }
      }).catch(e => console.error('[MainScene] Failed to load server layers', e));
    }, 100);

    if (this.v2) {
      // Initial verstecken (wird nach Load erneut sichergestellt)
      try { this.collisionLayer?.setVisible(false); } catch (e) { console.error('[MainScene] Failed to hide collision layer', e); }
    }

    // Bridge aufräumen, wenn Szene herunterfährt
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch { }
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      // try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch { }
    });
  }

  setEditorTool(tool: 'terrain' | 'collision' | 'erase' | 'select') {
    this.editorCurrentTool = tool;
  }

  private ensureRecenterUi() {
    camEnsureRecenterUi(this as any);
  }

  private updateRecenterUiVisibility() {
    camUpdateRecenterUiVisibility(this as any);
  }

  recenterCamera() {
    camRecenterCamera(this as any);
  }

  setEditorMode(enabled: boolean) {
    this.editorMode = !!enabled;
    if (this.editorMode) {
      // Lock movement while editing
      this.setMovementLocked(true);
      // Kollisionen-Overlay standardmäßig sichtbar im Editor
      try { this.setCollisionVisible(true); } catch { }
      // Kollision-Layer selbst bleibt verborgen
      try { this.collisionLayer?.setVisible(false); } catch { }
      // Stop follow to avoid accidental jumps; lock movement via gameBridge consumer
      try { this.cameras.main.stopFollow(); } catch { }
      this.manualCameraActive = true;
      this.updateRecenterUiVisibility();
      // Hide name labels and outlines while editing
      try { if (this.heroNameLabel) this.heroNameLabel.setVisible(false); } catch { }
      try { this.nameLabels.forEach(lbl => lbl.setVisible(false)); } catch { }
      try { this.bubbleOutlines.forEach(g => g.setVisible(false)); } catch { }
      // Beim Aktivieren des Editors: Serverzustand laden (inkl. Zonen)
      try { this.fetchAndApplyServerLayers(); } catch { }
      // Beim Aktivieren des Editors: Zonen-Overlay aus LocalStorage laden und anzeigen
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('meetropolis.zones') : null;
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored)) {
          this.setZoneOverlay(stored);
        }
      } catch { }
    } else {
      // Unlock movement when leaving editor mode
      this.setMovementLocked(false);
      // Restore follow to hero when leaving editor mode
      try { this.cameras.main.startFollow(this.hero, true, 0.1, 0.1); } catch { }
      this.manualCameraActive = false;
      this.updateRecenterUiVisibility();
      // Restore labels respecting DND state
      try { if (this.heroNameLabel) this.heroNameLabel.setVisible(true); } catch { }
      try { this.nameLabels.forEach(lbl => lbl.setVisible(true)); } catch { }
      try { this.bubbleOutlines.forEach(g => g.setVisible(true)); } catch { }
      // Beim Verlassen des Editors: Zonen-Overlay ausblenden
      try { if (this.zoneG) { this.zoneG.clear(); this.zoneG.setVisible(false); } } catch { }
      // Beim Verlassen des Editors: Spawn-Marker ausblenden
      try { if (this.spawnG) { this.spawnG.clear(); this.spawnG.setVisible(false); } } catch { }
      // Im v2-Modus bleibt der Collision-Layer weiterhin verborgen
      if (this.v2) {
        try { this.collisionLayer?.setVisible(false); } catch { }
      }
    }
    try {
      this.systems.forEach((s) => s.init());
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        try { this.systems.forEach((s) => s.destroy()); } catch { }
      });
    } catch { }
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up' | 'down' | 'left' | 'right'; prevX?: number; prevY?: number; name?: string }>) {
    const localSession: string | undefined = (typeof window !== 'undefined' ? (window as any).__localSessionId : undefined);
    for (const [id, p] of Object.entries(players)) {
      // never create a remote sprite for self (by sessionId)
      if (localSession && id === localSession) continue;
      // defensive: if a remote entry sits exactly at hero position, treat as duplicate self and skip
      try {
        if (this.hero && Math.abs(p.x - this.hero.x) < 0.01 && Math.abs(p.y - this.hero.y) < 0.01) {
          // also ensure any lingering sprite for this id is removed
          const lingering = this.remotes.get(id);
          if (lingering) { lingering.destroy(); this.remotes.delete(id); }
          const lbl = this.nameLabels.get(id);
          if (lbl) { lbl.destroy(); this.nameLabels.delete(id); }
          continue;
        }
      } catch { }
      let s = this.remotes.get(id);
      if (!s) {
        // Creating new sprite for player (Businessman only)
        s = this.add.sprite(p.x, p.y, 'hero_walk_down', 0);
        s.setDepth(10); // Same depth as local hero
        // Store previous position and direction for movement detection
        (s as any).prevX = p.x;
        (s as any).prevY = p.y;
        (s as any).prevDirection = p.direction;
        (s as any).lastMoveTime = Date.now();
        this.remotes.set(id, s);

        // Create name label for remote player
        const name = p.name || `User ${id.substring(0, 6)}`;
        const nameLabel = this.createNameLabel(name, id);
        this.nameLabels.set(id, nameLabel);
        this.updateNameLabel(nameLabel, p.x, p.y);
      }

      // Check if player is moving
      const prevX = (s as any).prevX || p.x;
      const prevY = (s as any).prevY || p.y;
      const prevDirection = (s as any).prevDirection || p.direction;
      const deltaX = p.x - prevX;
      const deltaY = p.y - prevY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      const isMoving = distance > 0.5; // Threshold for movement detection
      const directionChanged = prevDirection !== p.direction;

      // Debug logging removed - too verbose

      // Update position
      s.setPosition(p.x, p.y);
      (s as any).prevX = p.x;
      (s as any).prevY = p.y;
      (s as any).prevDirection = p.direction;

      // Get name label first
      const nameLabel = this.nameLabels.get(id);
      // If we initially rendered with a fallback (e.g. after hard reload) and
      // we now have a proper name from the app/state, update the label text
      // and recompute its geometry.

      if (nameLabel && p && typeof (p as any).name === 'string' && (p as any).name) {
        try {
          const textObj = (nameLabel as any).text as Phaser.GameObjects.Text | undefined;
          if (textObj && textObj.text !== (p as any).name) {
            textObj.setText((p as any).name);
            const padX = (nameLabel as any).paddingX || 0;
            const padY = (nameLabel as any).paddingY || 0;
            (nameLabel as any).width = textObj.width + padX * 2;
            (nameLabel as any).height = textObj.height + padY * 2;
            this.drawNameLabel(nameLabel, false);
          }
        } catch { }
      }

      // Update transparency if player has DND
      if ((p as any).dnd !== undefined) {
        s.setAlpha((p as any).dnd ? 0.35 : 1);
        if (nameLabel) {
          nameLabel.setAlpha((p as any).dnd ? 0.6 : 1);
        }
      }

      // Update name label position
      if (nameLabel) {
        this.updateNameLabel(nameLabel, p.x, p.y);
      }

      // Always play animation based on direction
      const animationMap: Record<string, string> = {
        'up': 'walk_up',
        'down': 'walk_down',
        'left': 'walk_left',
        'right': 'walk_right'
      };

      const animKey = animationMap[p.direction] || 'walk_down';

      if (isMoving) {
        (s as any).lastMoveTime = Date.now();
        s.play(animKey, true);
      } else {
        // Check if we recently stopped moving (within 100ms)
        const timeSinceLastMove = Date.now() - ((s as any).lastMoveTime || 0);
        if (timeSinceLastMove < 100) {
          // Keep playing animation briefly after stopping
          if (!s.anims.isPlaying || s.anims.currentAnim?.key !== animKey) {
            s.play(animKey, true);
          }
        } else {
          // Stop animation and show standing frame
          s.anims.stop();
          const textureMap: Record<string, string> = {
            'up': 'hero_walk_up',
            'down': 'hero_walk_down',
            'left': 'hero_walk_left',
            'right': 'hero_walk_right'
          };
          s.setTexture(textureMap[p.direction] || 'hero_walk_down', 0);
        }
      }

      // If direction changed while standing, update texture
      if (directionChanged && !isMoving) {
        const textureMap: Record<string, string> = {
          'up': 'hero_walk_up',
          'down': 'hero_walk_down',
          'left': 'hero_walk_left',
          'right': 'hero_walk_right'
        };
        s.setTexture(textureMap[p.direction] || 'hero_walk_down', 0);
      }
    }
    for (const id of Array.from(this.remotes.keys())) {
      if (!players[id]) {
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);

        // Remove name label
        const nameLabel = this.nameLabels.get(id);
        if (nameLabel) {
          nameLabel.destroy();
          this.nameLabels.delete(id);
        }
      }
    }
  }

  setDoNotDisturb(enabled: boolean) {
    this.doNotDisturb = !!enabled;
    // Local hero transparency
    if (this.hero) this.hero.setAlpha(this.doNotDisturb ? 0.35 : 1);
    if (this.heroNameLabel) this.heroNameLabel.setAlpha(this.doNotDisturb ? 0.6 : 1);
    // Do not hide remote sprites or labels in DND anymore. Keep them visible.
    this.remotes.forEach((sprite) => {
      sprite.setVisible(true);
    });
    this.nameLabels.forEach((label) => {
      label.setVisible(true);
    });
    // Keep bubble outlines visible as well
    this.bubbleOutlines.forEach((g) => g.setVisible(true));
  }

  setDesiredPosition(pos: { x: number; y: number } | null) {
    const prev = this.desiredPos;
    const same = (prev === null && pos === null) || (prev && pos && prev.x === pos.x && prev.y === pos.y);
    if (same) return;
    this.desiredPos = pos;
    try { console.debug('[Scene] desiredPos set to', pos); } catch { }
  }

  setMovementLocked(locked: boolean) {
    this.movementLocked = !!locked;
    if (locked) {
      // Stop any ongoing desired movement immediately
      this.desiredPos = null;
      try { this.hero?.body?.setVelocity?.(0, 0); } catch { }
      try { this.hero?.anims?.stop?.(); } catch { }
    }
    // Debug log removed - too verbose
  }

  private isWalkable(x: number, y: number): boolean {
    // Check world bounds
    const map = this.mapRef;
    if (!map) return false;
    if (x < 0 || y < 0 || x >= map.widthInPixels || y >= map.heightInPixels) return false;
    // Check collision layer tile at position
    const tl = this.collisionLayer;
    if (!tl) return true; // If no collision layer, assume walkable
    const tileX = Math.floor(x / map.tileWidth);
    const tileY = Math.floor(y / map.tileHeight);
    try {
      const tile = tl.getTileAt(tileX, tileY);
      if (tile && tile.index !== -1) return false;
    } catch { }
    // Avoid overlapping other players (simple radius check)
    const radius = Math.max(map.tileWidth, map.tileHeight) * 0.6;
    for (const sprite of this.remotes.values()) {
      const dx = sprite.x - x;
      const dy = sprite.y - y;
      if (dx * dx + dy * dy < radius * radius) return false;
    }
    // Also avoid overlapping hero itself (not needed for placement, but safe)
    return true;
  }

  findFreeSpotNear(targetId: string, options?: { radius?: number; step?: number }): { x: number; y: number } | null {
    const target = this.remotes.get(targetId);
    if (!target) return null;
    const map = this.mapRef;
    if (!map) return { x: target.x, y: target.y };
    const baseRadius = options?.radius ?? Math.max(map.tileWidth, map.tileHeight);
    const maxRings = 8;
    for (let ring = 1; ring <= maxRings; ring++) {
      const r = baseRadius * ring;
      for (let angle = 0; angle < 360; angle += 30) {
        const rad = angle * Math.PI / 180;
        // Snap to tile centers to avoid half-tile overlaps
        const tx = Math.round((target.x + Math.cos(rad) * r) / map.tileWidth) * map.tileWidth + map.tileWidth / 2;
        const ty = Math.round((target.y + Math.sin(rad) * r) / map.tileHeight) * map.tileHeight + map.tileHeight / 2;
        if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
      }
      // Cardinal checks with smaller step
      const dirs = [[r, 0], [-r, 0], [0, r], [0, -r]];
      for (const [dx, dy] of dirs) {
        const tx = Math.round((target.x + dx) / map.tileWidth) * map.tileWidth + map.tileWidth / 2;
        const ty = Math.round((target.y + dy) / map.tileHeight) * map.tileHeight + map.tileHeight / 2;
        if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
      }
    }
    return { x: target.x, y: target.y };
  }

  private updateHoverOutline() {
    if (!this.hoverOutline) return;

    this.hoverOutline.clear();

    if (this.hoveredSprite) {
      const bounds = this.hoveredSprite.getBounds();

      // Draw outline
      this.hoverOutline.lineStyle(2, 0x00ff00, 1);
      this.hoverOutline.strokeRect(
        bounds.x - 2,
        bounds.y - 2,
        bounds.width + 4,
        bounds.height + 4
      );

      // Add a subtle glow effect
      this.hoverOutline.lineStyle(4, 0x00ff00, 0.3);
      this.hoverOutline.strokeRect(
        bounds.x - 4,
        bounds.y - 4,
        bounds.width + 8,
        bounds.height + 8
      );
    } else {
    }
    this.updateCursor();
  }

  private updateCursor() {
    try {
      const input = this.input;
      if (!input) return;
      let cursor: string = 'default';

      if (this.editorMode) {
        const state = EditorService.getState();
        // console.log('[MainScene] updateCursor tool:', state.tool);
        if (state.tool === 'spawn') {
          cursor = 'crosshair';
        }
      }

      if (this.panState?.isPanning) {
        cursor = 'grabbing';
      } else if (this.spaceHeld) {
        cursor = 'grab';
      } else if (this.hoveredSprite) {
        cursor = 'pointer';
      }
      input.setDefaultCursor(cursor);
    } catch { }
  }

  setZoneOverlay(polys: { name: string; points: any[] }[]) {
    try {
      // Zonen nur im Editor anzeigen und wenn sichtbar
      if (!this.editorMode || !this.zonesVisible) {
        if (this.zoneG) { this.zoneG.clear(); this.zoneG.setVisible(false); }
        return;
      }
      if (!this.zoneG || !this.zoneG.scene) {
        this.zoneG = this.add.graphics();
        this.zoneG.setDepth(8);
      }
      const g = this.zoneG;
      g.setVisible(true);
      g.clear();
      g.lineStyle(2, 0x00ff99, 1);
      g.fillStyle(0x00ff99, 0.18);

      const toPoint = (v: any): { x: number; y: number } | null => {
        if (!v) return null;
        // accept {x,y}
        if (typeof v.x === 'number' && typeof v.y === 'number') return { x: v.x, y: v.y };
        // accept [x,y]
        if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return { x: v[0], y: v[1] };
        // accept strings
        const px = (v as any).x, py = (v as any).y;
        if ((typeof px === 'string' || typeof px === 'number') && (typeof py === 'string' || typeof py === 'number')) {
          const nx = Number(px);
          const ny = Number(py);
          if (!Number.isNaN(nx) && !Number.isNaN(ny)) return { x: nx, y: ny };
        }
        return null;
      };

      for (const poly of Array.isArray(polys) ? polys : []) {
        const raw = Array.isArray(poly?.points) ? poly.points : [];
        const pts = raw.map(toPoint).filter((p: any) => p && typeof p.x === 'number' && typeof p.y === 'number') as { x: number; y: number }[];
        if (!pts || pts.length < 3) continue;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.fillPath();
        g.strokePath();
      }
    } catch {
      // Ensure overlay drawing never breaks the scene
    }
  }
  setZonesVisible(visible: boolean) {
    try {
      this.zonesVisible = !!visible;
      if (!this.zonesVisible && this.zoneG) {
        this.zoneG.clear();
        this.zoneG.setVisible(false);
      }
    } catch { }
  }

  setSpawnMarker(pos: { x: number; y: number } | null) {
    try {
      // Spawn nur im Editor anzeigen (analog Zonen)
      if (!this.editorMode) {
        if (this.spawnG) { this.spawnG.clear(); this.spawnG.setVisible(false); }
        return;
      }
      if (!this.spawnG || !this.spawnG.scene) {
        this.spawnG = this.add.graphics();
        this.spawnG.setDepth(9);
      }
      const g = this.spawnG;
      g.setVisible(true);
      g.clear();
      if (!pos) return;
      // Grauer Marker: gefüllter Kreis + Kreuz
      const r = 6;
      g.fillStyle(0x9ca3af, 0.35); // grau, halbtransparent
      g.fillCircle(pos.x, pos.y, r);
      g.lineStyle(1, 0x9ca3af, 0.9);
      g.beginPath();
      g.moveTo(pos.x - r - 2, pos.y);
      g.lineTo(pos.x + r + 2, pos.y);
      g.moveTo(pos.x, pos.y - r - 2);
      g.lineTo(pos.x, pos.y + r + 2);
      g.strokePath();
    } catch { }
  }

  setEditorAssets(assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) {
    edSetAssets(this, assets);
  }

  setAssetPreview(preview: { dataUrl: string; width?: number; height?: number } | null) {
    edSetAssetPreview(this, preview);
  }

  // Neues Terrain-Painting: benutzt Ghost/Preview wie Objekte, schreibt aber in EditorGround/Walls
  async applyTerrainPaint(edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string; attempt?: number }) {
    // TODO: Integrate with new Editor system
    console.log('[MainScene] applyTerrainPaint called (stub)', edit.rect);
  }

  eraseTerrainRect(rect: { startX: number; startY: number; endX: number; endY: number }) {
    try {
      const x0 = Math.min(rect.startX, rect.endX);
      const y0 = Math.min(rect.startY, rect.endY);
      const x1 = Math.max(rect.startX, rect.endX);
      const y1 = Math.max(rect.startY, rect.endY);
      const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const mapName = this.currentMapName || 'office';
      const body = (layer: 'ground' | 'walls') => JSON.stringify({ layer, rect: { x0, y0, x1, y1 }, erase: true });
      const req = (layer: 'ground' | 'walls') => fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/paint-rect`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body(layer),
      }).then(r => r.json().catch(() => ({} as any))).catch(() => ({} as any));
      Promise.all([req('ground'), req('walls')]).then(([g, w]) => {
        try {
          const gUpdates = Array.isArray(g?.updates) ? g.updates : [];
          const wUpdates = Array.isArray(w?.updates) ? w.updates : [];
          if (gUpdates.length > 0) this.applyChunkUpdates('ground', gUpdates as any);
          if (wUpdates.length > 0) this.applyChunkUpdates('walls', wUpdates as any);
          // Fallback: lokale Entfernung, falls keine Updates geliefert
          if (gUpdates.length === 0 && this.editorGround) {
            for (let ty = y0; ty <= y1; ty++) {
              for (let tx = x0; tx <= x1; tx++) {
                try { this.editorGround.removeTileAt(tx, ty); } catch { }
              }
            }
          }
          if (wUpdates.length === 0 && this.wallsLayer) {
            for (let ty = y0; ty <= y1; ty++) {
              for (let tx = x0; tx <= x1; tx++) {
                try { this.wallsLayer.removeTileAt(tx, ty); } catch { }
              }
            }
          }
        } catch (e) {
          console.error('[MainScene] eraseTerrainRect local update failed', e);
        }
      });
    } catch (e) {
      console.error('[MainScene] eraseTerrainRect failed', e);
    }
  }

  private async ensureTerrainTilesetFor(dataUrl: string): Promise<string | null> {
    // TODO: Integrate with new Editor system
    console.log('[MainScene] ensureTerrainTilesetFor called (stub)');
    return null;
  }

  setSelectionRect(rect: { x: number; y: number; w: number; h: number } | null) {
    if (!rect) {
      if (this.selectionG) {
        this.selectionG.clear();
      }
      return;
    }
    if (!this.selectionG || !this.selectionG.scene) {
      this.selectionG = this.add.graphics();
      this.selectionG.setDepth(7);
    }
    const g = this.selectionG;
    g.clear();
    g.lineStyle(1, 0x22d3ee, 1);
    g.fillStyle(0x22d3ee, 0.12);
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }

  applyTilePaint(edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) {
    // v2: Sende an Server /maps/:name/paint-rect und wende Updates lokal an
    try {
      const x0 = Math.min(edit.rect.startX, edit.rect.endX);
      const y0 = Math.min(edit.rect.startY, edit.rect.endY);
      const x1 = Math.max(edit.rect.startX, edit.rect.endX);
      const y1 = Math.max(edit.rect.startY, edit.rect.endY);
      const layerName = edit.layer === 'Collision' ? 'collision' : (edit.layer === 'EditorWalls' ? 'walls' : 'ground');
      const erase = typeof edit.tileIndex === 'number' && edit.tileIndex <= 0;

      // Optimistic Update: Sofort lokal anwenden für Instant-Feedback
      if (layerName === 'collision' && this.collisionLayer) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            if (erase) {
              try { this.collisionLayer.removeTileAt(tx, ty); } catch { }
            } else {
              try {
                const t = this.collisionLayer.putTileAt(1, tx, ty);
                if (t) t.setCollision(true, true, true, true);
              } catch { }
            }
          }
        }
        try { this.ensureCollisionCollider(); } catch { }
        try { this.rebuildStaticColliders(); } catch { }
        try { if (this.collisionVisible) (this as any).updateCollisionOverlay?.(); } catch { }
      }

      const apiBase = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const mapName = this.currentMapName || 'office';
      const payload: any = {
        layer: layerName,
        rect: { x0, y0, x1, y1 },
      };
      if (erase) {
        payload.erase = true;
      } else {
        // Für collision genügt tileRefId = 1 (bool-encoding auf Server)
        payload.tileRefId = edit.tileIndex | 0;
      }
      fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/paint-rect`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then(res => res.json().catch(() => ({})))
        .then((data: any) => {
          try {
            const updates = Array.isArray(data?.updates) ? data.updates : [];
            if (updates.length > 0 && typeof this.applyChunkUpdates === 'function') {
              this.applyChunkUpdates(layerName as any, updates as any);
              // Nach Server-Update nochmal Overlay aktualisieren, um sicherzugehen
              if (layerName === 'collision') {
                try { if (this.collisionVisible) (this as any).updateCollisionOverlay?.(); } catch { }
              }
            }
          } catch (e) { console.error('[MainScene] applyTilePaint local update failed', e); }
        })
        .catch((e) => {
          console.error('[MainScene] paint-rect failed', e);
          // TODO: Revert optimistic update on error?
        });
    } catch (e) {
      console.error('[MainScene] applyTilePaint failed', e);
    }
  }

  private saveEditorLayers() {
    // DEPRECATED: No longer used with new EditorService
    console.log('[MainScene] saveEditorLayers called (deprecated)');
  }

  // Unbedingtes Speichern der Editor-Layer zum Server (ohne Größenlimit)
  saveEditorLayersHard() {
    // DEPRECATED: No longer used with new EditorService
    console.log('[MainScene] saveEditorLayersHard called (deprecated)');
  }

  private loadEditorLayers() {
    // DEPRECATED: No longer used with new EditorService
    console.log('[MainScene] loadEditorLayers called (deprecated)');
  }

  reloadEditorLayers() {
    // DEPRECATED: No longer used with new EditorService
    // Silent - too verbose
  }


  async fetchAndApplyServerLayers() {
    await mapFetchAndApply(this as any);
  }

  private rebuildStaticColliders() {
    colRebuildStatic(this as any);
  }

  registerTileset(ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) {
    mapRegisterTileset(this as any, ts);
  }

  setCollisionVisible(visible: boolean) {
    colSetVisible(this as any, visible);
  }

  private updateCollisionOverlay() {
    colUpdateOverlay(this as any);
  }

  setBubbleMembers(members: Set<string>) {
    uiSetBubbleMembers(this as any, members);
  }

  private updateBackgrounds() {
    if (!this.mapRef) return;
    const state = EditorService.getState();
    const spaceColor = Phaser.Display.Color.HexStringToColor(state.backgroundColor || '#111827').color;
    const terrainColor = Phaser.Display.Color.HexStringToColor(state.terrainColor || '#202020').color;

    // 1. Space Background (Outside)
    if (!this.backgroundGraphics) {
      this.backgroundGraphics = this.add.graphics();
      this.backgroundGraphics.setDepth(-10);
    }
    this.backgroundGraphics.clear();
    this.backgroundGraphics.fillStyle(spaceColor);
    // Draw a large rect covering the "space"
    // Since camera moves, we might need a fixed layer or just a huge rect.
    // For now, a huge rect centered on map should suffice, or use camera background color.
    // Actually, setting camera background color is better for "infinite" space.
    this.cameras.main.setBackgroundColor(state.backgroundColor || '#111827');

    // 2. Terrain Background (Inside Map)
    // We draw this behind the map but on top of the camera background
    this.backgroundGraphics.fillStyle(terrainColor);
    this.backgroundGraphics.fillRect(0, 0, this.mapRef.widthInPixels, this.mapRef.heightInPixels);

    // 3. Map Border
    if (!this.borderGraphics) {
      this.borderGraphics = this.add.graphics();
      this.borderGraphics.setDepth(100); // High depth to be visible
    }
    this.borderGraphics.clear();
    this.borderGraphics.lineStyle(2, 0x3b82f6, 0.5); // Blue-ish border
    this.borderGraphics.strokeRect(0, 0, this.mapRef.widthInPixels, this.mapRef.heightInPixels);
  }

  private updateGrid() {
    if (!this.mapRef) return;
    const state = EditorService.getState();

    if (!this.gridGraphics) {
      this.gridGraphics = this.add.graphics();
      this.gridGraphics.setDepth(1000); // Very high depth to ensure visibility
    }
    this.gridGraphics.clear();

    if (!state.gridVisible) return;

    const terrainColorHex = state.terrainColor || '#202020';
    const baseColor = Phaser.Display.Color.HexStringToColor(terrainColorHex);

    // Calculate a slightly lighter color for the grid
    // We can increase lightness (HSL) or just add to RGB channels
    const hsv = baseColor.hsv; // h, s, v in [0..1]

    // Increase value (brightness) by a larger amount to ensure visibility
    let newV = hsv.v + 0.3;
    if (newV > 1) newV = 1;

    // If the background is already very bright, darken instead
    if (hsv.v > 0.7) {
      newV = Math.max(0, hsv.v - 0.4);
    }

    const gridColorObj = new Phaser.Display.Color();
    gridColorObj.setFromHSV(hsv.h, hsv.s, newV);

    const gridColor = gridColorObj.color;
    const alpha = 0.5; // Increased alpha for better visibility

    this.gridGraphics.lineStyle(1, gridColor, alpha);

    const width = this.mapRef.widthInPixels;
    const height = this.mapRef.heightInPixels;
    const tileW = this.mapRef.tileWidth;
    const tileH = this.mapRef.tileHeight;

    // Vertical lines
    for (let x = 0; x <= width; x += tileW) {
      this.gridGraphics.moveTo(x, 0);
      this.gridGraphics.lineTo(x, height);
    }

    // Horizontal lines
    for (let y = 0; y <= height; y += tileH) {
      this.gridGraphics.moveTo(0, y);
      this.gridGraphics.lineTo(width, y);
    }

    this.gridGraphics.strokePath();
    for (let y = 0; y <= height; y += tileH) {
      this.gridGraphics.moveTo(0, y);
      this.gridGraphics.lineTo(width, y);
    }
    this.gridGraphics.strokePath();
  }

  private updateBubbleOutline(id: string, sprite: Phaser.GameObjects.Sprite) {
    uiUpdateBubbleOutline(this as any, id, sprite);
  }

  private createNameLabel(name: string, playerId?: string): Phaser.GameObjects.Container {
    return uiCreateNameLabel(this as any, name, playerId);
  }

  private drawNameLabel(container: Phaser.GameObjects.Container, isSpeaking: boolean) {
    uiDrawNameLabel(this as any, container, isSpeaking);
  }

  private updateNameLabel(container: Phaser.GameObjects.Container, x: number, y: number) {
    uiUpdateNameLabel(this as any, container, x, y);
  }

  setHeroName(name: string) {
    uiSetHeroName(this as any, name);
  }

  updateSpeakingStates(speakingIds: Set<string>) {
    uiUpdateSpeakingStates(this as any, speakingIds);
  }

  setBackgroundColor(hex: string) {
    try { this.cameras.main.setBackgroundColor(hex); } catch { }
  }

  private async loadVisibleChunks(layerName: 'ground' | 'walls' | 'collision') {
    await mapLoadVisibleChunks(this as any, layerName);
  }

  public applyChunkUpdates(layerName: 'ground' | 'walls' | 'collision', updates: Array<{ key: string; version: number; encoding: string; data: string }>) {
    mapApplyChunkUpdates(this as any, layerName, updates);
  }

  override update(time: number, delta: number) {
    super.update(time, delta);
    try { this.systems.forEach((s) => s.update(time, delta)); } catch { }
    if (this.v2) {
      // Chunk-Reloads nur bei Kamera-Änderungen
      const vw = this.cameras.main.worldView;
      const camSig = `${Math.floor(vw.x)}:${Math.floor(vw.y)}:${Math.floor(vw.width)}:${Math.floor(vw.height)}:${this.cameras.main.zoom.toFixed(2)}`;
      if (camSig !== this._lastCamSig) {
        this._lastCamSig = camSig;
        this.loadVisibleChunks('ground');
        this.loadVisibleChunks('walls');
        this.loadVisibleChunks('collision');
      }
    }
  }
  private _lastCamSig: string | null = null;

  forceReloadMap() {
    if (this.v2) {
      this.loadedChunks.clear();
      this._lastCamSig = null; // force re-check in update()
      try { console.log('[MainScene] Forced full map reload (chunks cleared)'); } catch { }
      // Trigger re-load of all layers immediately
      this.loadVisibleChunks('ground');
      this.loadVisibleChunks('walls');
      this.loadVisibleChunks('collision');
      // Also reload non-chunk server state
      this.fetchAndApplyServerLayers().catch(() => { });
    } else {
      // Legacy path: just re-fetch
      this.fetchAndApplyServerLayers().catch(() => { });
    }
  }

  private ensureCollisionCollider() {
    colEnsureCollider(this as any);
  }

  public updateTilesetRegistry(registry: any[]) {
    if (!this.v2 || !this.v2.state) return;
    // Merge new registry
    this.v2.state.tilesetRegistry = registry;
    // Recompute firstGids
    try {
      this.v2.firstGids = computeFirstGids(registry, this);
    } catch (e) { console.error('[MainScene] Failed to recompute firstGids', e); }

    // Register new tileset images in Phaser
    for (const ts of registry) {
      if (!this.dynamicTilesets.has(ts.key) && !this.mapRef?.tilesets.find(t => t.name === ts.key)) {
        try {
          const phTs = this.mapRef?.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
          if (phTs) this.dynamicTilesets.set(ts.key, phTs);
        } catch { }
      }
    }
    // Refresh layers tilesets
    const all = Array.from(this.dynamicTilesets.values());
    if (this.mapRef) all.push(...this.mapRef.tilesets.filter(t => !this.dynamicTilesets.has(t.name)));
    try { (this.editorGround as any)?.setTilesets?.(all); } catch { }
    try { (this.wallsLayer as any)?.setTilesets?.(all); } catch { }
    try { (this.collisionLayer as any)?.setTilesets?.(all); } catch { }
  }
}
