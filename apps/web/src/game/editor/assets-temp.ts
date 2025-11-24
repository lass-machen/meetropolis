/**
 * Temporäre Asset-Funktionen bis EditorRenderer vollständig integriert ist
 */

import Phaser from 'phaser';

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
      img = scene.add.image(a.x, a.y, textureKey);
      img.setDepth(6);
      img.setInteractive();
      scene.editorSprites.set(a.id, img);
      continue;
    }
    
    // Fall 2: Texture wird gerade geladen → warte
    if (scene.pendingTextures.has(textureKey)) {
      continue;
    }
    
    // Fall 3: Texture muss geladen werden
    scene.pendingTextures.add(textureKey);
    
    const isDataUrl = typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:');
    
    if (isDataUrl) {
      // Synchrones Base64-Laden - NUR wenn Texture wirklich nicht existiert
      if (!scene.textures.exists(textureKey)) {
        scene.textures.addBase64(textureKey, a.dataUrl);
      }
      
      scene.pendingTextures.delete(textureKey);
      
      // Erstelle Sprite
      img = scene.add.image(a.x, a.y, textureKey);
      img.setDepth(6);
      img.setInteractive();
      scene.editorSprites.set(a.id, img);
    } else {
      // Asynchrones URL-Laden
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
      scene.load.image(textureKey, a.dataUrl);
      scene.load.start();
    }
  }
}

export function setAssetPreview(scene: Phaser.Scene & any, preview: { dataUrl: string; width?: number; height?: number } | null): void {
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
  
  const nextUrl = preview.dataUrl;
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
    if (nextUrl.startsWith('data:')) {
      scene.textures.addBase64(newKey, nextUrl);
    } else {
      scene.load.image(newKey, nextUrl);
      scene.load.start();
    }
  }
}

