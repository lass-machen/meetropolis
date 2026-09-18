// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { AutotileGrid } from './AutotileGrid';
import { AutotileRenderer } from './AutotileRenderer';

const VARIANTS = { '0': { col: 0, row: 0 } };

describe('AutotileRenderer palette resolution', () => {
  it('resolves a persisted slot directly regardless of registration order', () => {
    const sprite = { setDepth: vi.fn(), setOrigin: vi.fn(), setTexture: vi.fn(), destroy: vi.fn() };
    const addSprite = vi.fn().mockReturnValue(sprite);
    const scene = {
      textures: {
        exists: vi.fn().mockReturnValue(true),
        get: vi.fn().mockReturnValue({ source: [{ width: 16 }] }),
      },
      add: { sprite: addSprite },
    } as unknown as Phaser.Scene;
    const grid = new AutotileGrid();
    const renderer = new AutotileRenderer(scene, grid, 16);

    renderer.registerDefinition(9, {
      key: 'persisted-nine',
      tileWidth: 16,
      tileHeight: 48,
      gridHeight: 3,
      variants: VARIANTS,
      textureKey: 'slot-nine',
    });
    renderer.registerDefinition(2, {
      key: 'loaded-later-but-lower',
      tileWidth: 16,
      tileHeight: 16,
      gridHeight: 1,
      variants: VARIANTS,
      textureKey: 'slot-two',
    });
    grid.set(3, 4, 9);

    renderer.updateTile(3, 4);

    expect(addSprite).toHaveBeenCalledWith(56, 72, 'slot-nine', 0);
    expect(sprite.setOrigin).toHaveBeenCalledWith(0.5, 5 / 6);
  });
});
