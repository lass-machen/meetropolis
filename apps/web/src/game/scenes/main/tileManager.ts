import Phaser from 'phaser';
import { EditorService } from '../../../services/EditorService';
import { logger } from '../../../lib/logger';
import { V2State, V2Tileset, computeFirstGids, tileRefIdToGid } from '../../../lib/mapV2';

/**
 * Phaser's public `TilemapLayer` typing does not expose `setTilesets`, which
 * exists at runtime in Phaser 3.60+. We declare a narrow extension so the
 * tile manager can refresh layers after dynamic tileset registration without
 * resorting to `any` casts.
 */
type LayerWithSetTilesets = Phaser.Tilemaps.TilemapLayer & {
  setTilesets?: (tilesets: Phaser.Tilemaps.Tileset[]) => void;
};

export interface TileManagerConfig {
  scene: Phaser.Scene;
  mapRef: Phaser.Tilemaps.Tilemap;
  v2?: { state: V2State; firstGids: number[]; chunkSize: number } | undefined;
  editorGround?: Phaser.Tilemaps.TilemapLayer | undefined;
  wallsLayer?: Phaser.Tilemaps.TilemapLayer | undefined;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer | undefined;
  dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
}

export class TileManager {
  private scene: Phaser.Scene;
  private mapRef: Phaser.Tilemaps.Tilemap;
  private v2: { state: V2State; firstGids: number[]; chunkSize: number } | undefined;
  private editorGround: Phaser.Tilemaps.TilemapLayer | undefined;
  private wallsLayer: Phaser.Tilemaps.TilemapLayer | undefined;
  private collisionLayer: Phaser.Tilemaps.TilemapLayer | undefined;
  private dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
  private backgroundGraphics?: Phaser.GameObjects.Graphics;
  private borderGraphics?: Phaser.GameObjects.Graphics;
  private gridGraphics?: Phaser.GameObjects.Graphics;

  constructor(config: TileManagerConfig) {
    this.scene = config.scene;
    this.mapRef = config.mapRef;
    this.v2 = config.v2;
    this.editorGround = config.editorGround;
    this.wallsLayer = config.wallsLayer;
    this.collisionLayer = config.collisionLayer;
    this.dynamicTilesets = config.dynamicTilesets;
  }

  updateBackgrounds() {
    const state = EditorService.getState();
    const spaceColor = Phaser.Display.Color.HexStringToColor(state.backgroundColor || '#111827').color;
    const terrainColor = Phaser.Display.Color.HexStringToColor(state.terrainColor || '#202020').color;

    if (!this.backgroundGraphics) {
      this.backgroundGraphics = this.scene.add.graphics();
      this.backgroundGraphics.setDepth(-10);
    }

    this.backgroundGraphics.clear();
    this.backgroundGraphics.fillStyle(spaceColor);
    this.scene.cameras.main.setBackgroundColor(state.backgroundColor || '#111827');
    this.backgroundGraphics.fillStyle(terrainColor);
    this.backgroundGraphics.fillRect(0, 0, this.mapRef.widthInPixels, this.mapRef.heightInPixels);

    if (!this.borderGraphics) {
      this.borderGraphics = this.scene.add.graphics();
      this.borderGraphics.setDepth(100);
    }

    this.borderGraphics.clear();
    this.borderGraphics.lineStyle(2, 0x3b82f6, 0.5);
    this.borderGraphics.strokeRect(0, 0, this.mapRef.widthInPixels, this.mapRef.heightInPixels);
  }

  updateGrid() {
    const state = EditorService.getState();

    if (!this.gridGraphics) {
      this.gridGraphics = this.scene.add.graphics();
      this.gridGraphics.setDepth(1000);
    }

    this.gridGraphics.clear();

    if (!state.gridVisible) return;

    const gridColor = 0x888888;
    const alpha = 0.5;

    this.gridGraphics.lineStyle(1, gridColor, alpha);

    const width = this.mapRef.widthInPixels;
    const height = this.mapRef.heightInPixels;
    const tileW = this.mapRef.tileWidth;
    const tileH = this.mapRef.tileHeight;

    for (let x = 0; x <= width; x += tileW) {
      this.gridGraphics.moveTo(x, 0);
      this.gridGraphics.lineTo(x, height);
    }

    for (let y = 0; y <= height; y += tileH) {
      this.gridGraphics.moveTo(0, y);
      this.gridGraphics.lineTo(width, y);
    }

    this.gridGraphics.strokePath();
  }

  eraseTerrainRect(rect: { startX: number; startY: number; endX: number; endY: number }) {
    try {
      const x0 = Math.min(rect.startX, rect.endX);
      const y0 = Math.min(rect.startY, rect.endY);
      const x1 = Math.max(rect.startX, rect.endX);
      const y1 = Math.max(rect.startY, rect.endY);

      // Only modify local tilemap - server persistence happens via EditorPersistence on save
      if (this.editorGround) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            try {
              this.editorGround.removeTileAt(tx, ty);
            } catch {}
          }
        }
      }

      if (this.wallsLayer) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            try {
              this.wallsLayer.removeTileAt(tx, ty);
            } catch {}
          }
        }
      }
    } catch (e) {
      logger.error('[TileManager] eraseTerrainRect failed', e);
    }
  }

  applyTilePaint(
    edit: {
      layer: 'EditorGround' | 'EditorWalls' | 'Collision';
      tilesetKey: string;
      tileIndex: number;
      rect: { startX: number; startY: number; endX: number; endY: number };
    },
    collisionVisible: boolean,
    onCollisionUpdate?: () => void,
  ) {
    try {
      const x0 = Math.min(edit.rect.startX, edit.rect.endX);
      const y0 = Math.min(edit.rect.startY, edit.rect.endY);
      const x1 = Math.max(edit.rect.startX, edit.rect.endX);
      const y1 = Math.max(edit.rect.startY, edit.rect.endY);
      const erase = typeof edit.tileIndex === 'number' && edit.tileIndex <= 0;

      if (edit.layer === 'Collision' && this.collisionLayer) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            if (erase) {
              try {
                this.collisionLayer.removeTileAt(tx, ty);
              } catch {}
            } else {
              try {
                const t = this.collisionLayer.putTileAt(1, tx, ty);
                if (t) t.setCollision(true, true, true, true);
              } catch {}
            }
          }
        }
        if (onCollisionUpdate && collisionVisible) {
          onCollisionUpdate();
        }
      }
      // Server persistence happens via EditorPersistence.saveAllChanges on save
    } catch (e) {
      logger.error('[TileManager] applyTilePaint failed', e);
    }
  }

  updateTilesetRegistry(registry: V2Tileset[]) {
    if (!this.v2 || !this.v2.state) return;

    this.v2.state.tilesetRegistry = registry;

    try {
      this.v2.firstGids = computeFirstGids(registry, this.scene);
    } catch (e) {
      logger.error('[TileManager] Failed to recompute firstGids', e);
    }

    for (const ts of registry) {
      if (!this.dynamicTilesets.has(ts.key) && !this.mapRef?.tilesets.find((t) => t.name === ts.key)) {
        try {
          const phTs = this.mapRef?.addTilesetImage(
            ts.key,
            ts.key,
            ts.tileWidth,
            ts.tileHeight,
            ts.margin ?? 0,
            ts.spacing ?? 0,
          );
          if (phTs) this.dynamicTilesets.set(ts.key, phTs);
        } catch {}
      }
    }

    const all = Array.from(this.dynamicTilesets.values());
    if (this.mapRef) {
      all.push(...this.mapRef.tilesets.filter((t) => !this.dynamicTilesets.has(t.name)));
    }

    try {
      (this.editorGround as LayerWithSetTilesets | undefined)?.setTilesets?.(all);
    } catch {}
    try {
      (this.wallsLayer as LayerWithSetTilesets | undefined)?.setTilesets?.(all);
    } catch {}
    try {
      (this.collisionLayer as LayerWithSetTilesets | undefined)?.setTilesets?.(all);
    } catch {}
  }

  ensureEditorLayers() {
    try {
      const allTilesets = Array.from(this.dynamicTilesets.values());
      if (this.mapRef) {
        allTilesets.push(...this.mapRef.tilesets.filter((ts) => !this.dynamicTilesets.has(ts.name)));
      }

      if (this.editorGround && allTilesets.length > 0) {
        try {
          (this.editorGround as LayerWithSetTilesets).setTilesets?.(allTilesets);
        } catch {}
      }
      if (this.wallsLayer && allTilesets.length > 0) {
        try {
          (this.wallsLayer as LayerWithSetTilesets).setTilesets?.(allTilesets);
        } catch {}
      }
      if (this.collisionLayer && allTilesets.length > 0) {
        try {
          (this.collisionLayer as LayerWithSetTilesets).setTilesets?.(allTilesets);
        } catch {}
      }
    } catch (e) {
      logger.error('[TileManager] ensureEditorLayers failed', e);
    }
  }

  setCollisionLayer(layer: Phaser.Tilemaps.TilemapLayer | undefined) {
    this.collisionLayer = layer;
  }

  getCollisionLayer(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.collisionLayer;
  }

  paintTerrainRect(layer: string, rect: { x0: number; y0: number; x1: number; y1: number }, tileRefId: number): void {
    if (!this.v2) {
      logger.warn('[TileManager] paintTerrainRect: no V2 state');
      return;
    }

    const targetLayer = layer === 'ground' ? this.editorGround : this.wallsLayer;
    if (!targetLayer) {
      logger.warn(`[TileManager] paintTerrainRect: no layer "${layer}"`);
      return;
    }

    const { x0, y0, x1, y1 } = rect;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tileRefId === 0) {
          try {
            targetLayer.removeTileAt(tx, ty);
          } catch {
            /* ignore */
          }
        } else {
          const gid = tileRefIdToGid(tileRefId, this.v2.firstGids);
          if (gid > 0) {
            try {
              targetLayer.putTileAt(gid, tx, ty);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  getEditorGround(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.editorGround;
  }

  getWallsLayer(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.wallsLayer;
  }
}
