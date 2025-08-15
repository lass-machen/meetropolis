import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Tileset-Bilder laden
    this.load.image('office_tiles_raw', '/assets/tilesets/office_tiles.png');
    this.load.image('furniture_tiles', '/assets/tilesets/furniture_tiles.png');
    this.load.image('decor_tiles', '/assets/tilesets/decor_tiles.png');
    // Collision tiles are created as canvas in create() method

    this.load.tilemapTiledJSON('office', '/maps/office.json');
    // Charakter-Sprites laden
    this.load.spritesheet('hero_walk_down', '/assets/sprites/businessman1_walk_down.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_up', '/assets/sprites/businessman1_walk_up.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_left', '/assets/sprites/businessman1_walk_left.png', { frameWidth: 16, frameHeight: 24 });
    this.load.spritesheet('hero_walk_right', '/assets/sprites/businessman1_walk_right.png', { frameWidth: 16, frameHeight: 24 });
  }

  create() {
    // Erzeuge gepaddete office_tiles (192x48), wie in Tiled definiert
    const src = this.textures.get('office_tiles_raw')?.getSourceImage() as HTMLImageElement | undefined;
    if (src) {
      const targetW = 192; // 12 cols * 16px
      const targetH = 48;  // 3 rows * 16px
      const ctex = this.textures.createCanvas('office_tiles', targetW, targetH);
      if (ctex) {
        const ctx = ctex.getContext();
        if (ctx) {
          ctx.clearRect(0, 0, targetW, targetH);
          ctx.drawImage(src, 0, 0);
        }
        ctex.refresh();
      }
    }
    
    // Always create collision tiles as canvas
    const ctex = this.textures.createCanvas('collision_tiles', 256, 48); // 16x3 tiles
    if (ctex) {
      const ctx = ctex.getContext();
      if (ctx) {
        ctx.fillStyle = 'rgba(255,0,0,0.5)';
        // Draw a 3x3 grid of collision tiles
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 16; x++) {
            ctx.fillRect(x * 16 + 1, y * 16 + 1, 14, 14);
          }
        }
      }
      ctex.refresh();
    }
    
    this.scene.start('Main');
  }
}

