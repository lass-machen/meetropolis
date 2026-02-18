/**
 * Editor asset management for placing and previewing sprites in the map editor
 */

import Phaser from 'phaser';
import { lookupDirectionalImage } from '../../lib/directionalImageRegistry';

export function setEditorAssets(scene: Phaser.Scene & any, assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]): void {
  if (!scene.game || !(scene.game as any).renderer) return;
  
  const keep = new Set(assets.map((a: any) => a.id));
  
  // Entferne nicht mehr existierende Assets
  for (const [id, sprite] of scene.editorSprites as Map<string, Phaser.GameObjects.Image>) {
    if (!keep.has(id)) {
      sprite.destroy();
      scene.editorSprites.delete(id);
    }
  }
  
  // Erstelle/Update Assets
  for (const a of assets) {
    // Verwende key als Texture-Key um Texturen zu teilen
    const textureKey = `editorasset_${a.key}`;
    
    // Prüfe ob Sprite für dieses Asset bereits existiert
    let img = scene.editorSprites.get(a.id) as Phaser.GameObjects.Image | undefined;
    
    if (img) {
      // Sprite existiert - nur Position updaten
      img.setPosition(a.x, a.y);
      continue;
    }
    
    // Sprite existiert nicht - erstelle es
    // Fall 1: Texture existiert bereits → Sprite sofort erstellen
    if (scene.textures.exists(textureKey)) {
      const newImg = scene.add.image(a.x, a.y, textureKey);
      newImg.setDepth(6);
      newImg.setInteractive();
      img = newImg;
      scene.editorSprites.set(a.id, img);
      continue;
    }
    
    // Fall 2: Texture wird gerade geladen → warte
    if (scene.pendingTextures.has(textureKey)) {
      continue;
    }
    
    // Fall 3: Texture muss geladen werden
    scene.pendingTextures.add(textureKey);
    
    // Event-Handler für ALLE Texture-Typen (Base64 UND URL)
    const loadHandler = (key: string) => {
      if (key !== textureKey) return;
      
      scene.pendingTextures.delete(textureKey);
      scene.textures.off('addtexture', loadHandler);
      
      // Erstelle Sprites für ALLE Assets mit diesem textureKey
      for (const asset of assets) {
        if (asset.key === a.key && !scene.editorSprites.has(asset.id)) {
          const newImg = scene.add.image(asset.x, asset.y, textureKey);
          newImg.setDepth(6);
          newImg.setInteractive();
          scene.editorSprites.set(asset.id, newImg);
        }
      }
    };
    
    scene.textures.on('addtexture', loadHandler);
    
    const isDataUrl = typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:');
    if (isDataUrl) {
      // Base64-Laden ist AUCH asynchron!
      scene.textures.addBase64(textureKey, a.dataUrl);
    } else {
      // URL-Laden
      scene.load.image(textureKey, a.dataUrl);
      scene.load.start();
    }
  }
}

export function setAssetPreview(
  scene: Phaser.Scene & any,
  preview: { dataUrl: string; width?: number | undefined; height?: number | undefined; rotation?: number | undefined; packUuid?: string | undefined; itemId?: string | undefined } | null,
): void {
  if (!preview) {
    if (scene.ghostSprite) {
      scene.ghostSprite.destroy();
      delete (scene as any).ghostSprite;
    }
    if (scene.ghostTextureKey && scene.textures.exists(scene.ghostTextureKey)) {
      scene.textures.remove(scene.ghostTextureKey);
    }
    delete (scene as any).ghostTextureKey;
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

  const newKey = `ghost_${Date.now()}_${Math.floor(Math.random()*1000000)}`;
  const prevKey = scene.ghostTextureKey as string | undefined;

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
    (scene as any)._ghostDataUrl = preview.dataUrl;

    // Apply rotation: directional image = no rotation, else programmatic
    if (useDirectionalImage) {
      scene.ghostSprite.setRotation(0);
    } else {
      scene.ghostSprite.setRotation(Phaser.Math.DegToRad(rotation));
    }

    if (scene.mapRef) {
      const cx = Math.round((scene.cameras.main.worldView.centerX) / scene.mapRef.tileWidth) * scene.mapRef.tileWidth + scene.mapRef.tileWidth / 2;
      const cy = Math.round((scene.cameras.main.worldView.centerY) / scene.mapRef.tileHeight) * scene.mapRef.tileHeight + scene.mapRef.tileHeight / 2;
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
    scene.textures.once('addtexture', (k: string) => { if (k === newKey) place(); });
    if (resolvedUrl.startsWith('data:')) {
      scene.textures.addBase64(newKey, resolvedUrl);
    } else {
      scene.load.image(newKey, resolvedUrl);
      scene.load.start();
    }
  }
}

