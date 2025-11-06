import Phaser from 'phaser';
import { gameBridge } from '../bridge';
import { editorLog, editorError } from '../../lib/editorLog';
import { V2State, computeFirstGids, decodeRLE, fetchChunks, tileRefIdToGid } from '../../lib/mapV2';

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
        try { cam.startFollow(this.hero, true, 0.1, 0.1); } catch {}
        this.manualCameraActive = false;
        this.updateRecenterUiVisibility();
      }
    } catch {}
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
        } catch {}
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
      try { this.collisionLayer?.setVisible(false); } catch {}
      // Any non -1 index will collide
      try { this.collisionLayer?.setCollisionByExclusion([-1], true); } catch {}
      // Compute firstgids for tileRefId->gid
      const firstGids = computeFirstGids(pre.tilesetRegistry, this);
      this.v2 = { state: pre, firstGids, chunkSize: pre.mapMeta.chunkSize };
      // initial chunks load
      this.loadVisibleChunks('ground');
      this.loadVisibleChunks('walls');
      this.loadVisibleChunks('collision');
    } else {
      // Fallback TMJ
      const map = this.make.tilemap({ key: 'office' });
      this.mapRef = map;
    }

    // Binde Tilesets
    const map = this.mapRef!;
    const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
    const furniture = map.addTilesetImage('furniture_tiles', 'furniture_tiles', 16, 16, 0, 0);
    const decor = map.addTilesetImage('decor_tiles', 'decor_tiles', 16, 16, 0, 0);
    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);
    
    // Try to add any missing tilesets referenced in the map data (only in TMJ/v1 path)
    if (!this.v2) {
      try {
        const mapData = (map as any).data;
        if (mapData && mapData.tilesets) {
          mapData.tilesets.forEach((ts: any) => {
            if (ts && ts.name && !map.tilesets.find(t => t.name === ts.name)) {
              try {
                map.addTilesetImage(ts.name, ts.name, ts.tilewidth || 16, ts.tileheight || 16, ts.margin || 0, ts.spacing || 0);
              } catch {}
            }
          });
        }
      } catch {}
    }

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
    const ground = this.v2 ? this.editorGround : (available.length ? map.createLayer('Ground', available, 0, 0) : undefined);
    const walls = this.v2 ? this.wallsLayer : (available.length ? map.createLayer('Walls', available, 0, 0) : undefined);
    // Layers are created conditionally based on available tilesets

    ground?.setDepth(0);
    walls?.setDepth(5);

    // Collision-Layer einlesen und statische Physik-Körper erzeugen
    let collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined;
    try {
      if (this.v2) {
        collisionLayer = this.collisionLayer;
        if (collisionLayer) {
          try { (collisionLayer as any).setTilesets(available); } catch {}
        }
      } else {
        const created = map.createLayer('Collision', available, 0, 0);
        collisionLayer = created ?? undefined;
      }
      
      // Fix: Check if collision layer has wrong data dimensions
      const layerData = (collisionLayer as any)?.layer;
      if (layerData && layerData.data) {
        const expectedRows = map.height;
        const actualRows = layerData.data.length;
        
        if (actualRows < expectedRows) {
          editorLog('Init', `Collision layer has wrong dimensions: ${actualRows} rows instead of ${expectedRows}, fixing...`);
          
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
          
          editorLog('Init', `Fixed collision layer dimensions to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
          
          // Verify the fix worked
          const testY = 30; // Test a row that should exist now
          if (layerData.data[testY]) {
            editorLog('Init', `Verification: Row ${testY} exists with ${layerData.data[testY].length} tiles`);
          } else {
            editorError('Init', `Verification failed: Row ${testY} still doesn't exist!`, null);
          }
        }
      }
    } catch (e) {
      editorLog('Init', 'No Collision layer in map, creating blank layer');
      // Create blank collision layer if it doesn't exist
      if (available.length > 0) {
        // Use the first available tileset for blank layer creation
        const firstTs = available[0]!;
        collisionLayer = map.createBlankLayer('Collision', firstTs, 0, 0, map.width, map.height, map.tileWidth, map.tileHeight) as any;
        editorLog('Init', `Created blank collision layer: ${map.width}x${map.height}`);
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
      editorLog('Init', 'Collision layer created');
    }
    
    let staticColliders: Phaser.Physics.Arcade.StaticGroup | undefined;
    if (collisionLayer) {
      collisionLayer.setDepth(10);
      collisionLayer.setVisible(false); // Hide the actual collision layer - we use overlay for visualization
      try {
        if (!this.v2) {
          const data = (collisionLayer as any)?.layer?.data as Phaser.Tilemaps.Tile[][] | undefined;
          if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && data[0].length > 0) {
            staticColliders = this.physics.add.staticGroup();
            for (let row = 0; row < data.length; row++) {
              const rowArr = data[row];
              if (!Array.isArray(rowArr)) continue;
              for (let col = 0; col < rowArr.length; col++) {
                const tile = rowArr[col];
                if (tile && tile.index !== -1) {
                  const x = col * map.tileWidth + map.tileWidth / 2;
                  const y = row * map.tileHeight + map.tileHeight / 2;
                  const body = this.add.rectangle(x, y, map.tileWidth, map.tileHeight, 0x000000, 0);
                  this.physics.add.existing(body, true); // static body
                  staticColliders.add(body);
                }
              }
            }
            // Collision layer visibility will be managed by editor state
            this.staticColliders = staticColliders;
          } else {
            editorLog('Init', 'Collision layer has no tile data; skipping collision setup');
          }
        }
      } catch (e) {
        editorError('Init', 'Failed to configure collision layer', e);
      }
    } else {
      editorLog('Init', 'No collision layer created');
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
    if (available.length) {
      try {
        const hasLayer = (map.layers || []).some((l: any) => l?.name === 'EditorGround');
        if (hasLayer) editorGround = map.createLayer('EditorGround', available, 0, 0) as any;
      } catch (e) {
        // EditorGround layer not found
      }
    }
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
      this.editorGround = editorGround as any;
    }

    // Editor-Walls Layer (zusätzliche Wände, die wir bemalen können)
    let editorWalls: Phaser.Tilemaps.TilemapLayer | undefined;
    if (available.length) {
      try {
        const hasLayer = (map.layers || []).some((l: any) => l?.name === 'EditorWalls');
        if (hasLayer) editorWalls = map.createLayer('EditorWalls', available, 0, 0) as any;
      } catch (e) {
        // EditorWalls layer not found
      }
    }
    if (!editorWalls) {
      try {
        const tmp = map.createBlankLayer('EditorWalls', available[0], 0, 0, map.width, map.height, map.tileWidth, map.tileHeight);
        this.wallsLayer = tmp as any;
      } catch {
        // Fallback ignorieren
      }
    } else {
      editorWalls.setDepth(6); // Higher than regular walls
      this.wallsLayer = editorWalls as any;
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
    } catch {}
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
    } catch {}
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

      // Keep pointer world position stable while zooming
      const worldBefore = (pointer as Phaser.Input.Pointer).positionToCamera(camera) as Phaser.Math.Vector2;
      camera.setZoom(nextZoom);
      const worldAfter = (pointer as Phaser.Input.Pointer).positionToCamera(camera) as Phaser.Math.Vector2;
      camera.scrollX += worldBefore.x - worldAfter.x;
      camera.scrollY += worldBefore.y - worldAfter.y;

      // Switching to manual camera if we zoomed away from default follow
      camera.stopFollow();
      this.manualCameraActive = true;
      this.updateRecenterUiVisibility();
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
        try { (p.event as any)?.preventDefault?.(); } catch {}
        try { (p.event as any)?.stopPropagation?.(); } catch {}
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
          try { (p.event as any)?.preventDefault?.(); } catch {}
          try { (p.event as any)?.stopPropagation?.(); } catch {}
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
          try { (p.event as any)?.preventDefault?.(); } catch {}
          try { (p.event as any)?.stopPropagation?.(); } catch {}
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
    } catch {}
    
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
            try { cam.stopFollow(); } catch {}
            this.manualCameraActive = true;
            this.updateRecenterUiVisibility();
          }
        }
      } catch {}
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
        try { (pointer.event as any)?.preventDefault?.(); } catch {}
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
        try { window.dispatchEvent(new CustomEvent('editor:tileDown', { detail: { tileX, tileY } })); } catch {}
        gameBridge.onPointerDownTile({ tileX, tileY });
        // Szene-eigene Drag-Auswahl starten
        try {
          (this as any)._dragStartTile = { x: tileX, y: tileY };
          if (this.mapRef) {
            const x = tileX * this.mapRef.tileWidth;
            const y = tileY * this.mapRef.tileHeight;
            this.setSelectionRect({ x, y, w: this.mapRef.tileWidth, h: this.mapRef.tileHeight });
          }
        } catch {}
      }
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      try { if (this.editorMode && !this.panState.isPanning) window.dispatchEvent(new CustomEvent('editor:tileMove', { detail: { tileX, tileY } })); } catch {}
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
      // Szene-eigene Drag-Auswahl zeichnen
      try {
        const ds = (this as any)._dragStartTile as { x: number; y: number } | undefined;
        if (this.editorMode && ds && pointer.leftButtonDown() && !this.panState.isPanning && this.mapRef) {
          const sx = Math.min(ds.x, tileX) * this.mapRef.tileWidth;
          const sy = Math.min(ds.y, tileY) * this.mapRef.tileHeight;
          const ex = Math.max(ds.x, tileX) * this.mapRef.tileWidth + this.mapRef.tileWidth;
          const ey = Math.max(ds.y, tileY) * this.mapRef.tileHeight + this.mapRef.tileHeight;
          this.setSelectionRect({ x: sx, y: sy, w: ex - sx, h: ey - sy });
        }
      } catch {}
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      if (this.editorMode && !this.panState.isPanning) {
        try { console.log('[SPAWN_DBG][Scene] pointerup->onPointerUpTile', { tileX, tileY }); } catch {}
        try { window.dispatchEvent(new CustomEvent('editor:tileUp', { detail: { tileX, tileY } })); } catch {}
        gameBridge.onPointerUpTile({ tileX, tileY });
      }
      // Szene-eigene Terrain-Anwendung bei aktivem Ghost und Drag-Start
      try {
        const ds = (this as any)._dragStartTile as { x: number; y: number } | undefined;
        if (this.editorMode && ds && this.ghostSprite && (this as any)._ghostDataUrl && this.editorCurrentTool !== 'collision' && this.editorCurrentTool !== 'erase') {
          const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };
          this.applyTerrainPaint({ rect, dataUrl: (this as any)._ghostDataUrl as string });
        } else if (this.editorMode && ds && (this.editorCurrentTool === 'collision' || this.editorCurrentTool === 'erase')) {
          // Kollision/Erase ohne App-Handler direkt anwenden
          const rect = { startX: ds.x, startY: ds.y, endX: tileX, endY: tileY };
          const edit = { layer: 'Collision' as const, tilesetKey: 'collision_tiles', tileIndex: this.editorCurrentTool === 'erase' ? -1 : 1, rect };
          this.applyTilePaint(edit);
        }
      } catch {}
      this.setSelectionRect(null);
      (this as any)._dragStartTile = undefined;
      this.updateCursor();
    });

    // Global pointer up/down to suppress OS/browser context menu
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        try { (p.event as any)?.preventDefault?.(); } catch {}
        try { (p.event as any)?.stopPropagation?.(); } catch {}
      }
    });
    this.input.on(Phaser.Input.Events.POINTER_UP, (p: Phaser.Input.Pointer) => {
      if (p.rightButtonReleased()) {
        try { (p.event as any)?.preventDefault?.(); } catch {}
        try { (p.event as any)?.stopPropagation?.(); } catch {}
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
    try { this.input.mouse?.disableContextMenu?.(); } catch {}
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
      // v2 aktiv? dann keinen v1-Reload/LocalStorage anwenden
      if (this.v2) {
        // Kollision außerhalb des Editors unsichtbar halten
        try { this.collisionLayer?.setVisible(false); } catch {}
        return;
      }
      // v1-Pfad: Server-/LocalStorage-Layer laden
      // this.fetchAndApplyServerLayers().catch(() => {
      //   this.loadEditorLayers();
      // });
    }, 0);

    // Bridge aufräumen, wenn Szene herunterfährt
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch {}
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      // try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch {}
    });
  }

  setEditorTool(tool: 'terrain' | 'collision' | 'erase' | 'select') {
    this.editorCurrentTool = tool;
  }

  private ensureRecenterUi() {
    if (this.recenterUi && this.recenterUi.scene) return;
    const container = this.add.container(0, 0);
    container.setDepth(1000);
    container.setScrollFactor(0);

    // Background
    const bg = this.add.rectangle(0, 0, 120, 28, 0x111114, 0.9);
    bg.setStrokeStyle(1, 0xffffff, 0.12);
    bg.setOrigin(0, 0);
    bg.setScrollFactor(0);

    // Label
    const label = this.add.text(10, 6, (window as any).i18next?.t?.('av.recenter') || 'Recenter', {
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ffffff'
    });
    label.setScrollFactor(0);

    container.add(bg);
    container.add(label);
    container.setPosition(12, 12);

    container.setSize(120, 28);
    container.setInteractive(new Phaser.Geom.Rectangle(0, 0, 120, 28), Phaser.Geom.Rectangle.Contains);
    container.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
      this.manualCameraActive = false;
      this.updateRecenterUiVisibility();
    });

    this.recenterUi = container;
    this.recenterUi.setVisible(false);
  }

  private updateRecenterUiVisibility() {
    if (!this.recenterUi) return;
    const cam = this.cameras.main;
    // If camera is following hero, hide
    const isFollowing = (cam as any).follow === this.hero;
    if (!this.manualCameraActive && isFollowing) {
      this.recenterUi.setVisible(false);
      try { gameBridge.onCameraManualChange?.(false); } catch {}
      return;
    }
    // If hero is near camera center, hide; otherwise show
    const centerX = cam.worldView.centerX;
    const centerY = cam.worldView.centerY;
    const dx = Math.abs(this.hero.x - centerX);
    const dy = Math.abs(this.hero.y - centerY);
    const tolerance = 8; // pixels
    const shouldShow = this.manualCameraActive || dx > tolerance || dy > tolerance;
    this.recenterUi.setVisible(shouldShow);
    try { gameBridge.onCameraManualChange?.(shouldShow); } catch {}
  }

  recenterCamera() {
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
    this.manualCameraActive = false;
    this.updateRecenterUiVisibility();
  }

  setEditorMode(enabled: boolean) {
    this.editorMode = !!enabled;
    if (this.editorMode) {
      // Lock movement while editing
      this.setMovementLocked(true);
      // Kollisionen-Overlay standardmäßig sichtbar im Editor
      try { this.setCollisionVisible(true); } catch {}
      // Kollision-Layer selbst bleibt verborgen
      try { this.collisionLayer?.setVisible(false); } catch {}
      // Stop follow to avoid accidental jumps; lock movement via gameBridge consumer
      try { this.cameras.main.stopFollow(); } catch {}
      this.manualCameraActive = true;
      this.updateRecenterUiVisibility();
      // Hide name labels and outlines while editing
      try { if (this.heroNameLabel) this.heroNameLabel.setVisible(false); } catch {}
      try { this.nameLabels.forEach(lbl => lbl.setVisible(false)); } catch {}
      try { this.bubbleOutlines.forEach(g => g.setVisible(false)); } catch {}
      // Beim Aktivieren des Editors: Serverzustand laden (inkl. Zonen)
      try { this.fetchAndApplyServerLayers(); } catch {}
      // Beim Aktivieren des Editors: Zonen-Overlay aus LocalStorage laden und anzeigen
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem('meetropolis.zones') : null;
        const stored = raw ? JSON.parse(raw) : null;
        if (Array.isArray(stored)) {
          this.setZoneOverlay(stored);
        }
      } catch {}
    } else {
      // Unlock movement when leaving editor mode
      this.setMovementLocked(false);
      // Restore follow to hero when leaving editor mode
      try { this.cameras.main.startFollow(this.hero, true, 0.1, 0.1); } catch {}
      this.manualCameraActive = false;
      this.updateRecenterUiVisibility();
      // Restore labels respecting DND state
      try { if (this.heroNameLabel) this.heroNameLabel.setVisible(true); } catch {}
      try { this.nameLabels.forEach(lbl => lbl.setVisible(true)); } catch {}
      try { this.bubbleOutlines.forEach(g => g.setVisible(true)); } catch {}
      // Beim Verlassen des Editors: Zonen-Overlay ausblenden
      try { if (this.zoneG) { this.zoneG.clear(); this.zoneG.setVisible(false); } } catch {}
      // Beim Verlassen des Editors: Spawn-Marker ausblenden
      try { if (this.spawnG) { this.spawnG.clear(); this.spawnG.setVisible(false); } } catch {}
      // Im v2-Modus bleibt der Collision-Layer weiterhin verborgen
      if (this.v2) {
        try { this.collisionLayer?.setVisible(false); } catch {}
      }
    }
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up'|'down'|'left'|'right'; prevX?: number; prevY?: number; name?: string }>) {
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
      } catch {}
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
      // TODO(TEST): UI/Phaser code is hard to unit-test here; covered indirectly via manual smoke.
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
        } catch {}
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
    try { console.debug('[Scene] desiredPos set to', pos); } catch {}
  }
  
  setMovementLocked(locked: boolean) {
    this.movementLocked = !!locked;
    if (locked) {
      // Stop any ongoing desired movement immediately
      this.desiredPos = null;
      try { this.hero?.body?.setVelocity?.(0, 0); } catch {}
      try { this.hero?.anims?.stop?.(); } catch {}
    }
    try { console.debug('[Scene] movementLocked =', this.movementLocked); } catch {}
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
    } catch {}
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
      const dirs = [ [r,0], [-r,0], [0,r], [0,-r] ];
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
      if (this.panState?.isPanning) {
        cursor = 'grabbing';
      } else if (this.spaceHeld) {
        cursor = 'grab';
      } else if (this.hoveredSprite) {
        cursor = 'pointer';
      }
      input.setDefaultCursor(cursor);
    } catch {}
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
    } catch {}
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
    } catch {}
  }

  setEditorAssets(assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) {
    // Wenn Spiel bereits zerstört -> nichts tun
    if (!this.game || !(this.game as any).renderer) return;
    // Entferne nicht verwendete Sprites
    const keep = new Set(assets.map(a => a.id));
    for (const [id, sprite] of this.editorSprites) {
      if (!keep.has(id)) {
        sprite.destroy();
        this.editorSprites.delete(id);
      }
    }
    // Stelle sicher, dass Texturen existieren und Sprites positioniert sind
    for (const a of assets) {
      // Use asset ID as texture key to avoid conflicts
      const textureKey = `asset_${a.id}`;
      
      // Update or create sprite
      let img = this.editorSprites.get(a.id);
      
      if (!img) {
        // Sprite doesn't exist, need to create it
        if (!this.textures.exists(textureKey) && !this.pendingTextures.has(textureKey)) {
          // Texture doesn't exist and not pending, add it and create sprite when ready
          this.pendingTextures.add(textureKey);

          this.textures.once('addtexture', (key: string) => {
            if (key === textureKey) {
              // Remove from pending
              this.pendingTextures.delete(textureKey);

              // Create sprite once texture is loaded
              const newImg = this.add.image(a.x, a.y, textureKey);
              newImg.setDepth(6);
              newImg.setInteractive();
              this.editorSprites.set(a.id, newImg);
            }
          });

          // Load texture depending on data source
          const isDataUrl = typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:');
          if (isDataUrl) {
            this.textures.addBase64(textureKey, a.dataUrl);
          } else {
            try {
              this.load.image(textureKey, a.dataUrl);
              // Start the loader if needed; Phaser will auto-start when queueing at runtime
              this.load.start();
            } catch {}
          }
        } else if (this.textures.exists(textureKey)) {
          // Texture exists, create sprite immediately
          img = this.add.image(a.x, a.y, textureKey);
          img.setDepth(6);
          img.setInteractive();
          this.editorSprites.set(a.id, img);
        }
        // If texture is pending, skip for now - it will be created when texture loads
      } else {
        // Sprite exists, just update position
        img.setPosition(a.x, a.y);
      }
    }
  }

  setAssetPreview(preview: { dataUrl: string; width?: number; height?: number } | null) {
    try {
      if (!preview) {
        if (this.ghostSprite) {
          this.ghostSprite.destroy();
          delete (this as any).ghostSprite;
        }
        // Optional: Textur aufräumen
        if (this.ghostTextureKey && this.textures.exists(this.ghostTextureKey)) {
          try { this.textures.remove(this.ghostTextureKey); } catch {}
        }
        delete (this as any).ghostTextureKey;
        return;
      }
      const nextUrl = preview.dataUrl;
      const newKey = `ghost_${Date.now()}_${Math.floor(Math.random()*1000000)}`;
      const prevKey = this.ghostTextureKey;

      const place = () => {
        if (!this.ghostSprite) {
          const img = this.add.image(0, 0, newKey);
          img.setAlpha(0.6);
          img.setDepth(6.5);
          this.ghostSprite = img;
        } else {
          this.ghostSprite.setTexture(newKey);
        }
        try { this.ghostSprite.setVisible(true); } catch {}
        // Terrain-URL merken, damit pointerup anwenden kann
        (this as any)._ghostDataUrl = preview.dataUrl;
        // Setzen der Position auf Tilezentrum in Sicht
        if (this.mapRef) {
          const cx = Math.round((this.cameras.main.worldView.centerX) / this.mapRef.tileWidth) * this.mapRef.tileWidth + this.mapRef.tileWidth / 2;
          const cy = Math.round((this.cameras.main.worldView.centerY) / this.mapRef.tileHeight) * this.mapRef.tileHeight + this.mapRef.tileHeight / 2;
          this.ghostSprite.setPosition(cx, cy);
        }
        // Nach dem Wechsel alte Textur aufräumen
        if (prevKey && prevKey !== newKey && this.textures.exists(prevKey)) {
          try { this.textures.remove(prevKey); } catch {}
        }
        this.ghostTextureKey = newKey;
      };

      if (this.textures.exists(newKey)) {
        place();
      } else {
        // Ghost während des Ladens ausblenden, um „null glTexture" zu vermeiden
        try { this.ghostSprite?.setVisible(false); } catch {}
        this.textures.once('addtexture', (k: string) => { if (k === newKey) place(); });
        if (nextUrl.startsWith('data:')) this.textures.addBase64(newKey, nextUrl);
        else { this.load.image(newKey, nextUrl); this.load.start(); }
      }
    } catch {}
  }

  // Neues Terrain-Painting: benutzt Ghost/Preview wie Objekte, schreibt aber in EditorGround/Walls
  applyTerrainPaint(edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string; attempt?: number }) {
    if (!this.mapRef) return;
    // Ziel-Layer: EditorGround
    const targetLayer = this.editorGround;
    if (!targetLayer) return;
    const map = this.mapRef;
    const tilesetKey = this.ensureTerrainTilesetFor(edit.dataUrl);
    if (!tilesetKey) return;
    const tileset = this.dynamicTilesets.get(tilesetKey) || map.tilesets.find(t => t.name === tilesetKey);
    if (!tileset) {
      const nextAttempt = (edit.attempt ?? 0) + 1;
      if (nextAttempt <= 20) {
        setTimeout(() => this.applyTerrainPaint({ rect: edit.rect, dataUrl: edit.dataUrl, attempt: nextAttempt }), 50);
      }
      return;
    }
    // Sicherstellen, dass Layer Tileset kennt
    try {
      const allTilesets = Array.from(new Set([...(this.mapRef?.tilesets || []), ...this.dynamicTilesets.values()]));
      (targetLayer as any).setTilesets?.(allTilesets);
      (targetLayer as any).tileset = allTilesets;
    } catch {}
    const gid = (tileset as any).firstgid || 1;
    const idx = 0; // Single-tile tileset
    const globalIndex = gid + idx;
    const { startX, startY, endX, endY } = edit.rect;
    const x0 = Math.min(startX, endX);
    const y0 = Math.min(startY, endY);
    const x1 = Math.max(startX, endX);
    const y1 = Math.max(startY, endY);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        try { targetLayer.putTileAt(globalIndex, tx, ty); } catch {}
      }
    }
    this.saveEditorLayers();
  }

  eraseTerrainRect(rect: { startX: number; startY: number; endX: number; endY: number }) {
    if (!this.mapRef || !this.editorGround) return;
    const layer = this.editorGround;
    const { startX, startY, endX, endY } = rect;
    const x0 = Math.min(startX, endX);
    const y0 = Math.min(startY, endY);
    const x1 = Math.max(startX, endX);
    const y1 = Math.max(startY, endY);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        try { layer.removeTileAt(tx, ty); } catch {}
      }
    }
    this.saveEditorLayers();
  }

  private ensureTerrainTilesetFor(dataUrl: string): string | null {
    try {
      if (!this.mapRef) return null;
      const map = this.mapRef;
      // Stabile ID aus URL ableiten
      const simpleKey = dataUrl.replace(/[^a-zA-Z0-9_:\-]/g, '_');
      const tilesetName = `terrain:${simpleKey}`;
      if (this.dynamicTilesets.has(tilesetName) || map.tilesets.find(t => t.name === tilesetName)) {
        return tilesetName;
      }
      // Texture vorbereiten: skaliert auf Tilegröße der Map, 1 Tile groß
      const texKey = `terrain_tex_${simpleKey}`;
      const doAddTileset = () => {
        // firstgid wählen
        let assignedFirstGid = 0;
        try {
          const mapAny = map as any;
          if (!mapAny._nextDynamicFirstGid) {
            const maxGid = Math.max(1, ...map.tilesets.map(t => (t as any).firstgid || 1));
            mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
          }
          assignedFirstGid = mapAny._nextDynamicFirstGid;
          mapAny._nextDynamicFirstGid += 1024;
        } catch {}
        // Raw map data tilesets-Eintrag ergänzen
        try {
          const mapAny = map as any;
          const data = mapAny.data;
          const tex = this.textures.get(texKey);
          const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
          if (data && src) {
            const imgW = (src as any).width || map.tileWidth;
            const imgH = (src as any).height || map.tileHeight;
            const exists = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === tilesetName);
            if (!exists) {
              data.tilesets = data.tilesets || [];
              data.tilesets.push({
                firstgid: assignedFirstGid || 1,
                name: tilesetName,
                image: texKey,
                imagewidth: imgW,
                imageheight: imgH,
                tilewidth: map.tileWidth,
                tileheight: map.tileHeight,
                margin: 0,
                spacing: 0,
                columns: 1,
                tilecount: 1
              });
            }
          }
        } catch {}
        // Push a meta tileset first so addTilesetImage finds the name
        try {
          if (!map.tilesets.find(t => t.name === tilesetName)) {
            const meta = new Phaser.Tilemaps.Tileset(tilesetName, assignedFirstGid || 1, map.tileWidth, map.tileHeight, 0, 0);
            (map.tilesets as any).push(meta);
          }
        } catch {}
        const tileset = map.addTilesetImage(tilesetName, texKey, map.tileWidth, map.tileHeight, 0, 0, assignedFirstGid || undefined as any);
        if (tileset) {
          this.dynamicTilesets.set(tilesetName, tileset);
          try { this.terrainTilesetSources.set(tilesetName, dataUrl); } catch {}
          // Layer Tilesets aktualisieren
          const all = Array.from(new Set([...(map.tilesets || []), ...this.dynamicTilesets.values()]));
          try { (this.editorGround as any)?.setTilesets?.(all); } catch {}
          try { (this.wallsLayer as any)?.setTilesets?.(all); } catch {}
          try { (this.collisionLayer as any)?.setTilesets?.(all); } catch {}
          return tilesetName;
        }
        return null;
      };
      if (this.textures.exists(texKey)) {
        return doAddTileset();
      }
      // Bild laden und auf Canvas-Texture in Map-Tilegröße zeichnen
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tw = map.tileWidth;
        const th = map.tileHeight;
        const ctex = this.textures.createCanvas(texKey, tw, th);
        const ctx = ctex?.getContext();
        if (ctex && ctx) {
          ctx.clearRect(0, 0, tw, th);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high' as any;
          ctx.drawImage(img, 0, 0, tw, th);
          ctex.refresh();
          doAddTileset();
        }
      };
      img.src = dataUrl;
      return tilesetName; // Wird unmittelbar zurückgegeben; tatsächliche Nutzung sollte auf nächsten Paint warten
    } catch {
      return null;
    }
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
    if (!this.mapRef) return;
    const targetLayer = edit.layer === 'Collision' ? this.collisionLayer : edit.layer === 'EditorWalls' ? this.wallsLayer : this.editorGround;
    if (!targetLayer) return;
    
    // Ensure target layer knows all tilesets before painting
    if (targetLayer) {
      const allTilesets = Array.from(this.dynamicTilesets.values());
      allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
      try { (targetLayer as any).setTilesets?.(allTilesets); } catch {}
      try { (targetLayer as any).tileset = allTilesets; } catch {}
    }
    
    // Get the specific tileset
    let tileset = this.dynamicTilesets.get(edit.tilesetKey) || this.mapRef.tilesets.find(ts => ts.name === edit.tilesetKey);
    
    // If tileset not found, try to find it in pending registrations and retry
    if (!tileset && edit.tileIndex >= 0) {
      // Check if it's a pending tileset that needs registration
      const pending = this.pendingTilesetRegistrations?.find(ts => ts.key === edit.tilesetKey);
      if (pending) {
        this.registerTileset(pending);
        
        // Retry after a short delay
        setTimeout(() => {
          this.applyTilePaint(edit);
        }, 200);
        return;
      }
      
      // Tileset not in pending list either. Cannot paint.
      return;
    }
    
    const x0 = Math.min(edit.rect.startX, edit.rect.endX);
    const y0 = Math.min(edit.rect.startY, edit.rect.endY);
    const x1 = Math.max(edit.rect.startX, edit.rect.endX);
    const y1 = Math.max(edit.rect.startY, edit.rect.endY);
    
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (edit.tileIndex < 0) {
          // Erase
          targetLayer.removeTileAt(tx, ty);
        } else if (tileset) {
          // Calculate the global tile index for this tileset
          const globalIndex = tileset.firstgid + edit.tileIndex;
          // Putting tile
          
          // Debug layer information
          if (edit.layer === 'Collision') {
            editorLog('Paint', 'Collision layer state');
          }
          
          try {
            // Additional debug for collision layer
            if (edit.layer === 'Collision') {
              const layerLayer = (targetLayer as any).layer;
              if (layerLayer?.data) {
                editorLog('Paint', 'Attempting putTileAt');
              }
            }
            
            targetLayer.putTileAt(globalIndex, tx, ty);
          } catch (error) {
            if (edit.layer === 'Collision') {
              editorError('Paint', 'Failed to put collision tile', error);
            }
          }
        }
      }
    }
    // Forciere Re-Render des Layers (best effort)
    try { ((targetLayer as any).layer || targetLayer)["dirty"] = true; } catch {}
    try {
      const a = targetLayer.alpha;
      targetLayer.setAlpha(a === 1 ? 0.999 : 1);
      setTimeout(() => { try { targetLayer.setAlpha(1); } catch {} }, 0);
    } catch {}
    // Collision-Physik neu aufbauen und Overlay anzeigen
    if (targetLayer === this.collisionLayer) {
      // Update tilemap collider
      this.ensureCollisionCollider();
      // Im v2-Modus: Kollision-Layer unsichtbar lassen; Overlay nur im Editor setzen
      if (this.v2) {
        try { this.collisionLayer?.setVisible(false); } catch {}
      }
      // Overlay sofort aktualisieren, damit Änderungen ohne Moduswechsel sichtbar sind
      try { if (this.collisionVisible) this.updateCollisionOverlay(); } catch {}
      // Persistiere Kollision serverseitig im v2-Modus (inkrementell)
      try {
        if (this.v2) {
          const base = (window as any).VITE_API_BASE || import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
          const body = JSON.stringify({
            layer: 'collision',
            rect: { x0, y0, x1, y1 },
            erase: edit.tileIndex < 0,
            tileRefId: 1
          });
          fetch(`${base}/maps/${encodeURIComponent(this.currentMapName)}/paint-rect`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body }).catch(()=>{});
        }
      } catch {}
    }
    // Persistenz speichern
    // Save layers after painting
    this.saveEditorLayers();
  }

  private saveEditorLayers() {
    if (!this.mapRef) {
      return;
    }
    const width = this.mapRef.width;
    const height = this.mapRef.height;
    const dumpLayer = (layer?: Phaser.Tilemaps.TilemapLayer, _layerName?: string) => {
      if (!layer) {
        return null;
      }
      
      // Debug layer info removed
      
      const arr: number[] = new Array(width * height).fill(-1);
      let tileCount = 0;
      let errorCount = 0;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          try {
            const tile = layer.getTileAt(x, y);
            const tileIndex = tile ? tile.index : -1;
            arr[y * width + x] = tileIndex;
            if (tileIndex !== -1) tileCount++;
          } catch (e) {
            errorCount++;
            arr[y * width + x] = -1; // Default empty
          }
        }
      }
      
      if (errorCount > 0) {
      }
      
      
      // Special debugging for collision layer removed
      
      return tileCount > 0 ? arr : null;
    };
    try {
      const data = {
        editorGround: dumpLayer(this.editorGround, 'editorGround'),
        editorWalls: dumpLayer(this.wallsLayer, 'editorWalls'),
        collision: dumpLayer(this.collisionLayer, 'collision'),
        w: width,
        h: height,
      };
      // Editor layers saved
      localStorage.setItem('meetropolis.editorLayers', JSON.stringify(data));
      // Server speichern (best-effort)
      let base = (window as any).VITE_API_BASE || import.meta.env.VITE_API_BASE as any;
      if (!base && typeof window !== 'undefined') {
        base = `${window.location.protocol}//${window.location.hostname}:2567`;
      }
      if (!base) base = 'http://localhost:2567';
      // Tilesets (Terrain) miterfassen, damit Reload gelingt
      const terrainTilesets: any[] = [];
      try {
        this.dynamicTilesets.forEach((ts, name) => {
          void ts;
          if (name && name.startsWith('terrain:')) {
            const src = this.terrainTilesetSources.get(name) || '';
            terrainTilesets.push({ key: name, dataUrl: src, tileWidth: this.mapRef!.tileWidth, tileHeight: this.mapRef!.tileHeight, category: 'terrain' });
          }
        });
      } catch {}
      // Only save to server if data is not too large (< 100KB)
      const serverPayload: any = { editorGround: data.editorGround, editorWalls: data.editorWalls, collision: data.collision, tilesets: terrainTilesets };
      const jsonStr = JSON.stringify(serverPayload);
      // Server payload ready
      if (jsonStr.length < 100000) {
        // Saving to server
        fetch(`${base}/maps/${encodeURIComponent(this.currentMapName)}/editor-state`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: jsonStr
        }).then(async (res) => {
          if (res.ok) {
          } else {
            await res.text().catch(() => 'Unknown error');
          }
        }).catch(()=>{ 
        });
      } else {
      }
    } catch (error) {
    }
  }

  private loadEditorLayers() {
    if (!this.mapRef) return;
    try {
      const raw = localStorage.getItem('meetropolis.editorLayers');
      if (!raw) return;
      const data = JSON.parse(raw);
      const storedW = (typeof data?.w === 'number' && data.w > 0) ? data.w : this.mapRef.width;
      const storedH = (typeof data?.h === 'number' && data.h > 0) ? data.h : this.mapRef.height;
      const width = Math.min(this.mapRef.width, storedW);
      const height = Math.min(this.mapRef.height, storedH);
      const applyArr = (arr: number[] | null | undefined, layer?: Phaser.Tilemaps.TilemapLayer, layerName?: 'editorGround' | 'editorWalls' | 'collision') => {
        if (!arr || !layer) return;
        // Ensure tilesets and layer dimensions for collision layer
        if (layerName === 'collision' && this.mapRef) {
          // Ensure collision layer knows about all tilesets
          const allTilesets = Array.from(this.dynamicTilesets.values());
          allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
          (layer as any).setTilesets?.(allTilesets);

          // Fix data dimensions if needed
          const layerData = (layer as any).layer;
          if (layerData?.data) {
            const expectedRows = this.mapRef.height;
            while (layerData.data.length < expectedRows) {
              const newRow = new Array(this.mapRef.width);
              for (let x = 0; x < this.mapRef.width; x++) {
                newRow[x] = new Phaser.Tilemaps.Tile(
                  layerData,
                  -1,
                  x,
                  layerData.data.length,
                  this.mapRef.tileWidth,
                  this.mapRef.tileHeight,
                  this.mapRef.tileWidth,
                  this.mapRef.tileHeight
                );
              }
              layerData.data.push(newRow);
            }
            layerData.height = expectedRows;
          }
        }

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const stride = storedW!;
            const idx = arr[y * stride + x];
            if (typeof idx === 'number' && idx >= 0) {
              try {
                layer.putTileAt(idx, x, y);
              } catch {}
            }
          }
        }
      };
      applyArr(data?.editorGround, this.editorGround, 'editorGround');
      applyArr(data?.editorWalls, this.wallsLayer, 'editorWalls');
      applyArr(data?.collision, this.collisionLayer, 'collision');
      if (data?.collision) this.rebuildStaticColliders();
    } catch {}
  }

  reloadEditorLayers() {
    // externe Bridge-API ruft diese Methode, um LocalStorage-Layer erneut zu laden
    try { this.loadEditorLayers(); } catch {}
    try { this.updateCollisionOverlay(); } catch {}
  }


  async fetchAndApplyServerLayers() {
    try {
      const base = (window as any).VITE_API_BASE || import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
      const res = await fetch(`${base}/maps/${encodeURIComponent(this.currentMapName)}/editor-state`, { credentials: 'include' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      // Tilesets vom Server registrieren (inkl. dynamischer Terrain-Tilesets)
      try {
        const arr = Array.isArray((data as any)?.tilesets) ? (data as any).tilesets : [];
        for (const ts of arr) {
          if (ts && ts.key && ts.dataUrl && ts.tileWidth && ts.tileHeight) {
            this.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: (ts as any).margin ?? 0, spacing: (ts as any).spacing ?? 0 });
            if (typeof ts.key === 'string' && typeof ts.dataUrl === 'string' && ts.key.startsWith('terrain:')) {
              this.terrainTilesetSources.set(ts.key, ts.dataUrl);
            }
          }
        }
        // Spiegel in LocalStorage damit Bridge mergen kann
        try { localStorage.setItem('meetropolis.tilesets', JSON.stringify(arr)); } catch {}
      } catch {}
      // Apply background color from server if present
      try {
        const bg = typeof data?.backgroundColor === 'string' ? data.backgroundColor : null;
        if (bg) {
          this.cameras.main.setBackgroundColor(bg);
          try { localStorage.setItem('meetropolis.backgroundColor', bg); } catch {}
        }
      } catch {}
      if (data?.collision) {
        const collisionTiles = data.collision.filter((t: number) => t !== -1).length;
        editorLog('Load', `Received from server: ${collisionTiles} collision tiles`);
      }
      // Zones vom Server anwenden (Overlay + LocalStorage spiegeln)
      try {
        const zones = Array.isArray(data?.zones) ? data.zones.map((z: any) => {
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
        if (zones.length > 0) {
          try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
          try { this.setZoneOverlay(zones); } catch {}
        }
      } catch {}
      
      if (!this.mapRef) return;
      const storedW = this.mapRef.width;
      const width = this.mapRef.width;
      const height = this.mapRef.height;
      
      const applyArr = (arr: number[] | null | undefined, layer?: Phaser.Tilemaps.TilemapLayer, layerName?: 'editorGround' | 'editorWalls' | 'collision') => {
        if (!arr || !layer) {
          return;
        }
        if (layerName === 'collision') {
          editorLog('Load', `Applying collision: ${arr.length} tiles to ${width}x${height} layer`);
          
          // CRITICAL: Ensure collision layer has all tilesets before applying tiles
          const allTilesets = Array.from(this.dynamicTilesets.values());
          allTilesets.push(...this.mapRef!.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
          (layer as any).setTilesets(allTilesets);
          
          // Check layer dimensions and fix if needed
          const layerData = (layer as any).layer;
          if (layerData?.data) {
            editorLog('Load', `Collision layer actual size: ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
            
            // Fix data array if it's too small (same fix as in create)
            const expectedRows = this.mapRef!.height;
            const actualRows = layerData.data.length;
            
            if (actualRows < expectedRows) {
              editorLog('Load', `Fixing collision layer dimensions again: ${actualRows} rows -> ${expectedRows} rows`);
              
              while (layerData.data.length < expectedRows) {
                const newRow = new Array(this.mapRef!.width);
                for (let x = 0; x < this.mapRef!.width; x++) {
                  newRow[x] = new Phaser.Tilemaps.Tile(
                    layerData,
                    -1,
                    x,
                    layerData.data.length,
                    this.mapRef!.tileWidth,
                    this.mapRef!.tileHeight,
                    this.mapRef!.tileWidth,
                    this.mapRef!.tileHeight
                  );
                }
                layerData.data.push(newRow);
              }
              layerData.height = expectedRows;
              editorLog('Load', `Fixed collision layer to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
            }
          }
        }
        let appliedCount = 0;
        let validTileCount = 0;
        
        // Count valid tiles first
        for (const idx of arr) {
          if (typeof idx === 'number' && idx >= 0) validTileCount++;
        }
        if (layerName === 'collision') {
          editorLog('Load', `Found ${validTileCount} valid collision tiles`);
        }
        
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = arr[y * storedW + x];
            if (typeof idx === 'number' && idx >= 0) {
              try {
                layer.putTileAt(idx, x, y);
                appliedCount++;
              } catch (e) {
                if (layerName === 'collision' && appliedCount === 0) {
                  editorError('Load', `First collision tile failed at ${x},${y} with index ${idx}`, e);
                }
              }
            }
          }
        }
        
        if (layerName === 'collision') {
          editorLog('Load', `Applied ${appliedCount} collision tiles`);
        }
      };
      
      applyArr(data?.editorGround, this.editorGround, 'editorGround');
      applyArr(data?.editorWalls, this.wallsLayer, 'editorWalls');
      applyArr(data?.collision, this.collisionLayer, 'collision');
      if (data?.collision) this.rebuildStaticColliders();
      // Ensure overlay reflects the latest data if visibility is on
      if (this.collisionVisible) this.updateCollisionOverlay();

      // Apply persisted editor assets from server state if present
      try {
        if (Array.isArray((data as any)?.assets)) {
          this.setEditorAssets((data as any).assets);
        }
      } catch {}
    } catch (e) {
      editorError('Load', 'Failed to fetch/apply server layers', e);
    }
  }

  private rebuildStaticColliders() {
    try {
      // Alte entfernen
      if (this.staticColliders) {
        this.staticColliders.clear(true, true);
      }
      if (!this.collisionLayer) return;
      const layer: any = this.collisionLayer;
      const map = this.mapRef!;
      const data = (layer as any)?.layer?.data as Phaser.Tilemaps.Tile[][] | undefined;
      if (!data) return;
      if (!this.staticColliders) this.staticColliders = this.physics.add.staticGroup();
      for (let row = 0; row < data.length; row++) {
        const rowArr = data[row];
        if (!Array.isArray(rowArr)) continue;
        for (let col = 0; col < rowArr.length; col++) {
          const tile = rowArr[col];
          if (tile && tile.index !== -1) {
            const x = col * map.tileWidth + map.tileWidth / 2;
            const y = row * map.tileHeight + map.tileHeight / 2;
            const body = this.add.rectangle(x, y, map.tileWidth, map.tileHeight, 0x000000, 0);
            this.physics.add.existing(body, true);
            // Refresh static body to sync with physics world
            try { (body as any).body?.refreshBody?.(); } catch {}
            this.staticColliders.add(body);
          }
        }
      }
      // Keine Hero-zu-Static-Kollision registrieren (nur Tilemap-Collider nutzen)
    } catch {}
  }

  registerTileset(ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) {
    const nameForTileset = (() => {
      const k = ts.key || '';
      if (!k || k.length > 64 || k.startsWith('data:') || k.includes('data:image')) {
        return `tileset-${Date.now()}`;
      }
      return k;
    })();
    try { (window as any).DEBUG_LOGS && console.debug('[ASSETS_DBG][Scene] registerTileset', { key: nameForTileset, url: ts.dataUrl?.slice?.(0, 32) || typeof ts.dataUrl, tw: ts.tileWidth, th: ts.tileHeight, m: ts.margin ?? 0, s: ts.spacing ?? 0 }); } catch {}
    if (!this.mapRef || !this.game || !(this.game as any).renderer) return;
    
    // Check if tileset already exists in map
    const existingTileset = this.mapRef.tilesets.find(t => t.name === nameForTileset);
    if (existingTileset) {
      this.dynamicTilesets.set(nameForTileset, existingTileset);
      return;
    }
    
    // Verhindere doppelte Registrierung
    try { if (this.dynamicTilesets.has(ts.key)) return; } catch {}
    // Textur registrieren
    if (!this.textures.exists(ts.key)) {
      // Wenn Key schon existiert, generiere einen stabilen, kollisionsfreien Key
      let key = nameForTileset;
      while (this.textures.exists(key)) {
        key = `${nameForTileset}-${Date.now()}`;
      }
      const safeKey = key;
      // add texture and hook once it's available
      this.textures.once('addtexture', (key: string) => {
        try { (window as any).DEBUG_LOGS && console.debug('[ASSETS_DBG][Scene] addtexture event', { key, safeKey }); } catch {}
        if (key === safeKey && this.mapRef) {
          let tileset: Phaser.Tilemaps.Tileset | null = null;
          // Tileset zur Map hinzufügen nachdem die Textur geladen wurde
          try {
            // Optional: bei Tilegrößen-Mismatch zur Mapgröße skalieren
            let textureKeyForMap = safeKey;
            let tileWForMap = ts.tileWidth;
            let tileHForMap = ts.tileHeight;
            try {
              const map = this.mapRef;
              const tex = this.textures.get(safeKey);
              const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
              if (map && src && (ts.tileWidth !== map.tileWidth || ts.tileHeight !== map.tileHeight)) {
                const sx = map.tileWidth / ts.tileWidth;
                const sy = map.tileHeight / ts.tileHeight;
                const cw = Math.max(1, Math.round((src as any).width * sx));
                const ch = Math.max(1, Math.round((src as any).height * sy));
                const scaledKey = `${safeKey}__scaled_${map.tileWidth}x${map.tileHeight}`;
                if (!this.textures.exists(scaledKey)) {
                  const ctex = this.textures.createCanvas(scaledKey, cw, ch);
                  const ctx = ctex?.getContext();
                  if (ctex && ctx) {
                    ctx.clearRect(0, 0, cw, ch);
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high' as any;
                    ctx.drawImage(src as any, 0, 0, cw, ch);
                    ctex.refresh();
                  }
                }
                if (this.textures.exists(scaledKey)) {
                  textureKeyForMap = scaledKey;
                  tileWForMap = map.tileWidth;
                  tileHForMap = map.tileHeight;
                }
              }
            } catch {}
            // Pre-validate tile multiple against source image to avoid Phaser error
            try {
              const margin = ts.margin ?? 0;
              const spacing = ts.spacing ?? 0;
              const imgW = (src as any)?.width || 0;
              const imgH = (src as any)?.height || 0;
              const fitsW = imgW > 0 ? ((imgW - margin + spacing) % (tileWForMap + spacing) === 0) : true;
              const fitsH = imgH > 0 ? ((imgH - margin + spacing) % (tileHForMap + spacing) === 0) : true;
              if (!fitsW || !fitsH) {
                try { (window as any).DEBUG_LOGS && console.debug('[ASSETS_DBG][Scene] skip tileset (non-multiple area)', { key: ts.key, imgW, imgH, tileWForMap, tileHForMap, margin, spacing }); } catch {}
                return;
              }
            } catch {}
            // Check if a tileset with intended name already exists
            const existingTileset = this.mapRef.tilesets.find(t => t.name === nameForTileset);
            
            if (existingTileset) {
              // Use existing tileset
              tileset = existingTileset;
              this.dynamicTilesets.set(nameForTileset, tileset);
              editorLog('Tileset', `Using existing tileset ${existingTileset.name} for ${nameForTileset}`);
            } else {
              // Create new tileset
              try {
                // Name: ts.key (uuid:...); Texture-Key: textureKeyForMap
                // Ensure a metadata Tileset exists on the map so addTilesetImage doesn't warn
                let assignedFirstGid = 0;
                try {
                  const mapAny = this.mapRef as any;
                  if (!mapAny._nextDynamicFirstGid) {
                    const maxGid = Math.max(1, ...this.mapRef.tilesets.map(t => (t as any).firstgid || 1));
                    mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
                  }
                  assignedFirstGid = mapAny._nextDynamicFirstGid;
                  mapAny._nextDynamicFirstGid += 1024;
                } catch {}
                // Ensure raw map data knows this tileset (so addTilesetImage won't warn)
                try {
                  const mapAny = this.mapRef as any;
                  const data = mapAny.data;
                  const tex = this.textures.get(textureKeyForMap);
                  const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
                  if (data && src) {
                    const margin = ts.margin ?? 0;
                    const spacing = ts.spacing ?? 0;
                    const imgW = (src as any).width || 0;
                    const imgH = (src as any).height || 0;
                    const cols = Math.max(1, Math.floor((imgW - margin + spacing) / (tileWForMap + spacing)));
                    const rows = Math.max(1, Math.floor((imgH - margin + spacing) / (tileHForMap + spacing)));
                    const tilecount = Math.max(0, cols * rows);
                        const existsInData = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === nameForTileset);
                    if (!existsInData) {
                      data.tilesets = data.tilesets || [];
                      data.tilesets.push({
                        firstgid: assignedFirstGid || 1,
                        source: undefined,
                            name: nameForTileset,
                        image: textureKeyForMap,
                        imagewidth: imgW,
                        imageheight: imgH,
                        tilewidth: tileWForMap,
                        tileheight: tileHForMap,
                        margin,
                        spacing,
                        columns: cols,
                        tilecount
                      });
                    }
                  }
                } catch {}
                    // Ensure meta tileset entry exists before addTilesetImage to avoid Phaser warning
                    try {
                      if (!this.mapRef.tilesets.find(t => t.name === nameForTileset)) {
                        const meta = new Phaser.Tilemaps.Tileset(nameForTileset, assignedFirstGid || 1, tileWForMap, tileHForMap, ts.margin ?? 0, ts.spacing ?? 0);
                        (this.mapRef.tilesets as any).push(meta);
                      }
                    } catch {}
                    tileset = this.mapRef.addTilesetImage(nameForTileset, textureKeyForMap, tileWForMap, tileHForMap, ts.margin ?? 0, ts.spacing ?? 0, assignedFirstGid || undefined as any);
                if (tileset) {
                  // Ensure the tileset is present in map tilesets list
                  try {
                    if (!this.mapRef.tilesets.find(t => t.name === tileset!.name)) {
                      (this.mapRef.tilesets as any).push(tileset);
                    }
                  } catch {}
                      this.dynamicTilesets.set(nameForTileset, tileset);
                      editorLog('Tileset', `Successfully added tileset ${nameForTileset}`);
                }
              } catch (err) {
                editorLog('Tileset', `Failed to create tileset ${safeKey}:`, err);
                // Don't throw - just log and continue
              }
            }
            
            if (tileset) {
              // Update all editor layers to include the new tileset
              const allTilesets = Array.from(this.dynamicTilesets.values());
              const extra = this.mapRef ? this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)) : [] as Phaser.Tilemaps.Tileset[];
              allTilesets.push(...extra);
              
              if (this.editorGround) {
                try { (this.editorGround as any).setTilesets?.(allTilesets); } catch {}
                try { (this.editorGround as any).tileset = allTilesets; } catch {}
              }
              if (this.wallsLayer) {
                try { (this.wallsLayer as any).setTilesets?.(allTilesets); } catch {}
                try { (this.wallsLayer as any).tileset = allTilesets; } catch {}
              }
              if (this.collisionLayer) {
                (this.collisionLayer as any).setTilesets(allTilesets);
              }
              
              // Create layer if it doesn't exist
              if (!this.editorGround && this.mapRef) {
                try {
                  const tmp = this.mapRef.createBlankLayer('EditorGround', tileset, 0, 0, this.mapRef.width, this.mapRef.height, this.mapRef.tileWidth, this.mapRef.tileHeight);
                  this.editorGround = tmp as any;
                  if (this.editorGround) this.editorGround.setDepth(1);
                } catch {}
              }
            }
          } catch (error) {
            editorLog('Tileset', `Failed to add tileset ${safeKey}:`, error);
            return;
          }
        }
      });
      // Load image correctly depending on source type
      const isDataUrl = typeof ts.dataUrl === 'string' && ts.dataUrl.startsWith('data:');
      if (isDataUrl) {
        this.textures.addBase64(safeKey, ts.dataUrl);
      } else {
        try {
          this.load.image(safeKey, ts.dataUrl);
          this.load.start();
        } catch {}
      }
    } else {
      // Textur existiert bereits
      try {
        // Name: ts.key (uuid:...); Texture-Key: ts.key
        // Assign a unique firstgid and make sure map data/meta are populated
        let assignedFirstGid = 0;
        try {
          const mapAny = this.mapRef as any;
          if (!mapAny._nextDynamicFirstGid) {
            const maxGid = Math.max(1, ...this.mapRef.tilesets.map(t => (t as any).firstgid || 1));
            mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
          }
          assignedFirstGid = mapAny._nextDynamicFirstGid;
          mapAny._nextDynamicFirstGid += 1024;
        } catch {}
        // Update raw map data tilesets
        try {
          const mapAny = this.mapRef as any;
          const data = mapAny.data;
          const tex = this.textures.get(ts.key);
          const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
          if (data && src) {
            const margin = ts.margin ?? 0;
            const spacing = ts.spacing ?? 0;
            const imgW = (src as any).width || 0;
            const imgH = (src as any).height || 0;
            const cols = Math.max(1, Math.floor((imgW - margin + spacing) / ((ts.tileWidth || 16) + spacing)));
            const rows = Math.max(1, Math.floor((imgH - margin + spacing) / ((ts.tileHeight || 16) + spacing)));
            const tilecount = Math.max(0, cols * rows);
            const existsInData = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === ts.key);
            if (!existsInData) {
              data.tilesets = data.tilesets || [];
              data.tilesets.push({
                firstgid: assignedFirstGid || 1,
                source: undefined,
                name: ts.key,
                image: ts.key,
                imagewidth: imgW,
                imageheight: imgH,
                tilewidth: ts.tileWidth,
                tileheight: ts.tileHeight,
                margin,
                spacing,
                columns: cols,
                tilecount
              });
            }
          }
        } catch {}
        // Ensure meta tileset exists with name
        try {
          if (!this.mapRef.tilesets.find(t => t.name === ts.key)) {
            const meta = new Phaser.Tilemaps.Tileset(ts.key, assignedFirstGid || 1, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
            (this.mapRef.tilesets as any).push(meta);
          }
        } catch {}
        const tileset = this.mapRef.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0, assignedFirstGid || undefined as any);
        if (tileset) {
          this.dynamicTilesets.set(ts.key, tileset);
          // Update all editor layers to include the tileset
          const allTilesets = Array.from(this.dynamicTilesets.values());
          allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
          if (this.editorGround) {
            try { (this.editorGround as any).setTilesets?.(allTilesets); } catch {}
            try { (this.editorGround as any).tileset = allTilesets; } catch {}
          }
          if (this.wallsLayer) {
            try { (this.wallsLayer as any).setTilesets?.(allTilesets); } catch {}
            try { (this.wallsLayer as any).tileset = allTilesets; } catch {}
          }
          if (this.collisionLayer) {
            (this.collisionLayer as any).setTilesets(allTilesets);
          }
        }
      } catch (error) {
        editorLog('Tileset', `Failed to add existing tileset ${ts.key}:`, error);
      }
    }
  }

  setCollisionVisible(visible: boolean) {
    editorLog('Visibility', `Setting collision visibility to ${visible}`);
    this.collisionVisible = !!visible;
    this.updateCollisionOverlay();
    // Store visibility state
    try {
      localStorage.setItem('meetropolis.collisionVisible', visible.toString());
    } catch {}
  }

  private updateCollisionOverlay() {
    if (!this.mapRef) return;
    this.collisionOverlay?.destroy();
    if (!this.collisionVisible || !this.collisionLayer) {
      editorLog('Visibility', `Not showing collision overlay: visible=${this.collisionVisible}, hasLayer=${!!this.collisionLayer}`);
      return;
    }
    const g = this.add.graphics();
    g.fillStyle(0xff4757, 0.18);
    g.lineStyle(1, 0xff4757, 0.8);
    const layer: any = this.collisionLayer;
    const data = (layer as any)?.layer?.data as Phaser.Tilemaps.Tile[][] | undefined;
    if (data) {
      let tileCount = 0;
      for (let y = 0; y < data.length; y++) {
        const row = data[y];
        if (!row) continue;
        for (let x = 0; x < row.length; x++) {
          const t = row[x];
          if (t && t.index !== -1) {
            const px = x * this.mapRef.tileWidth;
            const py = y * this.mapRef.tileHeight;
            g.fillRect(px, py, this.mapRef.tileWidth, this.mapRef.tileHeight);
            g.strokeRect(px, py, this.mapRef.tileWidth, this.mapRef.tileHeight);
            tileCount++;
          }
        }
      }
      editorLog('Visibility', `Collision overlay created with ${tileCount} collision tiles`);
    }
    g.setDepth(8);
    this.collisionOverlay = g;
  }
  
  setBubbleMembers(members: Set<string>) {
    try {
      // Dynamischer Import, um Zirkularimporte zu vermeiden
      (async () => {
        try {
          const mod: any = await import('../../lib/avEvents');
          mod.emitBubbleMembers(Array.from(members));
        } catch {}
      })();
    } catch {}
    // setBubbleMembers called
    
    // Clear existing bubble outlines
    for (const outline of this.bubbleOutlines.values()) {
      outline.destroy();
    }
    this.bubbleOutlines.clear();
    
    // We don't have access to local player ID here, but we can check if any remote is in bubble
    // The local player bubble effect should be handled differently
    
    // Create bubble outlines for remote members
    for (const id of members) {
      const sprite = this.remotes.get(id);
      if (sprite) {
        const g = this.add.graphics();
        g.setDepth(9);
        this.bubbleOutlines.set(id, g);
        // Start animation update
        const updateFunc = () => {
          if (this.bubbleOutlines.has(id)) {
            this.updateBubbleOutline(id, sprite);
          }
        };
        this.time.addEvent({
          delay: 50,
          callback: updateFunc,
          loop: true
        });
      }
    }
    
    // Also check if local hero should have bubble (we'll pass a special marker)
    if (members.has('__local__')) {
      const g = this.add.graphics();
      g.setDepth(9);
      this.bubbleOutlines.set('local', g);
      const updateFunc = () => {
        if (this.bubbleOutlines.has('local')) {
          this.updateBubbleOutline('local', this.hero);
        }
      };
      this.time.addEvent({
        delay: 50,
        callback: updateFunc,
        loop: true
      });
    }
  }
  
  private updateBubbleOutline(id: string, sprite: Phaser.GameObjects.Sprite) {
    const g = this.bubbleOutlines.get(id);
    if (!g) return;
    
    g.clear();
    
    // Draw bubble effect
    const x = sprite.x;
    const y = sprite.y;
    const radius = 20;
    const color = 0x00ffff;
    const alpha = 0.25;
    
    g.lineStyle(2, color, 0.9);
    g.strokeCircle(x, y, radius);
    
    g.fillStyle(color, alpha);
    g.fillCircle(x, y, radius);
  }
  
  private createNameLabel(name: string, playerId?: string): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    
    // Background for name
    const bg = this.add.graphics();
    const paddingX = 10;
    const paddingY = 6;
    const textStyle = { 
      fontSize: '16px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ffffff',
      fontStyle: 'normal',
      fontWeight: '500'
    };
    const text = this.add.text(0, 0, name, textStyle);
    try { text.setResolution((window as any).devicePixelRatio || 2); } catch {}
    try { (text as any).setPadding?.(0, 0, 0, 1); } catch {}
    text.setOrigin(0.5, 0.5);
    
    const width = text.width + paddingX * 2;
    const height = text.height + paddingY * 2;
    
    // Store references for animation
    (container as any).bg = bg;
    (container as any).text = text;
    (container as any).playerId = playerId;
    (container as any).width = width;
    (container as any).height = height;
    (container as any).paddingX = paddingX;
    (container as any).paddingY = paddingY;
    
    // Initial draw
    this.drawNameLabel(container, false);
    
    container.add(bg);
    container.add(text);
    container.setDepth(12); // Above sprites
    try { this.labelLayer?.add(container); } catch {}
    
    return container;
  }
  
  private drawNameLabel(container: Phaser.GameObjects.Container, isSpeaking: boolean) {
    const bg = (container as any).bg as Phaser.GameObjects.Graphics;
    const width = (container as any).width;
    const height = (container as any).height;
    
    bg.clear();
    
    if (isSpeaking) {
      // Speaking state - cyan border with glow
      const w = Math.round(width);
      const h = Math.round(height);
      const rx = -Math.floor(w / 2);
      const ry = -Math.floor(h / 2);
      bg.fillStyle(0x111114, 0.85); // Darker background
      bg.fillRoundedRect(rx, ry, w, h, Math.floor(h / 2));
      
      // Cyan border
      bg.lineStyle(1, 0x22d3ee, 1);
      bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
      
      // Add glow effect using multiple strokes
      bg.lineStyle(2, 0x22d3ee, 0.3);
      bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
      bg.lineStyle(3, 0x22d3ee, 0.15);
      bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    } else {
      // Normal state
      const w = Math.round(width);
      const h = Math.round(height);
      const rx = -Math.floor(w / 2);
      const ry = -Math.floor(h / 2);
      bg.fillStyle(0x111114, 0.75); // Dark background matching UI
      bg.fillRoundedRect(rx, ry, w, h, Math.floor(h / 2));
      bg.lineStyle(1, 0xffffff, 0.1); // Subtle border
      bg.strokeRoundedRect(rx, ry, w, h, Math.floor(h / 2));
    }
  }
  
  private updateNameLabel(container: Phaser.GameObjects.Container, x: number, y: number) {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const screenX = (x - view.x) * cam.zoom;
    const screenY = (y - view.y) * cam.zoom;
    // Vertikaler Abstand relativ zur Zoomstufe: Avatar-Höhe ~24px in Weltkoordinaten
    const avatarWorldHeight = 24;
    const baseGap = 6; // zusätzlicher Abstand zum Kopf
    const offsetY = (avatarWorldHeight / 2 + baseGap) * cam.zoom;
    container.setPosition(Math.round(screenX), Math.round(screenY - offsetY));
  }
  
  setHeroName(name: string) {
    if (this.heroNameLabel) {
      this.heroNameLabel.destroy();
    }
    this.heroNameLabel = this.createNameLabel(name, 'local');
    this.updateNameLabel(this.heroNameLabel, this.hero.x, this.hero.y);
  }
  
  updateSpeakingStates(speakingIds: Set<string>) {
    // Update all name labels with speaking state
    this.nameLabels.forEach((label, id) => {
      const isSpeaking = speakingIds.has(id);
      this.drawNameLabel(label, isSpeaking);
    });
    
    // Update hero label if local player is speaking
    if (this.heroNameLabel && speakingIds.has('local')) {
      this.drawNameLabel(this.heroNameLabel, true);
    } else if (this.heroNameLabel) {
      this.drawNameLabel(this.heroNameLabel, false);
    }
  }

  setBackgroundColor(hex: string) {
    try { this.cameras.main.setBackgroundColor(hex); } catch {}
  }

  private async loadVisibleChunks(layerName: 'ground' | 'walls' | 'collision') {
    if (!this.v2 || !this.mapRef) return;
    const cam = this.cameras.main;
    const tileW = this.mapRef.tileWidth;
    const tileH = this.mapRef.tileHeight;
    const cs = this.v2.chunkSize;
    const x0 = Math.max(0, Math.floor(cam.worldView.x / tileW));
    const y0 = Math.max(0, Math.floor(cam.worldView.y / tileH));
    const x1 = Math.min(this.mapRef.width - 1, Math.floor((cam.worldView.x + cam.worldView.width) / tileW));
    const y1 = Math.min(this.mapRef.height - 1, Math.floor((cam.worldView.y + cam.worldView.height) / tileH));
    const cx0 = Math.floor(x0 / cs);
    const cy0 = Math.floor(y0 / cs);
    const cx1 = Math.floor(x1 / cs);
    const cy1 = Math.floor(y1 / cs);
    const keys: string[] = [];
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = `${cx}:${cy}`;
      if (!this.loadedChunks.has(`${layerName}:${k}`)) keys.push(k);
    }
    if (keys.length === 0) return;
    const chunks = await fetchChunks('office', layerName, keys);
    const updates = Object.entries(chunks).map(([key, val]) => ({ key, version: val.version, encoding: val.encoding, data: val.data }));
    this.applyChunkUpdates(layerName, updates);
  }

  private applyChunkUpdates(layerName: 'ground' | 'walls' | 'collision', updates: Array<{ key: string; version: number; encoding: string; data: string }>) {
    if (!this.v2 || !this.mapRef) return;
    const layer = layerName === 'collision' ? this.collisionLayer : (layerName === 'walls' ? this.wallsLayer : this.editorGround);
    if (!layer) return;
    const cs = this.v2.chunkSize;
    const total = cs * cs;
    for (const u of updates) {
      const [xs, ys] = u.key.split(':');
      const cx = Number(xs), cy = Number(ys);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const arr = decodeRLE(u.data, total);
      for (let i = 0; i < total; i++) {
        const vx = i % cs;
        const vy = Math.floor(i / cs);
        const gx = cx * cs + vx;
        const gy = cy * cs + vy;
        if (gx >= this.mapRef.width || gy >= this.mapRef.height) continue;
        if (layerName === 'collision') {
          // Setze eine Dummy-Kachel für Kollisionen (Layer bleibt unsichtbar)
          const v = arr[i] !== 0;
          if (v) {
            try { layer.putTileAt(1, gx, gy); } catch {}
          } else {
            try { layer.removeTileAt(gx, gy); } catch {}
          }
        } else {
          const gid = tileRefIdToGid(arr[i] | 0, this.v2.firstGids);
          if (gid < 0) layer.removeTileAt(gx, gy);
          else layer.putTileAt(gid, gx, gy);
        }
      }
      this.loadedChunks.add(`${layerName}:${cx}:${cy}`);
    }
    if (layerName === 'collision') {
      this.ensureCollisionCollider();
      if (this.v2) {
        try { this.collisionLayer?.setVisible(false); } catch {}
      }
    }
  }

  override update(time: number, delta: number) {
    super.update(time, delta);
    if (this.v2) {
      // Erzwinge Unsichtbarkeit des Kollision-Layers außerhalb des Editors
      try { this.collisionLayer?.setVisible(this.editorMode === true); } catch {}
      // throttle chunk loading
      if (!this._chunkThrottle || time - this._chunkThrottle > 250) {
        this._chunkThrottle = time;
        this.loadVisibleChunks('ground');
        this.loadVisibleChunks('walls');
        this.loadVisibleChunks('collision');
      }
    }
  }
  private _chunkThrottle = 0;

  private ensureCollisionCollider() {
    try {
      if (!this.collisionLayer || !this.hero) return;
      // Mark all tiles (index != -1) as colliding
      try { this.collisionLayer.setCollisionByExclusion([-1], true); } catch {}
      // Recreate collider to be safe
      try { this.heroVsTilesCollider?.destroy(); } catch {}
      this.heroVsTilesCollider = this.physics.add.collider(this.hero, this.collisionLayer);
    } catch {}
  }
}
