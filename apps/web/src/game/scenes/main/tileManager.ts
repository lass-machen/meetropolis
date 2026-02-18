import Phaser from 'phaser';
import { EditorService } from '../../../services/EditorService';
import { logger } from '../../../lib/logger';
import { V2State, computeFirstGids } from '../../../lib/mapV2';

export interface TileManagerConfig {
  scene: Phaser.Scene;
  mapRef: Phaser.Tilemaps.Tilemap;
  v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  editorGround?: Phaser.Tilemaps.TilemapLayer;
  wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
}

export class TileManager {
  private scene: Phaser.Scene;
  private mapRef: Phaser.Tilemaps.Tilemap;
  private v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  private editorGround?: Phaser.Tilemaps.TilemapLayer;
  private wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
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

  eraseTerrainRect(rect: { startX: number; startY: number; endX: number; endY: number }, currentMapId: string) {
    try {
      const x0 = Math.min(rect.startX, rect.endX);
      const y0 = Math.min(rect.startY, rect.endY);
      const x1 = Math.max(rect.startX, rect.endX);
      const y1 = Math.max(rect.startY, rect.endY);

      const apiBase = (window as any).VITE_API_BASE ||
                     (import.meta as any).env?.VITE_API_BASE ||
                     `${window.location.protocol}//${window.location.hostname}:2567`;

      const body = (layer: 'ground' | 'walls') =>
        JSON.stringify({ layer, rect: { x0, y0, x1, y1 }, erase: true });

      const req = (layer: 'ground' | 'walls') =>
        fetch(`${apiBase}/maps/${encodeURIComponent(currentMapId)}/paint-rect`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: body(layer),
        })
        .then(r => r.json().catch(() => ({} as any)))
        .catch(() => ({} as any));

      Promise.all([req('ground'), req('walls')]).then(([g, w]) => {
        try {
          const gUpdates = Array.isArray(g?.updates) ? g.updates : [];
          const wUpdates = Array.isArray(w?.updates) ? w.updates : [];

          if (gUpdates.length === 0 && this.editorGround) {
            for (let ty = y0; ty <= y1; ty++) {
              for (let tx = x0; tx <= x1; tx++) {
                try { this.editorGround.removeTileAt(tx, ty); } catch { }
              }
            }
          }

          if (wUpdates.length === 0 && this.wallsLayer) {
            for (let ty = y0; ty <= y1; ty++) {
              for (let tx = x0; tx <= x1; tx++) {
                try { this.wallsLayer.removeTileAt(tx, ty); } catch { }
              }
            }
          }
        } catch (e) {
          logger.error('[TileManager] eraseTerrainRect local update failed', e);
        }
      });
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
    currentMapId: string,
    collisionVisible: boolean,
    onCollisionUpdate?: () => void
  ) {
    try {
      const x0 = Math.min(edit.rect.startX, edit.rect.endX);
      const y0 = Math.min(edit.rect.startY, edit.rect.endY);
      const x1 = Math.max(edit.rect.startX, edit.rect.endX);
      const y1 = Math.max(edit.rect.startY, edit.rect.endY);
      const layerName = edit.layer === 'Collision' ? 'collision' :
                       (edit.layer === 'EditorWalls' ? 'walls' : 'ground');
      const erase = typeof edit.tileIndex === 'number' && edit.tileIndex <= 0;

      if (layerName === 'collision' && this.collisionLayer) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            if (erase) {
              try { this.collisionLayer.removeTileAt(tx, ty); } catch { }
            } else {
              try {
                const t = this.collisionLayer.putTileAt(1, tx, ty);
                if (t) t.setCollision(true, true, true, true);
              } catch { }
            }
          }
        }

        if (onCollisionUpdate && collisionVisible) {
          onCollisionUpdate();
        }
      }

      const apiBase = (window as any).VITE_API_BASE ||
                     (import.meta as any).env?.VITE_API_BASE ||
                     `${window.location.protocol}//${window.location.hostname}:2567`;

      const payload: any = {
        layer: layerName,
        rect: { x0, y0, x1, y1 },
      };

      if (erase) {
        payload.erase = true;
      } else {
        payload.tileRefId = edit.tileIndex | 0;
      }

      fetch(`${apiBase}/maps/${encodeURIComponent(currentMapId)}/paint-rect`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      .then(res => res.json().catch(() => ({})))
      .then((data: any) => {
        try {
          if (layerName === 'collision' && onCollisionUpdate && collisionVisible) {
            onCollisionUpdate();
          }
        } catch (e) {
          logger.error('[TileManager] applyTilePaint local update failed', e);
        }
      })
      .catch((e) => {
        logger.error('[TileManager] paint-rect failed', e);
      });
    } catch (e) {
      logger.error('[TileManager] applyTilePaint failed', e);
    }
  }

  updateTilesetRegistry(registry: any[]) {
    if (!this.v2 || !this.v2.state) return;

    this.v2.state.tilesetRegistry = registry;

    try {
      this.v2.firstGids = computeFirstGids(registry, this.scene);
    } catch (e) {
      logger.error('[TileManager] Failed to recompute firstGids', e);
    }

    for (const ts of registry) {
      if (!this.dynamicTilesets.has(ts.key) && !this.mapRef?.tilesets.find(t => t.name === ts.key)) {
        try {
          const phTs = this.mapRef?.addTilesetImage(
            ts.key,
            ts.key,
            ts.tileWidth,
            ts.tileHeight,
            ts.margin ?? 0,
            ts.spacing ?? 0
          );
          if (phTs) this.dynamicTilesets.set(ts.key, phTs);
        } catch { }
      }
    }

    const all = Array.from(this.dynamicTilesets.values());
    if (this.mapRef) {
      all.push(...this.mapRef.tilesets.filter(t => !this.dynamicTilesets.has(t.name)));
    }

    try { (this.editorGround as any)?.setTilesets?.(all); } catch { }
    try { (this.wallsLayer as any)?.setTilesets?.(all); } catch { }
    try { (this.collisionLayer as any)?.setTilesets?.(all); } catch { }
  }

  ensureEditorLayers() {
    try {
      const allTilesets = Array.from(this.dynamicTilesets.values());
      if (this.mapRef) {
        allTilesets.push(...this.mapRef.tilesets.filter(ts => !this.dynamicTilesets.has(ts.name)));
      }

      if (this.editorGround && allTilesets.length > 0) {
        try { (this.editorGround as any).setTilesets?.(allTilesets); } catch {}
      }
      if (this.wallsLayer && allTilesets.length > 0) {
        try { (this.wallsLayer as any).setTilesets?.(allTilesets); } catch {}
      }
      if (this.collisionLayer && allTilesets.length > 0) {
        try { (this.collisionLayer as any).setTilesets?.(allTilesets); } catch {}
      }
    } catch (e) {
      logger.error('[TileManager] ensureEditorLayers failed', e);
    }
  }

  setCollisionLayer(layer?: Phaser.Tilemaps.TilemapLayer) {
    this.collisionLayer = layer;
  }

  getCollisionLayer(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.collisionLayer;
  }

  getEditorGround(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.editorGround;
  }

  getWallsLayer(): Phaser.Tilemaps.TilemapLayer | undefined {
    return this.wallsLayer;
  }
}
