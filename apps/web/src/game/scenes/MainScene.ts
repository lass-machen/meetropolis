import Phaser from 'phaser';
import { gameBridge, type SceneApi } from '../bridge';

export class MainScene extends Phaser.Scene implements SceneApi {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private desiredPos: { x: number; y: number } | null = null;
  private zoneG?: Phaser.GameObjects.Graphics;
  constructor() {
    super('Main');
  }

  create() {
    const map = this.make.tilemap({ key: 'office' });

    // Binde Tilesets: wenn Texturen programmatisch erstellt wurden (BootScene), nutzt Phaser die Textur-Keys
    const office = map.addTilesetImage('office_tiles', 'office_tiles', 16, 16, 0, 0);
    const furniture = map.addTilesetImage('furniture_tiles', 'furniture_tiles', 16, 16, 0, 0);
    const decor = map.addTilesetImage('decor_tiles', 'decor_tiles', 16, 16, 0, 0);
    const collision = map.addTilesetImage('collision_tiles', 'collision_tiles', 16, 16, 0, 0);

    // Tile-Layer erstellen
    const ground = map.createLayer('Ground', [office], 0, 0);
    const walls = map.createLayer('Walls', [office], 0, 0);
    const collisionTilesets: Phaser.Tilemaps.Tileset[] = [];
    if (collision) collisionTilesets.push(collision);
    const collisionLayer = collisionTilesets.length > 0 ? map.createLayer('Collision', collisionTilesets, 0, 0) : undefined as any;
    try {
      const data = (collisionLayer as any)?.layer?.data;
      if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0]) && data[0].length > 0) {
        // Aktiviere Kollision für alle belegten Tiles im Collision-Layer
        collisionLayer.setCollisionByExclusion([-1], true);
      } else {
        // eslint-disable-next-line no-console
        console.warn('Collision layer has no tile data; skipping collision setup');
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Failed to configure collision layer', e);
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);

    // Physics & Hero
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.hero = this.physics.add.sprite(80, 120, 'hero_walk_down', 0);
    this.hero.setCollideWorldBounds(true);
    if (collisionLayer) this.physics.add.collider(this.hero, collisionLayer);

    // Simple anims
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
      // Follow desired position if set, else allow manual control
      if (this.desiredPos) {
        const dx = this.desiredPos.x - this.hero.x;
        const dy = this.desiredPos.y - this.hero.y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < 2) {
          this.desiredPos = null; // reached
          this.hero.anims.stop();
        } else {
          const nx = dx / Math.max(Math.hypot(dx, dy), 1e-6);
          const ny = dy / Math.max(Math.hypot(dx, dy), 1e-6);
          body.setVelocity(nx * speed, ny * speed);
          if (Math.abs(nx) > Math.abs(ny)) {
            this.hero.play(nx > 0 ? 'walk_right' : 'walk_left', true);
          } else {
            this.hero.play(ny > 0 ? 'walk_down' : 'walk_up', true);
          }
        }
      } else {
        if (cursors.left?.isDown) { body.setVelocityX(-speed); this.hero.play('walk_left', true); }
        else if (cursors.right?.isDown) { body.setVelocityX(speed); this.hero.play('walk_right', true); }
        else if (cursors.up?.isDown) { body.setVelocityY(-speed); this.hero.play('walk_up', true); }
        else if (cursors.down?.isDown) { body.setVelocityY(speed); this.hero.play('walk_down', true); }
        else { this.hero.anims.stop(); }
      }

      // Bridge: sende lokale Bewegung
      gameBridge.onLocalMove({ x: this.hero.x, y: this.hero.y, direction: 'down' });
    });

    gameBridge.setSceneApi(this);
  }

  syncRemotePlayers(players: Record<string, { x: number; y: number; direction: 'up'|'down'|'left'|'right' }>) {
    // einfache Spiegelung: Sprite anlegen/verschieben
    for (const [id, p] of Object.entries(players)) {
      let s = this.remotes.get(id);
      if (!s) {
        s = this.add.sprite(p.x, p.y, 'hero_walk_down', 0);
        this.remotes.set(id, s);
      }
      s.setPosition(p.x, p.y);
    }
    // Entfernen nicht mehr vorhandener Spieler
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
    g.lineStyle(1, 0x00ff99, 0.9);
    g.fillStyle(0x00ff99, 0.15);
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
    this.zoneG = g;
  }
}
