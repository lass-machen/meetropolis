import Phaser from 'phaser';
import { gameBridge, type SceneApi } from '../bridge';
import { editorLog, editorError } from '../../lib/editorLog';

export class MainScene extends Phaser.Scene implements SceneApi {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private desiredPos: { x: number; y: number } | null = null;
  private zoneG?: Phaser.GameObjects.Graphics;
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
  private pendingTilesetRegistrations?: any[];
  private doNotDisturb = false;
  constructor() {
    super('Main');
  }

  create() {
    const map = this.make.tilemap({ key: 'office' });
    this.mapRef = map;

    // Binde Tilesets
    const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
    const furniture = map.addTilesetImage('furniture_tiles', 'furniture_tiles', 16, 16, 0, 0);
    const decor = map.addTilesetImage('decor_tiles', 'decor_tiles', 16, 16, 0, 0);
    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);
    
    // Try to add any missing tilesets referenced in the map data
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

    if (!office) {
      // Tileset office_tiles not found
    }

    // Tile-Layer erstellen (verwende verfügbare Tilesets)
    const available = [office, furniture, decor, collision].filter(Boolean) as Phaser.Tilemaps.Tileset[];
    const ground = available.length ? map.createLayer('Ground', available, 0, 0) : undefined;
    const walls = available.length ? map.createLayer('Walls', available, 0, 0) : undefined;
    // Layers are created conditionally based on available tilesets

    ground?.setDepth(0);
    walls?.setDepth(5);

    // Collision-Layer einlesen und statische Physik-Körper erzeugen
    let collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined;
    try {
      const created = map.createLayer('Collision', available, 0, 0);
      collisionLayer = created ?? undefined;
      
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

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    // Get initial position from global window object (set by App.tsx after DB load)
    const initialPos = (window as any).initialPlayerPosition || { x: 80, y: 120 };
    this.hero = this.physics.add.sprite(initialPos.x, initialPos.y, 'hero_walk_down', 0);
    this.hero.setCollideWorldBounds(true);
    this.hero.setDepth(10);
    if (staticColliders) this.physics.add.collider(this.hero, staticColliders);
    
    // Create name label for hero (will be set later when we get the actual name)
    this.heroNameLabel = this.createNameLabel('Loading...', 'local');
    this.updateNameLabel(this.heroNameLabel, this.hero.x, this.hero.y);

    this.anims.create({ key: 'walk_down', frames: this.anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_up', frames: this.anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_left', frames: this.anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_right', frames: this.anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });

    const cursors = this.input.keyboard!.createCursorKeys();
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
    
    // Track current direction
    let currentDirection: 'up' | 'down' | 'left' | 'right' = 'down';
    
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      const speed = 80;
      const body = this.hero.body;
      body.setVelocity(0);
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
      } else {
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
        }
      }

      gameBridge.onLocalMove({ x: this.hero.x, y: this.hero.y, direction: currentDirection });
      
      // Update hero name label position
      if (this.heroNameLabel) {
        this.updateNameLabel(this.heroNameLabel, this.hero.x, this.hero.y);
      }
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
      
      if (pointer.rightButtonDown()) {
        // Handle right click on remote sprites
        for (const [id, sprite] of this.remotes) {
          const bounds = sprite.getBounds();
          if (bounds.contains(worldPoint.x, worldPoint.y)) {
            gameBridge.onRightClick({ x: worldPoint.x, y: worldPoint.y });
            
            // Store the clicked player ID for bubble logic
            (gameBridge as any).lastRightClickedPlayer = id;
            break;
          }
        }
        return;
      }
      
      gameBridge.onPointerDown({ x: worldPoint.x, y: worldPoint.y });
      const { tileX, tileY } = toTile(pointer);
      gameBridge.onPointerDownTile({ tileX, tileY });
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      gameBridge.onPointerMoveTile({ tileX, tileY });
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const { tileX, tileY } = toTile(pointer);
      gameBridge.onPointerUpTile({ tileX, tileY });
      this.setSelectionRect(null);
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
    });
    
    // Removed duplicate handler - combined with main pointerdown below
    
    // Disable context menu on canvas
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
      // Always load from server first to ensure consistency
      this.fetchAndApplyServerLayers().then(() => {
        // Don't restore collision visibility here - let App.tsx handle it based on editor state
        // The collision visibility will be set by the useEffect in App.tsx when editor state changes
      }).catch(() => {
        // Fallback to localStorage if server fails
        this.loadEditorLayers();
        
        // Don't restore collision visibility here - let App.tsx handle it based on editor state
        // The collision visibility will be set by the useEffect in App.tsx when editor state changes
      });
    }, 0);

    // Bridge aufräumen, wenn Szene herunterfährt
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch {}
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      try { this.saveEditorLayers(); } catch {}
      try { gameBridge.setSceneApi(null); } catch {}
    });
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up'|'down'|'left'|'right'; prevX?: number; prevY?: number; name?: string }>) {
    for (const [id, p] of Object.entries(players)) {
      let s = this.remotes.get(id);
      if (!s) {
        // Creating new sprite for player
        s = this.add.sprite(p.x, p.y, 'hero_walk_down', 0);
        s.setDepth(10); // Same depth as local hero
        if (this.doNotDisturb) s.setVisible(false);
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
        if (this.doNotDisturb) nameLabel.setVisible(false);
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
      
      // Update transparency if player has DND
      if (p.dnd !== undefined) {
        s.setAlpha(p.dnd ? 0.35 : 1);
        if (nameLabel) {
          nameLabel.setAlpha(p.dnd ? 0.6 : 1);
        }
      }
      
      // Update name label position
      if (nameLabel) {
        this.updateNameLabel(nameLabel, p.x, p.y);
        if (this.doNotDisturb) nameLabel.setVisible(false);
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
        // Always play the animation for movement
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
    // Hide/show remote sprites and name labels
    this.remotes.forEach((sprite) => {
      sprite.setVisible(!this.doNotDisturb);
    });
    this.nameLabels.forEach((label) => {
      label.setVisible(!this.doNotDisturb);
    });
    // Hide bubble outlines as well
    this.bubbleOutlines.forEach((g) => g.setVisible(!this.doNotDisturb));
  }

  setDesiredPosition(pos: { x: number; y: number } | null) {
    this.desiredPos = pos;
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
      
      // Change cursor
      this.input.setDefaultCursor('pointer');
    } else {
      // Reset cursor
      this.input.setDefaultCursor('default');
    }
  }

  setZoneOverlay(polys: { name: string; points: { x: number; y: number }[] }[]) {
    this.zoneG?.destroy();
    const g = this.add.graphics();
    g.lineStyle(2, 0x00ff99, 1);
    g.fillStyle(0x00ff99, 0.18);
    for (const poly of polys) {
      if (!poly.points?.length) continue;
      const pts = poly.points;
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      g.closePath();
      g.fillPath();
      g.strokePath();
    }
    g.setDepth(4);
    this.zoneG = g;
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
          
          // Add texture (this is async)
          this.textures.addBase64(textureKey, a.dataUrl);
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

  setSelectionRect(rect: { x: number; y: number; w: number; h: number } | null) {
    this.selectionG?.destroy();
    if (!rect) return;
    const g = this.add.graphics();
    g.lineStyle(1, 0x22d3ee, 1);
    g.fillStyle(0x22d3ee, 0.12);
    g.fillRect(rect.x, rect.y, rect.w, rect.h);
    g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    g.setDepth(7);
    this.selectionG = g;
  }

  applyTilePaint(edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) {
    if (!this.mapRef) return;
    const targetLayer = edit.layer === 'Collision' ? this.collisionLayer : edit.layer === 'EditorWalls' ? this.wallsLayer : this.editorGround;
    if (!targetLayer) return;
    
    // CRITICAL FIX: Ensure collision layer has all tilesets before painting
    if (edit.layer === 'Collision' && targetLayer) {
      const allTilesets = Array.from(this.dynamicTilesets.values());
      allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
      
      // Direct assignment to ensure tilesets are available
      (targetLayer as any).tileset = allTilesets;
      if ((targetLayer as any).layer) {
        (targetLayer as any).layer.tileset = allTilesets;
        (targetLayer as any).layer.tilesets = allTilesets;
      }
      
      editorLog('Paint', `Updated collision layer with ${allTilesets.length} tilesets`);
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
    // Collision-Physik neu aufbauen
    if (targetLayer === this.collisionLayer) {
      this.rebuildStaticColliders();
      this.updateCollisionOverlay();
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
        base = `${window.location.protocol}//${window.location.hostname}:2568`;
      }
      if (!base) base = 'http://localhost:2568';
      // Only save to server if data is not too large (< 100KB)
      const serverPayload = { editorGround: data.editorGround, editorWalls: data.editorWalls, collision: data.collision };
      const jsonStr = JSON.stringify(serverPayload);
      // Server payload ready
      if (jsonStr.length < 100000) {
        // Saving to server
        fetch(`${base}/maps/office/editor-state`, {
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
      const base = (window as any).VITE_API_BASE || import.meta.env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2568`;
      const res = await fetch(`${base}/maps/office/editor-state`, { credentials: 'include' });
      if (!res.ok) {
        return;
      }
      const data = await res.json();
      if (data?.collision) {
        const collisionTiles = data.collision.filter((t: number) => t !== -1).length;
        editorLog('Load', `Received from server: ${collisionTiles} collision tiles`);
      }
      
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
            this.staticColliders.add(body);
          }
        }
      }
      // Hero-Kollision neu verbinden
      if (this.hero && this.staticColliders) this.physics.add.collider(this.hero, this.staticColliders);
    } catch {}
  }

  registerTileset(ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) {
    if (!this.mapRef || !this.game || !(this.game as any).renderer) return;
    
    // Check if tileset already exists in map
    const existingTileset = this.mapRef.tilesets.find(t => t.name === ts.key);
    if (existingTileset) {
      this.dynamicTilesets.set(ts.key, existingTileset);
      return;
    }
    
    // Textur registrieren
    if (!this.textures.exists(ts.key)) {
      // addBase64 returns a promise when the texture is loaded
      this.textures.once('addtexture', (key: string) => {
        if (key === ts.key && this.mapRef) {
          let tileset: Phaser.Tilemaps.Tileset | null = null;
          // Tileset zur Map hinzufügen nachdem die Textur geladen wurde
          try {
            // Check if a tileset with similar name already exists
            const existingTileset = this.mapRef.tilesets.find(t => 
              t.name === ts.key || 
              t.name.includes('Tileset') || 
              t.image?.key === ts.key
            );
            
            if (existingTileset) {
              // Use existing tileset
              tileset = existingTileset;
              this.dynamicTilesets.set(ts.key, tileset);
              editorLog('Tileset', `Using existing tileset ${existingTileset.name} for ${ts.key}`);
            } else {
              // Create new tileset
              try {
                tileset = this.mapRef.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
                if (tileset) {
                  this.dynamicTilesets.set(ts.key, tileset);
                  editorLog('Tileset', `Successfully added tileset ${ts.key}`);
                }
              } catch (err) {
                editorLog('Tileset', `Failed to create tileset ${ts.key}:`, err);
                // Don't throw - just log and continue
              }
            }
            
            if (tileset) {
              // Update all editor layers to include the new tileset
              const allTilesets = Array.from(this.dynamicTilesets.values());
              const extra = this.mapRef ? this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)) : [] as Phaser.Tilemaps.Tileset[];
              allTilesets.push(...extra);
              
              if (this.editorGround) {
                (this.editorGround as any).tileset = allTilesets;
              }
              if (this.wallsLayer) {
                (this.wallsLayer as any).tileset = allTilesets;
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
            editorLog('Tileset', `Failed to add tileset ${ts.key}:`, error);
            return;
          }
        }
      });
      this.textures.addBase64(ts.key, ts.dataUrl);
    } else {
      // Textur existiert bereits
      try {
        const tileset = this.mapRef.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
        if (tileset) {
          this.dynamicTilesets.set(ts.key, tileset);
          
          // Update all editor layers to include the tileset
          const allTilesets = Array.from(this.dynamicTilesets.values());
          allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
          
          if (this.editorGround) {
            (this.editorGround as any).tileset = allTilesets;
          }
          if (this.wallsLayer) {
            (this.wallsLayer as any).tileset = allTilesets;
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
    
    // Pulsing circle effect
    const time = this.time.now / 1000;
    const pulse = Math.sin(time * 3) * 0.1 + 0.9;
    
    g.lineStyle(3, 0x00d9ff, 0.8);
    g.strokeCircle(x, y - 5, 20 * pulse);
    
    g.lineStyle(2, 0x00d9ff, 0.4);
    g.strokeCircle(x, y - 5, 25 * pulse);
    
    // Add inner glow
    g.fillStyle(0x00d9ff, 0.1);
    g.fillCircle(x, y - 5, 20 * pulse);
  }
  
  private createNameLabel(name: string, playerId?: string): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    
    // Background for name
    const bg = this.add.graphics();
    const padding = 3;
    const textStyle = { 
      fontSize: '9px', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#ffffff',
      fontStyle: 'normal',
      fontWeight: '500'
    };
    const text = this.add.text(0, 0, name, textStyle);
    text.setOrigin(0.5, 0.5);
    
    const width = text.width + padding * 2;
    const height = 14; // Fixed height for consistency
    
    // Store references for animation
    (container as any).bg = bg;
    (container as any).text = text;
    (container as any).playerId = playerId;
    (container as any).width = width;
    (container as any).height = height;
    
    // Initial draw
    this.drawNameLabel(container, false);
    
    container.add(bg);
    container.add(text);
    container.setDepth(12); // Above sprites
    
    return container;
  }
  
  private drawNameLabel(container: Phaser.GameObjects.Container, isSpeaking: boolean) {
    const bg = (container as any).bg as Phaser.GameObjects.Graphics;
    const width = (container as any).width;
    const height = (container as any).height;
    
    bg.clear();
    
    if (isSpeaking) {
      // Speaking state - cyan border with glow
      bg.fillStyle(0x111114, 0.85); // Darker background
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      
      // Cyan border
      bg.lineStyle(1, 0x22d3ee, 1);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      
      // Add glow effect using multiple strokes
      bg.lineStyle(2, 0x22d3ee, 0.3);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      bg.lineStyle(3, 0x22d3ee, 0.15);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    } else {
      // Normal state
      bg.fillStyle(0x111114, 0.75); // Dark background matching UI
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      bg.lineStyle(1, 0xffffff, 0.1); // Subtle border
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, height / 2);
    }
  }
  
  private updateNameLabel(container: Phaser.GameObjects.Container, x: number, y: number) {
    container.setPosition(x, y - 24); // Position above sprite head
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
}
