/**
 * editorAnchors: pure anchor math shared by the editor renderer and input handler.
 *
 * The editor anchors placed map objects with Phaser origin (0, 0) — the
 * sprite's top-left corner sits on the tile origin in world pixels (see
 * assetReducer `tileX * TILE_SIZE` and renderAssets `setOrigin(0, 0)`, which
 * mirror the in-game objectManager). The placement preview ("ghost") MUST use
 * the exact same anchor, otherwise the preview drifts from the real drop spot
 * by a size-dependent offset. These helpers encode that single anchor contract
 * so the ghost and the placed object can never diverge.
 */

/**
 * Origin fractions used for placed map objects and their placement preview.
 * (0, 0) = top-left. Both scaling and rotation pivot around the origin, so a
 * ghost sharing this origin scales and rotates identically to the placed
 * object (same pivot point).
 */
export const PLACEMENT_ORIGIN = { x: 0, y: 0 } as const;

/**
 * World-pixel render position (the value passed to Phaser `setPosition`) for a
 * sprite anchored with {@link PLACEMENT_ORIGIN} on the given tile.
 *
 * Because the origin is the top-left corner, this equals the tile origin and
 * is deliberately independent of the sprite's width, height and scale — which
 * is precisely why a ghost using it lands exactly where the object is placed,
 * regardless of object size.
 */
export function tileToRenderPosition(tileX: number, tileY: number, tileSize: number): { x: number; y: number } {
  return {
    x: tileX * tileSize,
    y: tileY * tileSize,
  };
}
