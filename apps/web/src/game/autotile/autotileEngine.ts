/**
 * AutotileEngine: pure functional bitmask-based autotile calculations.
 * No Phaser or rendering dependencies.
 */

/** Interface for querying tile data */
export interface AutotileGridLike {
  get(x: number, y: number): number;
}

/** Autotile variant position in spritesheet */
export interface AutotileFrame {
  col: number;
  row: number;
}

/** Autotile definition (matches shared types) */
export interface AutotileVariantMap {
  [bitmask: string]: AutotileFrame;
}

/**
 * Compute 4-bit cardinal bitmask for position (x, y).
 * Only considers neighbors with the same wallTypeId (or any wallTypeId if wallTypeId is 0).
 *
 * Bit layout:
 *   Bit 0 (1) = North (y-1)
 *   Bit 1 (2) = East  (x+1)
 *   Bit 2 (4) = South (y+1)
 *   Bit 3 (8) = West  (x-1)
 *
 * @returns bitmask 0-15
 */
export function computeBitmask4(grid: AutotileGridLike, x: number, y: number, wallTypeId?: number): number {
  const id = wallTypeId ?? grid.get(x, y);
  if (id === 0) return 0;

  let mask = 0;
  if (grid.get(x, y - 1) > 0) mask |= 1; // North
  if (grid.get(x + 1, y) > 0) mask |= 2; // East
  if (grid.get(x, y + 1) > 0) mask |= 4; // South
  if (grid.get(x - 1, y) > 0) mask |= 8; // West

  return mask;
}

/**
 * Maps a bitmask to a spritesheet frame using the variant map.
 */
export function bitmaskToFrame(bitmask: number, variants: AutotileVariantMap): AutotileFrame | null {
  const key = String(bitmask);
  return variants[key] ?? null;
}

/**
 * Returns the 5 tile positions affected when a tile at (x, y) changes.
 * (The tile itself + 4 cardinal neighbors that need bitmask recalculation)
 */
export function getAffectedTiles(x: number, y: number): Array<{ x: number; y: number }> {
  return [
    { x, y }, // center
    { x, y: y - 1 }, // north
    { x: x + 1, y }, // east
    { x, y: y + 1 }, // south
    { x: x - 1, y }, // west
  ];
}
