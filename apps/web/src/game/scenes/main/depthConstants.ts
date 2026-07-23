import type Phaser from 'phaser';

/**
 * Depth-band layout for the world's y-sorted rendering (Strang C).
 *
 * Content that participates in y-sorting (furniture + actors) uses its foot
 * line — the maximum world-Y it occupies — directly as its Phaser depth, so a
 * sprite standing further south (larger Y) renders in front of one standing
 * north of it. That "sort band" spans [0, mapHeightPx].
 *
 * Fixed layers sit OUTSIDE the band: the terrain/ground/wall tile layers below
 * it (negative constants, independent of map size); overhead objects and the
 * editor/UI overlays above it. The above-band depths are multiples of the map
 * height so they never collide with the sort band of a very tall map (a naive
 * 100000/200000 hardcode would break once footY approached it — see C1a).
 */

// Fixed underlayers, always below the sort band (which starts at 0). Ordered
// background < ground < walls; the collision layer is invisible but kept below
// the band for a stable order.
export const DEPTH_BACKGROUND = -1000;
export const DEPTH_GROUND = -900;
export const DEPTH_WALLS = -800;
export const DEPTH_COLLISION = -700;
// Editor "terrain" objects (e.g. rugs placed as objects) render on the floor,
// under every actor and every sorted object.
export const DEPTH_FLOOR_OBJECT = -500;

/**
 * Render layer a map object opts into. Populated by the seed pipeline in Strang
 * B (generator + importer + editor) from the asset's manifest category; absent
 * on legacy rows and treated as 'sorted'.
 *  - 'floor'    : flat, always under actors (terrain/rugs)
 *  - 'sorted'   : y-sorted by foot line (default: furniture, plants)
 *  - 'overhead' : always above actors (wall art, whiteboards, hanging plants)
 */
export type RenderLayer = 'floor' | 'sorted' | 'overhead';

export function normalizeRenderLayer(value: unknown): RenderLayer {
  return value === 'floor' || value === 'overhead' ? value : 'sorted';
}

/** Map height in pixels, used to place the above-band overlays. Falls back to a
 * large value so overlays stay above any plausible sort band before the map is
 * ready. */
export function mapHeightPx(scene: { mapRef?: Phaser.Tilemaps.Tilemap }): number {
  return scene.mapRef?.heightInPixels ?? 4000;
}

/** Overhead objects: always above every actor (actor depth <= mapHeightPx),
 * still y-sorted among themselves via footY. */
export function overheadDepth(footY: number, mapH: number): number {
  return mapH * 2 + footY;
}
/** Editor zone/spawn overlays: above overhead, below border/grid. */
export function editorOverlayDepth(mapH: number): number {
  return mapH * 3.5;
}
export function borderDepth(mapH: number): number {
  return mapH * 4;
}
export function gridDepth(mapH: number): number {
  return mapH * 5;
}

/** Foot line (y-sort depth) of a top-left-origin object of the given displayed
 * height. Pure so it is unit-testable; rotated objects use the sprite's AABB
 * bottom instead (origin math no longer holds). */
export function objectFootDepth(topY: number, displayHeight: number): number {
  return topY + displayHeight;
}

/** Foot line of a center-origin actor sprite. */
export function actorFootDepth(centerY: number, displayHeight: number): number {
  return centerY + displayHeight / 2;
}
