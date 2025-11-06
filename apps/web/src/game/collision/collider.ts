import Phaser from 'phaser';

export function ensureCollisionCollider(scene: Phaser.Scene & any): void {
  try {
    if (!scene.collisionLayer || !scene.hero) return;
    try { scene.collisionLayer.setCollisionByExclusion([-1], true); } catch {}
    try { scene.heroVsTilesCollider?.destroy(); } catch {}
    scene.heroVsTilesCollider = scene.physics.add.collider(scene.hero, scene.collisionLayer);
  } catch {}
}

export function rebuildStaticColliders(scene: Phaser.Scene & any): void {
  try {
    if (scene.staticColliders) {
      scene.staticColliders.clear(true, true);
    }
    if (!scene.collisionLayer) return;
    const layer: any = scene.collisionLayer;
    const map = scene.mapRef!;
    const data = (layer as any)?.layer?.data as Phaser.Tilemaps.Tile[][] | undefined;
    if (!data) return;
    if (!scene.staticColliders) scene.staticColliders = scene.physics.add.staticGroup();
    for (let row = 0; row < data.length; row++) {
      const rowArr = data[row];
      if (!Array.isArray(rowArr)) continue;
      for (let col = 0; col < rowArr.length; col++) {
        const tile = rowArr[col];
        if (tile && tile.index !== -1) {
          const x = col * map.tileWidth + map.tileWidth / 2;
          const y = row * map.tileHeight + map.tileHeight / 2;
          const body = scene.add.rectangle(x, y, map.tileWidth, map.tileHeight, 0x000000, 0);
          scene.physics.add.existing(body, true);
          try { (body as any).body?.refreshBody?.(); } catch {}
          scene.staticColliders.add(body);
        }
      }
    }
  } catch {}
}


