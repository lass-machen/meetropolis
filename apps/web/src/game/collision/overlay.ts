import Phaser from 'phaser';
import { logger } from '../../lib/logger';
import type { MainSceneLike } from '../types/scene';

export function setCollisionVisible(scene: MainSceneLike, visible: boolean): void {
  logger.debug('[Collision]', `Setting visibility to ${visible}`);
  scene.collisionVisible = !!visible;
  updateCollisionOverlay(scene);
  try {
    localStorage.setItem('meetropolis.collisionVisible', visible.toString());
  } catch {}
}

export function updateCollisionOverlay(scene: MainSceneLike): void {
  if (!scene.mapRef) return;
  scene.collisionOverlay?.destroy();
  if (!scene.collisionVisible || !scene.collisionLayer) {
    logger.debug(
      '[Collision]',
      `Not showing overlay: visible=${scene.collisionVisible}, hasLayer=${!!scene.collisionLayer}`,
    );
    return;
  }
  const g = scene.add.graphics();
  g.fillStyle(0xff4757, 0.18);
  g.lineStyle(1, 0xff4757, 0.8);
  const data: Phaser.Tilemaps.Tile[][] | undefined = scene.collisionLayer.layer?.data;
  if (data) {
    let tileCount = 0;
    for (let y = 0; y < data.length; y++) {
      const row = data[y];
      if (!row) continue;
      for (let x = 0; x < row.length; x++) {
        const t = row[x];
        if (t && t.index !== -1) {
          const px = x * scene.mapRef.tileWidth;
          const py = y * scene.mapRef.tileHeight;
          g.fillRect(px, py, scene.mapRef.tileWidth, scene.mapRef.tileHeight);
          g.strokeRect(px, py, scene.mapRef.tileWidth, scene.mapRef.tileHeight);
          tileCount++;
        }
      }
    }
    logger.debug('[Collision]', `Overlay created with ${tileCount} collision tiles`);
  }
  g.setDepth(8);
  scene.collisionOverlay = g;
}
