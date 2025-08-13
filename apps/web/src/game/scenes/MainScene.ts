import Phaser from 'phaser';
import { gameBridge, type SceneApi } from '../bridge';

export class MainScene extends Phaser.Scene implements SceneApi {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private desiredPos: { x: number; y: number } | null = null;
  private zoneG?: Phaser.GameObjects.Graphics;
  private editorSprites: Map<string, Phaser.GameObjects.Image> = new Map();
  private selectionG?: Phaser.GameObjects.Graphics;
  private mapRef?: Phaser.Tilemaps.Tilemap;
  private editorGround?: Phaser.Tilemaps.TilemapLayer;
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  private staticColliders?: Phaser.Physics.Arcade.StaticGroup;
  private dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset> = new Map();
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

    if (!office) {
      console.warn('Tileset office_tiles nicht gefunden. Verfügbare Texturen:', this.textures.getTextureKeys());
    }

    // Tile-Layer erstellen (verwende verfügbare Tilesets)
    const available = [office, furniture, decor].filter(Boolean) as Phaser.Tilemaps.Tileset[];
    const ground = available.length ? map.createLayer('Ground', available, 0, 0) : undefined;
    const walls = available.length ? map.createLayer('Walls', available, 0, 0) : undefined;
    if (!ground) console.warn('Layer Ground konnte nicht erstellt werden.');
    if (!walls) console.warn('Layer Walls konnte nicht erstellt werden.');

    ground?.setDepth(0);
    walls?.setDepth(5);

    // Collision-Layer einlesen und statische Physik-Körper erzeugen
    const collisionTilesets: Phaser.Tilemaps.Tileset[] = [];
    if (collision) collisionTilesets.push(collision);
    const collisionLayer = collisionTilesets.length > 0 ? map.createLayer('Collision', collisionTilesets, 0, 0) : undefined as any;
    this.collisionLayer = collisionLayer as any;
    let staticColliders: Phaser.Physics.Arcade.StaticGroup | undefined;
    if (collisionLayer) {
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
          collisionLayer.setVisible(false);
          this.staticColliders = staticColliders;
        } else {
          console.warn('Collision layer has no tile data; skipping collision setup');
        }
      } catch (e) {
        console.warn('Failed to configure collision layer', e);
      }
    } else {
      console.warn('No collision layer created');
    }

    // Editor-Layer (zusätzlicher Boden, den wir bemalen können)
    let editorGround: Phaser.Tilemaps.TilemapLayer | undefined;
    if (available.length) {
      try {
        const hasLayer = (map.layers || []).some((l: any) => l?.name === 'EditorGround');
        if (hasLayer) editorGround = map.createLayer('EditorGround', available, 0, 0) as any;
      } catch (e) {
        try { console.warn('Invalid Tilemap Layer ID: EditorGround'); } catch {}
        try { console.warn('Valid tilelayer names:', (map.layers || []).map((l:any)=>l.name)); } catch {}
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

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.hero = this.physics.add.sprite(80, 120, 'hero_walk_down', 0);
    this.hero.setCollideWorldBounds(true);
    this.hero.setDepth(10);
    if (staticColliders) this.physics.add.collider(this.hero, staticColliders);

    this.anims.create({ key: 'walk_down', frames: this.anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_up', frames: this.anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_left', frames: this.anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_right', frames: this.anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });

    const cursors = this.input.keyboard!.createCursorKeys();
    this.cameras.main.startFollow(this.hero, true, 0.1, 0.1);
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
          if (Math.abs(nx) > Math.abs(ny)) this.hero.play(nx > 0 ? 'walk_right' : 'walk_left', true);
          else this.hero.play(ny > 0 ? 'walk_down' : 'walk_up', true);
        }
      } else {
        if (cursors.left?.isDown) { body.setVelocityX(-speed); this.hero.play('walk_left', true); }
        else if (cursors.right?.isDown) { body.setVelocityX(speed); this.hero.play('walk_right', true); }
        else if (cursors.up?.isDown) { body.setVelocityY(-speed); this.hero.play('walk_up', true); }
        else if (cursors.down?.isDown) { body.setVelocityY(speed); this.hero.play('walk_down', true); }
        else { this.hero.anims.stop(); }
      }

      gameBridge.onLocalMove({ x: this.hero.x, y: this.hero.y, direction: 'down' });
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

    gameBridge.setSceneApi(this);

    // Nach dem Aufbau: gespeicherte Editor-Layer laden (best-effort)
    setTimeout(() => this.loadEditorLayers(), 0);
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up'|'down'|'left'|'right' }>) {
    for (const [id, p] of Object.entries(players)) {
      let s = this.remotes.get(id);
      if (!s) {
        s = this.add.sprite(p.x, p.y, 'hero_walk_down', 0);
        this.remotes.set(id, s);
      }
      s.setPosition(p.x, p.y);
    }
    for (const id of Array.from(this.remotes.keys())) {
      if (!players[id]) {
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);
      }
    }
  }

  setDesiredPosition(pos: { x: number; y: number } | null) {
    this.desiredPos = pos;
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
      if (!this.textures.exists(a.key)) {
        this.textures.addBase64(a.key, a.dataUrl);
      }
      let img = this.editorSprites.get(a.id);
      if (!img) {
        img = this.add.image(a.x, a.y, a.key);
        img.setDepth(6);
        this.editorSprites.set(a.id, img);
      } else {
        img.setTexture(a.key);
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

  applyTilePaint(edit: { layer: 'EditorGround' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) {
    if (!this.mapRef) return;
    const targetLayer = edit.layer === 'Collision' ? this.collisionLayer : this.editorGround;
    if (!targetLayer) return;
    const x0 = Math.min(edit.rect.startX, edit.rect.endX);
    const y0 = Math.min(edit.rect.startY, edit.rect.endY);
    const x1 = Math.max(edit.rect.startX, edit.rect.endX);
    const y1 = Math.max(edit.rect.startY, edit.rect.endY);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        targetLayer.putTileAt(edit.tileIndex, tx, ty);
      }
    }
    // Collision-Physik neu aufbauen
    if (targetLayer === this.collisionLayer) {
      this.rebuildStaticColliders();
    }
    // Persistenz speichern
    this.saveEditorLayers();
  }

  private saveEditorLayers() {
    if (!this.mapRef) return;
    const width = this.mapRef.width;
    const height = this.mapRef.height;
    const dumpLayer = (layer?: Phaser.Tilemaps.TilemapLayer) => {
      if (!layer) return null;
      const arr: number[] = new Array(width * height).fill(-1);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = layer.getTileAt(x, y);
          arr[y * width + x] = tile ? tile.index : -1;
        }
      }
      return arr;
    };
    try {
      const data = {
        editorGround: dumpLayer(this.editorGround),
        collision: dumpLayer(this.collisionLayer),
        w: width,
        h: height,
      };
      localStorage.setItem('meetropolis.editorLayers', JSON.stringify(data));
    } catch {}
  }

  private loadEditorLayers() {
    if (!this.mapRef) return;
    try {
      const raw = localStorage.getItem('meetropolis.editorLayers');
      if (!raw) return;
      const data = JSON.parse(raw);
      const width = Math.min(this.mapRef.width, data?.w || 0);
      const height = Math.min(this.mapRef.height, data?.h || 0);
      const applyArr = (arr: number[] | null | undefined, layer?: Phaser.Tilemaps.TilemapLayer) => {
        if (!arr || !layer) return;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = arr[y * (data?.w || width) + x];
            if (typeof idx === 'number' && idx >= 0) {
              layer.putTileAt(idx, x, y);
            }
          }
        }
      };
      applyArr(data?.editorGround, this.editorGround);
      applyArr(data?.collision, this.collisionLayer);
      if (data?.collision) this.rebuildStaticColliders();
    } catch {}
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
    if (!this.mapRef) return;
    // Textur registrieren
    if (!this.textures.exists(ts.key)) {
      this.textures.addBase64(ts.key, ts.dataUrl);
    }
    // Tileset zur Map hinzufügen
    const tileset = this.mapRef.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
    if (tileset) {
      this.dynamicTilesets.set(ts.key, tileset);
      // Stelle sicher, dass Editor-Layer dieses Tileset nutzen kann
      if (!this.editorGround && this.mapRef) {
        try {
          const tmp = this.mapRef.createBlankLayer('EditorGround', tileset, 0, 0, this.mapRef.width, this.mapRef.height, this.mapRef.tileWidth, this.mapRef.tileHeight);
          this.editorGround = tmp as any;
          if (this.editorGround) this.editorGround.setDepth(1);
        } catch {}
      } else {
        // Phaser erlaubt kein dynamisches Umschalten der Tileset-Liste am Layer direkt, aber Tiles sind indexbasiert.
        // Solange der Index zum verwendeten Tileset passt, rendert es korrekt, da alle Tilesets im Map-Context bekannt sind.
      }
    }
  }
}
