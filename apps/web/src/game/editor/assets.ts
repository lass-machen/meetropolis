import Phaser from 'phaser';

export function setEditorAssets(scene: Phaser.Scene & any, assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]): void {
  if (!scene.game || !(scene.game as any).renderer) return;
  const keep = new Set(assets.map((a: any) => a.id));
  for (const [id, sprite] of scene.editorSprites as Map<string, Phaser.GameObjects.Image>) {
    if (!keep.has(id)) {
      sprite.destroy();
      scene.editorSprites.delete(id);
    }
  }
  for (const a of assets) {
    const textureKey = `asset_${a.id}`;
    let img = scene.editorSprites.get(a.id) as Phaser.GameObjects.Image | undefined;
    if (!img) {
      if (!scene.textures.exists(textureKey) && !scene.pendingTextures.has(textureKey)) {
        scene.pendingTextures.add(textureKey);
        scene.textures.once('addtexture', (key: string) => {
          if (key === textureKey) {
            scene.pendingTextures.delete(textureKey);
            const newImg = scene.add.image(a.x, a.y, textureKey);
            newImg.setDepth(6);
            newImg.setInteractive();
            scene.editorSprites.set(a.id, newImg);
          }
        });
        const isDataUrl = typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:');
        if (isDataUrl) {
          scene.textures.addBase64(textureKey, a.dataUrl);
        } else {
          try { scene.load.image(textureKey, a.dataUrl); scene.load.start(); } catch {}
        }
      } else if (scene.textures.exists(textureKey)) {
        img = scene.add.image(a.x, a.y, textureKey);
        img.setDepth(6);
        img.setInteractive();
        scene.editorSprites.set(a.id, img);
      }
    } else {
      img.setPosition(a.x, a.y);
    }
  }
}

export function setAssetPreview(scene: Phaser.Scene & any, preview: { dataUrl: string; width?: number; height?: number } | null): void {
  try {
    if (!preview) {
      if (scene.ghostSprite) {
        scene.ghostSprite.destroy();
        delete (scene as any).ghostSprite;
      }
      if (scene.ghostTextureKey && scene.textures.exists(scene.ghostTextureKey)) {
        try { scene.textures.remove(scene.ghostTextureKey); } catch {}
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
      try { scene.ghostSprite.setVisible(true); } catch {}
      (scene as any)._ghostDataUrl = preview.dataUrl;
      if (scene.mapRef) {
        const cx = Math.round((scene.cameras.main.worldView.centerX) / scene.mapRef.tileWidth) * scene.mapRef.tileWidth + scene.mapRef.tileWidth / 2;
        const cy = Math.round((scene.cameras.main.worldView.centerY) / scene.mapRef.tileHeight) * scene.mapRef.tileHeight + scene.mapRef.tileHeight / 2;
        scene.ghostSprite.setPosition(cx, cy);
      }
      if (prevKey && prevKey !== newKey && scene.textures.exists(prevKey)) {
        try { scene.textures.remove(prevKey); } catch {}
      }
      scene.ghostTextureKey = newKey;
    };
    if (scene.textures.exists(newKey)) {
      place();
    } else {
      try { scene.ghostSprite?.setVisible(false); } catch {}
      scene.textures.once('addtexture', (k: string) => { if (k === newKey) place(); });
      if (nextUrl.startsWith('data:')) scene.textures.addBase64(newKey, nextUrl);
      else { scene.load.image(newKey, nextUrl); scene.load.start(); }
    }
  } catch {}
}


