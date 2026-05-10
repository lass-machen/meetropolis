// Internal asset-pack payload shapes used during ZIP processing and admin
// route handling. Mirrors the validated ConfigSchema (Zod) plus the loose
// shape we get back from `unzipper` for entries.

export interface AssetPackDirectionalImage {
  rotation: 0 | 90 | 180 | 270;
  dataURL: string;
}

export interface AssetPackItemBase {
  id: string;
  key: string;
  category: 'terrain' | 'structure' | 'objects' | 'autotile';
  dataURL: string;
  collide?: boolean;
  placement?: 'any' | 'floor' | 'wall';
  rotationAllowed?: boolean;
  flipAllowed?: boolean;
  scaleFactor?: number;
  zIndex?: number;
}

export interface AssetPackTerrainItem extends AssetPackItemBase {
  category: 'terrain';
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
}

export interface AssetPackSpriteItem extends AssetPackItemBase {
  category: 'structure' | 'objects';
  width: number;
  height: number;
  directionalImages?: AssetPackDirectionalImage[];
}

export interface AssetPackAutotileVariant {
  col: number;
  row: number;
}

export interface AssetPackAutotileItem extends AssetPackItemBase {
  category: 'autotile';
  tileWidth: number;
  tileHeight: number;
  gridHeight?: number;
  autotileType?: '4bit' | '8bit';
  variants: Record<string, AssetPackAutotileVariant>;
}

export interface AssetPackConfig {
  uuid: string;
  name: string;
  description: string;
  author: string;
  version: string;
  terrain?: AssetPackTerrainItem[];
  structures?: AssetPackSpriteItem[];
  objects?: AssetPackSpriteItem[];
  autotiles?: AssetPackAutotileItem[];
}

// Re-write output extends each item with originalPath when the dataURL has
// been remapped to /packs/{uuid}/... and replaces the dataURL accordingly.
export type AssetPackItemRewritten<T extends AssetPackItemBase> = T & { originalPath?: string };

export interface AssetPackConfigRewritten {
  uuid: string;
  name: string;
  description: string;
  author: string;
  version: string;
  terrain: Array<AssetPackItemRewritten<AssetPackTerrainItem>>;
  structures: Array<AssetPackItemRewritten<AssetPackSpriteItem>>;
  objects: Array<AssetPackItemRewritten<AssetPackSpriteItem>>;
  autotiles: Array<AssetPackItemRewritten<AssetPackAutotileItem>>;
}

// Subset of the unzipper entry interface we actually consume.
export interface ZipEntry {
  path?: string;
  fileName?: string;
  type?: string;
  buffer(): Promise<Buffer>;
}
