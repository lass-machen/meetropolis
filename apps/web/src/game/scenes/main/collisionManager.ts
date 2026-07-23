import Phaser from 'phaser';

export interface CollisionManagerConfig {
  scene: Phaser.Scene;
  hero: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer | undefined;
  mapRef: Phaser.Tilemaps.Tilemap;
}

export class CollisionManager {
  private scene: Phaser.Scene;
  private hero: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined;
  private mapRef: Phaser.Tilemaps.Tilemap;
  private collisionCollider: Phaser.Physics.Arcade.Collider | undefined;
  private remotes: Map<string, Phaser.GameObjects.Sprite> = new Map();

  constructor(config: CollisionManagerConfig) {
    this.scene = config.scene;
    this.hero = config.hero;
    this.collisionLayer = config.collisionLayer;
    this.mapRef = config.mapRef;
  }

  setCollisionLayer(layer: Phaser.Tilemaps.TilemapLayer | undefined) {
    this.collisionLayer = layer;
  }

  setRemotes(remotes: Map<string, Phaser.GameObjects.Sprite>) {
    this.remotes = remotes;
  }

  ensureCollisionCollider() {
    try {
      if (!this.collisionLayer) return;
      if (this.collisionCollider) return;

      this.collisionLayer.setCollisionByExclusion([-1], true);
      this.collisionCollider = this.scene.physics.add.collider(this.hero, this.collisionLayer);
    } catch {}
  }

  rebuildStaticColliders() {
    try {
      if (this.collisionCollider) {
        this.collisionCollider.destroy();
        this.collisionCollider = undefined;
      }
      this.ensureCollisionCollider();
    } catch {}
  }

  isWalkable(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.mapRef.widthInPixels || y >= this.mapRef.heightInPixels) {
      return false;
    }

    if (!this.collisionLayer) return true;

    const tileX = Math.floor(x / this.mapRef.tileWidth);
    const tileY = Math.floor(y / this.mapRef.tileHeight);

    try {
      const tile = this.collisionLayer.getTileAt(tileX, tileY);
      if (tile && tile.index !== -1) return false;
    } catch {}

    const radius = Math.max(this.mapRef.tileWidth, this.mapRef.tileHeight) * 0.6;
    for (const sprite of this.remotes.values()) {
      const dx = sprite.x - x;
      const dy = sprite.y - y;
      if (dx * dx + dy * dy < radius * radius) return false;
    }

    return true;
  }

  findFreeSpotNear(targetId: string, options?: { radius?: number; step?: number }): { x: number; y: number } | null {
    const target = this.remotes.get(targetId);
    if (!target) return null;

    const baseRadius = options?.radius ?? Math.max(this.mapRef.tileWidth, this.mapRef.tileHeight);
    const maxRings = 8;

    for (let ring = 1; ring <= maxRings; ring++) {
      const r = baseRadius * ring;
      for (let angle = 0; angle < 360; angle += 30) {
        const rad = (angle * Math.PI) / 180;
        const tx =
          Math.round((target.x + Math.cos(rad) * r) / this.mapRef.tileWidth) * this.mapRef.tileWidth +
          this.mapRef.tileWidth / 2;
        const ty =
          Math.round((target.y + Math.sin(rad) * r) / this.mapRef.tileHeight) * this.mapRef.tileHeight +
          this.mapRef.tileHeight / 2;
        if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
      }

      const dirs = [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ];
      for (const [dx, dy] of dirs) {
        const tx =
          Math.round((target.x + dx) / this.mapRef.tileWidth) * this.mapRef.tileWidth + this.mapRef.tileWidth / 2;
        const ty =
          Math.round((target.y + dy) / this.mapRef.tileHeight) * this.mapRef.tileHeight + this.mapRef.tileHeight / 2;
        if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
      }
    }

    return { x: target.x, y: target.y };
  }
}
