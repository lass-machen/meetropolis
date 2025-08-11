import Phaser from 'phaser';
import { gameBridge, type SceneApi } from '../bridge';

export class MainScene extends Phaser.Scene implements SceneApi {
  private hero!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();
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
    const collisionLayer = map.createLayer('Collision', [collision], 0, 0);
    // Kollision optional: Wenn Layer existiert und Tiles vorliegen, kann später gezielt gesetzt werden
    if (collisionLayer) {
      // Wir verzichten erstmal auf setCollisionByExclusion, um Runtime-Fehler zu vermeiden
      // und setzen Kollision später über Properties/Zones.
    }

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);

    // Physics & Hero
    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.hero = this.physics.add.sprite(80, 120, 'hero_walk_down', 0);
    this.hero.setCollideWorldBounds(true);

    // Simple anims
    this.anims.create({ key: 'walk_down', frames: this.anims.generateFrameNumbers('hero_walk_down', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_up', frames: this.anims.generateFrameNumbers('hero_walk_up', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_left', frames: this.anims.generateFrameNumbers('hero_walk_left', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });
    this.anims.create({ key: 'walk_right', frames: this.anims.generateFrameNumbers('hero_walk_right', { start: 0, end: 3 }), frameRate: 8, repeat: -1 });

    const cursors = this.input.keyboard!.createCursorKeys();
    this.events.on(Phaser.Scenes.Events.UPDATE, () => {
      const speed = 80;
      const body = this.hero.body;
      body.setVelocity(0);
      if (cursors.left?.isDown) { body.setVelocityX(-speed); this.hero.play('walk_left', true); }
      else if (cursors.right?.isDown) { body.setVelocityX(speed); this.hero.play('walk_right', true); }
      else if (cursors.up?.isDown) { body.setVelocityY(-speed); this.hero.play('walk_up', true); }
      else if (cursors.down?.isDown) { body.setVelocityY(speed); this.hero.play('walk_down', true); }
      else { this.hero.anims.stop(); }

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
}

