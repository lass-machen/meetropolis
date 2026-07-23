import type Phaser from 'phaser';

export type AssetRef = { key: string; url: string };

export async function loadAssets(scene: Phaser.Scene, assets: AssetRef[]): Promise<void> {
  for (const a of assets) {
    try {
      scene.textures.exists(a.key);
    } catch {}
    if (!scene.textures.exists(a.key)) {
      scene.load.image(a.key, a.url);
    }
  }
  return new Promise((resolve) => {
    scene.load.once('complete', () => resolve());
    scene.load.start();
  });
}
