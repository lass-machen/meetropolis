import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Echte Tileset-Bilder laden (aus Little Bits Office RAR extrahiert)
    // Lade Original und erzeuge gepaddete Canvas-Textur (Breite auf 192px runden)
    this.load.image('office_tiles_raw', '/assets/tilesets/office_tiles.png');
    this.load.image('furniture_tiles', '/assets/tilesets/furniture_tiles.png');
    this.load.image('decor_tiles', '/assets/tilesets/decor_tiles.png');
    // Collision Tiles: falls kein Bild existiert, generieren wir ein Platzhalter-Canvas
    if (!this.textures.exists('collision_tiles')) {
      const ctex = this.textures.createCanvas('collision_tiles', 16, 16);
      const ctx = ctex.getContext();
      ctx.fillStyle = 'rgba(255,0,0,0.5)';
      ctx.fillRect(0, 0, 16, 16);
      ctex.refresh();
    }

    this.load.tilemapTiledJSON('office', '/maps/office.json');
    // Charakter-Sprites laden
    this.load.spritesheet('hero_walk_down', '/assets/sprites/businessman1_walk_down.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_up', '/assets/sprites/businessman1_walk_up.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_left', '/assets/sprites/businessman1_walk_left.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_right', '/assets/sprites/businessman1_walk_right.png', { frameWidth: 16, frameHeight: 24 });
  }

  create() {
    // Erzeuge gepaddete office_tiles (192x48) aus office_tiles_raw
    const src = this.textures.get('office_tiles_raw')?.getSourceImage() as HTMLImageElement | undefined;
    if (src) {
      const targetW = 192; // 12 cols * 16px
      const targetH = 48;  // 3 rows * 16px
      const ctex = this.textures.createCanvas('office_tiles', targetW, targetH);
      const ctx = ctex.getContext();
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(src, 0, 0);
      ctex.refresh();
    }
    this.scene.start('Main');
  }
}

