import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Tileset-Bilder direkt laden
    this.load.image('office_tiles', '/assets/tilesets/office_tiles.png');
    this.load.image('furniture_tiles', '/assets/tilesets/furniture_tiles.png');
    this.load.image('decor_tiles', '/assets/tilesets/decor_tiles.png');
    // Collision Tiles: falls kein Bild existiert, generieren wir ein Platzhalter-Canvas
    if (!this.textures.exists('collision_tiles')) {
      const ctex = this.textures.createCanvas('collision_tiles', 16, 16);
      if (ctex) {
        const ctx = ctex.getContext();
        if (ctx) {
          ctx.fillStyle = 'rgba(255,0,0,0.5)';
          ctx.fillRect(0, 0, 16, 16);
        }
        ctex.refresh();
      }
    }

    this.load.tilemapTiledJSON('office', '/maps/office.json');
    // Charakter-Sprites laden
    this.load.spritesheet('hero_walk_down', '/assets/sprites/businessman1_walk_down.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_up', '/assets/sprites/businessman1_walk_up.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_left', '/assets/sprites/businessman1_walk_left.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_right', '/assets/sprites/businessman1_walk_right.png', { frameWidth: 16, frameHeight: 24 });
  }

  create() {
    this.scene.start('Main');
  }
}

