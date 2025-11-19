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
    } else {
      scene.staticColliders = scene.physics.add.staticGroup();
    }
    
    // Ensure collider with hero exists
    if (scene.hero && !scene.physics.world.colliders.contains(scene.heroVsStaticCollider)) {
       try { scene.heroVsStaticCollider?.destroy(); } catch {}
       scene.heroVsStaticCollider = scene.physics.add.collider(scene.hero, scene.staticColliders);
    }

    if (!scene.collisionLayer) return;
    const map = scene.mapRef!;
    
    // Iterate over tiles in collision layer directly to find solid tiles
    // This is more robust than accessing layer.data directly if Phaser modified it
    const width = map.width;
    const height = map.height;
    
    let count = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = scene.collisionLayer.getTileAt(x, y);
        if (tile && tile.index !== -1) {
           // Create static body for this tile
           const wx = x * map.tileWidth + map.tileWidth / 2;
           const wy = y * map.tileHeight + map.tileHeight / 2;
           const body = scene.add.rectangle(wx, wy, map.tileWidth, map.tileHeight, 0x000000, 0);
           scene.physics.add.existing(body, true);
           scene.staticColliders.add(body);
           count++;
        }
      }
    }
    console.log(`[Collision] Rebuilt static colliders: ${count} bodies`);
  } catch (e) {
    console.error('[Collision] Failed to rebuild static colliders', e);
  }
}



