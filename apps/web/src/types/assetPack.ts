// Asset pack JSON shape; mirrors the data returned by GET /asset-packs
// and matches the server-side ConfigSchema in apps/server/src/api/routes/assetPacks.ts.
// These types describe the *consumed* form of asset packs (the dataURL fields
// have been rewritten by the server to absolute /packs/{uuid}/... paths).

export interface AssetPackDirectionalImage {
  rotation: 0 | 90 | 180 | 270;
  dataURL: string;
}

export interface AssetPackTerrain {
  id: string;
  key: string;
  category: 'terrain';
  dataURL: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  collide?: boolean;
}

export interface AssetPackSprite {
  id: string;
  key: string;
  category: 'structure' | 'objects';
  dataURL: string;
  width: number;
  height: number;
  collide?: boolean;
  rotationAllowed?: boolean;
  flipAllowed?: boolean;
  scaleFactor?: number;
  directionalImages?: AssetPackDirectionalImage[];
}

export interface AssetPackAutotileVariant {
  col: number;
  row: number;
}

export interface AssetPackAutotile {
  id: string;
  key: string;
  category: 'autotile';
  dataURL: string;
  tileWidth: number;
  tileHeight: number;
  variants: Record<string, AssetPackAutotileVariant>;
  collide?: boolean;
  placement?: 'any' | 'floor' | 'wall';
  scaleFactor?: number;
}

export interface AssetPackJson {
  uuid: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  terrain?: AssetPackTerrain[];
  structures?: AssetPackSprite[];
  objects?: AssetPackSprite[];
  autotiles?: AssetPackAutotile[];
}

// ---------------------------------------------------------------------------
// Editor-side derived shapes (computed from AssetPackJson by useEditorLoader)
// ---------------------------------------------------------------------------

export interface PackTileset {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  category: 'terrain';
}

export interface PackItem {
  packUuid: string;
  itemId: string;
  key: string;
  category: 'terrain' | 'structures' | 'objects';
  dataUrl: string;
  width?: number;
  height?: number;
  collide: boolean;
  rotationAllowed?: boolean;
  hasDirectionalImages?: boolean;
  scaleFactor?: number;
}

export interface AutotileEditorItem {
  wallTypeId: number;
  packUuid: string;
  autotileId: string;
  key: string;
  textureUrl: string;
  tileWidth: number;
  tileHeight: number;
  variants: Record<string, AssetPackAutotileVariant>;
  collide: boolean;
  placement: 'any' | 'floor' | 'wall';
}

// Shape returned by GET /maps/:id/objects (used by loadMapObjects).
// Mirrors the Prisma MapObject row that the server serializes.
export interface MapObjectPayload {
  id: string | number;
  assetPackUuid: string;
  itemId: string;
  dataUrl?: string;
  tileX: number;
  tileY: number;
  category: string;
  collide: boolean;
  width: number;
  height: number;
  zIndex: number;
  rotation?: number;
  scaleFactor: number;
  flipX?: boolean;
  flipY?: boolean;
}

// Shape returned by GET /maps/:id/editor-state
export interface EditorStatePayload {
  zones?: Array<{
    name?: string;
    points?: Array<{ x: number; y: number }>;
    polygon?: Array<{ x: number; y: number }> | { points?: Array<{ x: number; y: number }> };
    type?: string;
    portalTarget?: string;
    portalSpawnX?: number;
    portalSpawnY?: number;
  }>;
  backgroundColor?: string;
  editorGround?: unknown[];
  editorWalls?: unknown[];
  collision?: unknown[];
  spawn?: { x: number; y: number };
}
