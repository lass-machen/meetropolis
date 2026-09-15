import type { AssetId, ThemeId } from './assets.ts';

export type OfficeId = 'loft' | 'studio' | 'campus';
export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}
export interface PlacedAsset extends Point {
  id: string;
  asset: AssetId;
}
export interface OfficeZone extends Rect {
  id: string;
  name: string;
  detail: string;
  kind: 'work' | 'focus' | 'lounge' | 'meeting' | 'coffee' | 'arrival';
  entry: Point;
  surface?: 'carpet' | 'garden';
}
export interface Workplace {
  id: string;
  approach: Point;
}
export interface OfficePreset {
  id: OfficeId;
  name: string;
  subtitle: string;
  defaultTheme: ThemeId;
  capacity: number;
  world: { width: number; height: number; tile: 16 };
  bounds: Rect;
  spawn: Point;
  placements: PlacedAsset[];
  /** Weltpixel am 16-Pixel-Raster: jede Wandzelle blockiert genau 16 × 16 Pixel. */
  walls: Point[];
  zones: OfficeZone[];
  workplaces: Workplace[];
}
