import Phaser from 'phaser';

export class MainScene extends Phaser.Scene {
  constructor() {
    super('Main');
  }

  create() {
    const map = this.make.tilemap({ key: 'map' });
    const tileset = map.addTilesetImage('tiles', 'tiles', 16, 16, 0, 0);
    map.createLayer(0, tileset, 0, 0);

    const cam = this.cameras.main;
    cam.setBackgroundColor('#202020');
    cam.setZoom(3);
  }
}

