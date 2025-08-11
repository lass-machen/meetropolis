import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';

export function createPhaserGame(parent: HTMLElement) {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: parent.clientWidth,
    height: parent.clientHeight,
    parent,
    pixelArt: true,
    scene: [BootScene, MainScene],
    physics: {
      default: 'arcade',
      arcade: { debug: false }
    },
  };
  return new Phaser.Game(config);
}

export function destroyPhaserGame(game: Phaser.Game) {
  game.destroy(true);
}

