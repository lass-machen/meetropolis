import { describe, it, expect } from 'vitest';
import { PLACEMENT_ORIGIN, tileToRenderPosition } from './editorAnchors';

/**
 * The tile size the editor works in. Mirrors assetReducer TILE_SIZE and the
 * EditorInputHandler default; the placement ground truth below depends on it.
 */
const TILE_SIZE = 16;

/**
 * Local model of Phaser's origin semantics (no Phaser/canvas needed).
 *
 * A Phaser image positioned at (pos.x, pos.y) with fractional origin
 * (origin.x, origin.y) renders its top-left corner at
 *   pos - origin * (scaledSize).
 * Scaling and rotation both pivot around the origin point, which in world
 * space is exactly `pos`. This is the single behaviour the fix relies on.
 */
function spriteTopLeft(
  pos: { x: number; y: number },
  origin: { x: number; y: number },
  width: number,
  height: number,
  scaleFactor: number,
): { x: number; y: number } {
  return {
    x: pos.x - origin.x * width * scaleFactor,
    y: pos.y - origin.y * height * scaleFactor,
  };
}

/**
 * Ground truth for a PLACED object, encoded independently of the production
 * anchor helpers so the equality assertions are not circular:
 * - render position = `tileX * TILE_SIZE` (assetReducer buildAssetFromPending)
 * - origin (0, 0)   = renderAssets / in-game objectManager `setOrigin(0, 0)`
 */
function placement(tileX: number, tileY: number) {
  return {
    pos: { x: tileX * TILE_SIZE, y: tileY * TILE_SIZE },
    origin: { x: 0, y: 0 },
  };
}

/** Anchor of the GHOST preview as wired in production (renderGhost + input handler). */
function ghost(tileX: number, tileY: number) {
  return {
    pos: tileToRenderPosition(tileX, tileY, TILE_SIZE),
    origin: PLACEMENT_ORIGIN,
  };
}

// Representative sizes: 1x1 tile, a multi-tile object (desk 48x32), a wide/tall
// object, at scale 1 and scale != 1.
const CASES = [
  { name: '1x1 tile, scale 1', w: 16, h: 16, scale: 1 },
  { name: 'desk 48x32, scale 1', w: 48, h: 32, scale: 1 },
  { name: 'desk 48x32, scale 2', w: 48, h: 32, scale: 2 },
  { name: 'desk 48x32, scale 0.5', w: 48, h: 32, scale: 0.5 },
  { name: 'tall 16x64, scale 1.5', w: 16, h: 64, scale: 1.5 },
];

// A handful of tiles including negatives (map origin quadrant).
const TILES = [
  { tileX: 0, tileY: 0 },
  { tileX: 5, tileY: 3 },
  { tileX: 12, tileY: 20 },
  { tileX: -4, tileY: -7 },
];

describe('editor ghost anchor matches placement anchor', () => {
  it('exposes the placement origin as top-left (0, 0)', () => {
    expect(PLACEMENT_ORIGIN).toEqual({ x: 0, y: 0 });
  });

  it('renders the ghost at the tile origin, independent of object size and scale', () => {
    // The render position must not depend on width/height/scale — that
    // independence is what removes the size-dependent offset.
    expect(tileToRenderPosition(5, 3, TILE_SIZE)).toEqual({ x: 80, y: 48 });
    expect(tileToRenderPosition(-4, -7, TILE_SIZE)).toEqual({ x: -64, y: -112 });
  });

  for (const tile of TILES) {
    for (const c of CASES) {
      it(`ghost top-left equals placement top-left — ${c.name} at (${tile.tileX},${tile.tileY})`, () => {
        const p = placement(tile.tileX, tile.tileY);
        const g = ghost(tile.tileX, tile.tileY);

        const placedTopLeft = spriteTopLeft(p.pos, p.origin, c.w, c.h, c.scale);
        const ghostTopLeft = spriteTopLeft(g.pos, g.origin, c.w, c.h, c.scale);

        expect(ghostTopLeft).toEqual(placedTopLeft);
        // And it is literally the tile origin in world pixels.
        expect(ghostTopLeft).toEqual({ x: tile.tileX * TILE_SIZE, y: tile.tileY * TILE_SIZE });
      });
    }
  }

  it('shares the rotation pivot with the placed object (same origin point in world space)', () => {
    // Under Phaser rotation the fixed point is the origin point, i.e. the
    // render position. Equal render position + equal origin => identical pivot,
    // so ghost and placed object stay congruent at any rotation.
    for (const tile of TILES) {
      const p = placement(tile.tileX, tile.tileY);
      const g = ghost(tile.tileX, tile.tileY);
      expect(g.pos).toEqual(p.pos);
      expect(g.origin).toEqual(p.origin);
    }
  });

  it('keeps the terrain ghost (16x16) from flipping a half tile', () => {
    // Terrain tiles are placed at tileX*TILE_SIZE with origin (0,0) too. If only
    // the origin were changed but the position left at the tile centre, the
    // terrain ghost would sit half a tile off. Guard that regression.
    const tile = { tileX: 7, tileY: 9 };
    const p = placement(tile.tileX, tile.tileY);
    const g = ghost(tile.tileX, tile.tileY);
    const placed = spriteTopLeft(p.pos, p.origin, 16, 16, 1);
    const preview = spriteTopLeft(g.pos, g.origin, 16, 16, 1);
    expect(preview).toEqual(placed);
    expect(preview).toEqual({ x: 7 * TILE_SIZE, y: 9 * TILE_SIZE });
  });
});

describe('historical ghost-anchor bug (regression record)', () => {
  // The old ghost used the Phaser default centre origin (0.5) positioned at the
  // TILE CENTRE. This block documents exactly why the symptom was
  // size-dependent and pins the mechanism so it cannot silently return.
  const OLD_GHOST_ORIGIN = { x: 0.5, y: 0.5 };
  function oldGhostPos(tileX: number, tileY: number) {
    return {
      x: tileX * TILE_SIZE + TILE_SIZE / 2,
      y: tileY * TILE_SIZE + TILE_SIZE / 2,
    };
  }

  it('had NO visible offset for 1x1 objects (why the bug was easy to miss)', () => {
    const tile = { tileX: 3, tileY: 4 };
    const p = placement(tile.tileX, tile.tileY);
    const placed = spriteTopLeft(p.pos, p.origin, 16, 16, 1);
    const oldPreview = spriteTopLeft(oldGhostPos(tile.tileX, tile.tileY), OLD_GHOST_ORIGIN, 16, 16, 1);
    // centre - 0.5*16 = origin: the two errors cancel exactly at 16x16.
    expect(oldPreview).toEqual(placed);
  });

  it('offset a 48x32 desk by (w*scale/2 - tileSize/2, h*scale/2 - tileSize/2)', () => {
    const tile = { tileX: 3, tileY: 4 };
    const w = 48;
    const h = 32;
    const scale = 1;
    const p = placement(tile.tileX, tile.tileY);
    const placed = spriteTopLeft(p.pos, p.origin, w, h, scale);
    const oldPreview = spriteTopLeft(oldGhostPos(tile.tileX, tile.tileY), OLD_GHOST_ORIGIN, w, h, scale);

    expect(oldPreview).not.toEqual(placed);
    // Placed object lands down-right of the old ghost by this amount.
    expect(placed.x - oldPreview.x).toBe((w * scale) / 2 - TILE_SIZE / 2); // 16
    expect(placed.y - oldPreview.y).toBe((h * scale) / 2 - TILE_SIZE / 2); // 8
  });

  it('offset grew with scale (larger object => larger drift)', () => {
    const tile = { tileX: 0, tileY: 0 };
    const w = 48;
    const h = 32;
    const scale = 2;
    const p = placement(tile.tileX, tile.tileY);
    const placed = spriteTopLeft(p.pos, p.origin, w, h, scale);
    const oldPreview = spriteTopLeft(oldGhostPos(tile.tileX, tile.tileY), OLD_GHOST_ORIGIN, w, h, scale);
    expect(placed.x - oldPreview.x).toBe((w * scale) / 2 - TILE_SIZE / 2); // 40
    expect(placed.y - oldPreview.y).toBe((h * scale) / 2 - TILE_SIZE / 2); // 24

    // The fixed ghost, by contrast, has zero drift at the same scale.
    const g = ghost(tile.tileX, tile.tileY);
    const fixedPreview = spriteTopLeft(g.pos, g.origin, w, h, scale);
    expect(fixedPreview).toEqual(placed);
  });
});
