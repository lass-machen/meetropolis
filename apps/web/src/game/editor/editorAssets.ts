/**
 * Editor asset management for placing and previewing sprites in the map editor
 */

import Phaser from 'phaser';
import { lookupDirectionalImage } from '../../lib/directionalImageRegistry';
import type { MainSceneLike } from '../types/scene';

export function setAssetPreview(
  scene: MainSceneLike,
  preview: {
    dataUrl: string;
    width?: number | undefined;
    height?: number | undefined;
    rotation?: number | undefined;
    packUuid?: string | undefined;
    itemId?: string | undefined;
  } | null,
): void {
  if (!preview) {
    if (scene.ghostSprite) {
      scene.ghostSprite.destroy();
      scene.ghostSprite = undefined;
    }
    if (scene.ghostTextureKey && scene.textures.exists(scene.ghostTextureKey)) {
      scene.textures.remove(scene.ghostTextureKey);
    }
    scene.ghostTextureKey = undefined;
    return;
  }

  // Check for directional image override
  const rotation = preview.rotation ?? 0;
  let useDirectionalImage = false;
  let resolvedUrl = preview.dataUrl;
  if (preview.packUuid && preview.itemId) {
    const dirUrl = lookupDirectionalImage(preview.packUuid, preview.itemId, rotation);
    if (dirUrl) {
      resolvedUrl = dirUrl;
      useDirectionalImage = true;
    }
  }

  const newKey = `ghost_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
  const prevKey = scene.ghostTextureKey;

  const place = () => {
    if (!scene.ghostSprite) {
      const img = scene.add.image(0, 0, newKey);
      img.setAlpha(0.6);
      img.setDepth(6.5);
      scene.ghostSprite = img;
    } else {
      scene.ghostSprite.setTexture(newKey);
    }

    scene.ghostSprite.setVisible(true);
    scene._ghostDataUrl = preview.dataUrl;

    // Apply rotation: directional image = no rotation, else programmatic
    if (useDirectionalImage) {
      scene.ghostSprite.setRotation(0);
    } else {
      scene.ghostSprite.setRotation(Phaser.Math.DegToRad(rotation));
    }

    if (scene.mapRef) {
      const cx =
        Math.round(scene.cameras.main.worldView.centerX / scene.mapRef.tileWidth) * scene.mapRef.tileWidth +
        scene.mapRef.tileWidth / 2;
      const cy =
        Math.round(scene.cameras.main.worldView.centerY / scene.mapRef.tileHeight) * scene.mapRef.tileHeight +
        scene.mapRef.tileHeight / 2;
      scene.ghostSprite.setPosition(cx, cy);
    }

    if (prevKey && prevKey !== newKey && scene.textures.exists(prevKey)) {
      scene.textures.remove(prevKey);
    }

    scene.ghostTextureKey = newKey;
  };

  if (scene.textures.exists(newKey)) {
    place();
  } else {
    if (scene.ghostSprite) {
      scene.ghostSprite.setVisible(false);
    }
    scene.textures.once('addtexture', (k: string) => {
      if (k === newKey) place();
    });
    if (resolvedUrl.startsWith('data:')) {
      scene.textures.addBase64(newKey, resolvedUrl);
    } else {
      scene.load.setCORS('anonymous');
      scene.load.image(newKey, resolvedUrl);
      scene.load.start();
    }
  }
}
