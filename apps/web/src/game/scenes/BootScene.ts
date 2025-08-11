import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload() {
    // Erzeuge ein einfaches 16x16 Tileset-Texture programmatisch
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(0x3a3a3a, 1);
    gfx.fillRect(0, 0, 16, 16);
    gfx.generateTexture('tiles', 16, 16);

    this.load.tilemapTiledJSON('map', '/assets/map.json');
  }

  create() {
    this.scene.start('Main');
  }
}

