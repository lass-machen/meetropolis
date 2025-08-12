import Phaser from 'phaser';
import { gameBridge, type SceneApi } from '../bridge';

export class MainScene extends Phaser.Scene implements SceneApi {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private desiredPos: { x: number; y: number } | null = null;
  private zoneG?: Phaser.GameObjects.Graphics;
  private baseGrid?: Phaser.GameObjects.Graphics;
  constructor() {
    super('Main');
  }

  create() {
    const map = this.make.tilemap({ key: 'office' });

    // Dezent: Grid-Hintergrund als Platzhalter
    const g = this.add.graphics();
    g.fillStyle(0x1f1f1f, 1);
    g.fillRect(0, 0, map.widthInPixels, map.heightInPixels);
    g.lineStyle(1, 0x2a2a2a, 1);
    for (let x = 0; x <= map.widthInPixels; x += 16) g.lineBetween(x, 0, x, map.heightInPixels);
    for (let y = 0; y <= map.heightInPixels; y += 16) g.lineBetween(0, y, map.widthInPixels, y);
    g.setDepth(-10);
    this.baseGrid = g;

    // Binde Tilesets
    const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);

    if (!office) {
      console.warn('Tileset office_tiles nicht gefunden. Verfügbare Texturen:', this.textures.getTextureKeys());
    }

    // Tile-Layer erstellen
    const ground = office ? map.createLayer('Ground', [office], 0, 0) : undefined;
    const walls = office ? map.createLayer('Walls', [office], 0, 0) : undefined;
    if (!ground) console.warn('Layer Ground konnte nicht erstellt werden.');
    if (!walls) console.warn('Layer Walls konnte nicht erstellt werden.');

    ground?.setDepth(0);
    walls?.setDepth(5);

    const collisionTilesets: Phaser.Tilemaps.Tileset[] = [];
    if (collision) collisionTilesets.push(collision);
    const collisionLayer = collisionTilesets.length > 0 ? map.createLayer('Collision', collisionTilesets, 0, 0) : undefined as any;
    if (collisionLayer) {
      try {
        const data = (collisionLayer as any)?.layer?.data;
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && data[0].length > 0) {
          collisionLayer.forEachTile((tile: Phaser.Tilemaps.Tile) => {
            if (tile && tile.index !== -1) {
              tile.setCollision(true, true, true, true);
            }
          });
          collisionLayer.setVisible(false);
        } else {
          console.warn('Collision layer has no tile data; skipping collision setup');
        }
      } catch (e) {
        console.warn('Failed to configure collision layer', e);
      }
    } else {
      console.warn('No collision layer created');
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.hero = this.physics.add.sprite(80, 120, 'hero_walk_down', 0);
    this.hero.setCollideWorldBounds(true);
    this.hero.setDepth(10);
    if (collisionLayer) this.physics.add.collider(this.hero, collisionLayer);

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

    gameBridge.setSceneApi(this);
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
}
