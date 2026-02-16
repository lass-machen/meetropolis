/** Position in spritesheet grid */
export interface AutotileVariant {
  col: number;
  row: number;
}

/** Maps bitmask string to spritesheet position */
export type AutotileVariantMap = Record<string, AutotileVariant>;

/** Autotile algorithm type */
export type AutotileType = '4bit' | '8bit';

/** Full definition of an autotile item (as stored in asset pack config) */
export interface AutotileDefinition {
  id: string;
  key: string;
  category: 'autotile';
  dataURL: string;
  placement: 'wall' | 'floor' | 'any';
  collide: boolean;
  tileWidth: number;
  tileHeight: number;
  gridHeight: number;
  autotileType: AutotileType;
  variants: AutotileVariantMap;
  scaleFactor?: number;
}
