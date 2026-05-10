import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';

export function createPhaserGame(parent: HTMLElement) {
  const allowDebug = window.DEBUG_LOGS || (import.meta as any).env?.VITE_DEBUG_LOGS === 'true';
  // Suppress Phaser banner logs unless debug explicitly enabled
  if (!allowDebug) {
    try {
      const prevLog = console.log;
      const prevInfo = console.info;
      console.log = (...args: any[]) => {
        try {
          if (typeof args[0] === 'string' && /Phaser v\d/i.test(args[0])) return;
        } catch {}
        return (prevLog as any).apply(console, args as any);
      };
      console.info = (...args: any[]) => {
        try {
          if (typeof args[0] === 'string' && /Phaser v\d/i.test(args[0])) return;
        } catch {}
        return (prevInfo as any).apply(console, args as any);
      };
      setTimeout(() => {
        try {
          console.log = prevLog;
          console.info = prevInfo;
        } catch {}
      }, 2000);
    } catch {}
  }
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent,
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      parent,
    },
    scene: [BootScene, MainScene],
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
  };
  const game = new Phaser.Game(config);

  // Expose game globally for Tauri mini-mode refresh
  window.__PHASER_GAME__ = game;

  return game;
}

export function destroyPhaserGame(game: Phaser.Game) {
  game.destroy(true);
}
