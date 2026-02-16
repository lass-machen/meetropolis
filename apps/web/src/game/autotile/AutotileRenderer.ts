/**
 * AutotileRenderer — Sprite-pool-based renderer for autotile walls.
 * Uses Phaser sprites (not TilemapLayer) for full frame control.
 */

import Phaser from 'phaser';
import { computeBitmask4, bitmaskToFrame } from './autotileEngine';
import { AutotileGrid } from './AutotileGrid';
import type { AutotileVariantMap } from './autotileEngine';
import { logger } from '../../lib/logger';

export interface AutotileDefRuntime {
  key: string;
  tileWidth: number;
  tileHeight: number;
  gridHeight: number;
  variants: AutotileVariantMap;
  textureKey: string;
}

export class AutotileRenderer {
  private scene: Phaser.Scene;
  private grid: AutotileGrid;
  private sprites: Map<string, Phaser.GameObjects.Sprite> = new Map();
  private definitions: Map<number, AutotileDefRuntime> = new Map();
  private tileSize: number;

  constructor(scene: Phaser.Scene, grid: AutotileGrid, tileSize: number = 16) {
    this.scene = scene;
    this.grid = grid;
    this.tileSize = tileSize;
  }

  registerDefinition(wallTypeId: number, def: AutotileDefRuntime): void {
    this.definitions.set(wallTypeId, def);
  }

  updateTile(x: number, y: number): void {
    const spriteKey = `${x}:${y}`;
    const wallTypeId = this.grid.get(x, y);

    if (wallTypeId === 0) {
      const existing = this.sprites.get(spriteKey);
      if (existing) {
        existing.destroy();
        this.sprites.delete(spriteKey);
      }
      return;
    }

    const def = this.definitions.get(wallTypeId);
    if (!def) {
      logger.warn(`[AutotileRenderer] No definition for wallTypeId ${wallTypeId}`);
      return;
    }

    const bitmask = computeBitmask4(this.grid, x, y);
    const frame = bitmaskToFrame(bitmask, def.variants);
    if (!frame) {
      logger.warn(`[AutotileRenderer] No frame for bitmask ${bitmask}`);
      return;
    }

    if (!this.scene.textures.exists(def.textureKey)) return;
    const texture = this.scene.textures.get(def.textureKey);
    const framesPerRow = Math.floor(texture.source[0].width / def.tileWidth);
    const frameIndex = frame.row * framesPerRow + frame.col;

    let sprite = this.sprites.get(spriteKey);
    if (!sprite) {
      sprite = this.scene.add.sprite(
        x * this.tileSize + this.tileSize / 2,
        y * this.tileSize + this.tileSize / 2,
        def.textureKey,
        frameIndex,
      );
      sprite.setDepth(5.1);
      sprite.setOrigin(0.5, 0.5);
      this.sprites.set(spriteKey, sprite);
    } else {
      sprite.setTexture(def.textureKey, frameIndex);
    }
  }

  updateArea(tiles: Array<{ x: number; y: number }>): void {
    for (const tile of tiles) {
      this.updateTile(tile.x, tile.y);
    }
  }

  updateAllVisible(): void {
    for (const [key] of this.grid.entries()) {
      const [xs, ys] = key.split(':');
      const x = Number(xs);
      const y = Number(ys);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.updateTile(x, y);
      }
    }
  }

  clear(): void {
    for (const sprite of this.sprites.values()) {
      sprite.destroy();
    }
    this.sprites.clear();
  }

  destroy(): void {
    this.clear();
    this.definitions.clear();
  }
}
