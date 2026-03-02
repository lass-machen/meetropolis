/**
 * EditorTypes - Type-Definitionen für den Map-Editor
 *
 * Extrahiert aus EditorService.ts zur Einhaltung des 600 LoC Budgets.
 */

export type EditorTool = 'zone' | 'asset' | 'terrain' | 'collision' | 'spawn' | 'select' | 'erase' | 'wall';
export type EditorCategory = 'general' | 'terrain' | 'structures' | 'objects' | 'zones' | 'collisions' | 'autotiles';

export type Zone = {
  name: string;
  points: { x: number; y: number }[];
  type?: 'default' | 'portal';
  portalTarget?: string;
  portalSpawnX?: number;
  portalSpawnY?: number;
};

export type Asset = {
  id: string;
  key: string;
  dataUrl: string;
  x: number;
  y: number;
  packUuid?: string | undefined;
  itemId?: string | undefined;
  category?: 'structures' | 'objects' | 'terrain' | undefined;
  collide?: boolean | undefined;
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined;
  scaleFactor?: number | undefined;
};

export type PackItem = {
  packUuid: string;
  itemId: string;
  key: string;
  category: 'terrain' | 'structures' | 'objects';
  dataUrl: string;
  width: number;
  height: number;
  collide: boolean;
  rotationAllowed?: boolean | undefined;
  hasDirectionalImages?: boolean | undefined;
  scaleFactor?: number | undefined;
};

export type Tileset = {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number | undefined;
  spacing?: number | undefined;
  category?: string | undefined;
};

export type MapObjectRecord = {
  id: number | string;       // Server ID (number) oder temp ID (negative number/string)
  assetPackUuid: string;
  itemId: string;
  category: string;
  tileX: number;
  tileY: number;
  width: number;
  height: number;
  collide: boolean;
  zIndex: number;
  scaleFactor: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  dataUrl?: string;
  _pending?: 'add';          // Marker für noch nicht gespeicherte Objects
};

export type TerrainPaintOp = {
  layer: string;
  rect: { x0: number; y0: number; x1: number; y1: number };
  tileRefId: number;
  erase?: boolean;
};

export type PendingChanges = {
  terrainPaints: TerrainPaintOp[];
  objectsToAdd: MapObjectRecord[];
  objectsToDelete: (number | string)[];
  objectUpdates: Array<{ id: number | string; updates: Partial<MapObjectRecord> }>;
  zonesModified: boolean;
  spawnUpdate: { x: number; y: number } | null;
};

export type ViewToggles = {
  collision: boolean;
  zones: boolean;
  objects: boolean;
  grid: boolean;
};

export type EditorState = {
  active: boolean;
  tool: EditorTool;
  category: EditorCategory;
  selectedAsset?: Asset | undefined;
  terrainColor?: string | undefined;
  gridVisible: boolean;

  // Zone-Daten
  zones: Zone[];
  editingZoneIndex: number | null;
  zoneName: string;

  // Asset-Daten
  assets: Asset[];
  pendingAsset: {
    key: string;
    dataUrl: string;
    packUuid?: string | undefined;
    itemId?: string | undefined;
    category?: 'structures' | 'objects' | 'terrain' | undefined;
    collide?: boolean | undefined;
    width?: number | undefined;
    height?: number | undefined;
    rotation?: number | undefined;
    rotationAllowed?: boolean | undefined;
    scaleFactor?: number | undefined;
  } | null;
  packItems: PackItem[];

  // Terrain-Daten
  tilesets: Tileset[];

  // Spawn-Daten
  spawn: { x: number; y: number } | null;

  // UI-State
  backgroundColor?: string | undefined;

  // Autotile wall state
  selectedWallTypeId: number;

  // Drag-State (für Tools)
  dragState: {
    startTileX: number;
    startTileY: number;
    endTileX: number;
    endTileY: number;
  } | null;

  // V2 Terrain State
  selectedTileRefId: number;
  selectedTilesetSlot: number;

  // Object Selection
  selectedObjectId: string | null;

  // Map Objects (REST API based, parallel to assets)
  mapObjects: MapObjectRecord[];

  // Pending Changes Buffer
  pendingChanges: PendingChanges;

  // View Toggles
  viewToggles: ViewToggles;
};

// Actions
export type EditorAction =
  | { type: 'ACTIVATE_EDITOR'; category?: EditorCategory }
  | { type: 'DEACTIVATE_EDITOR' }
  | { type: 'SET_TOOL'; tool: EditorTool }
  | { type: 'SET_CATEGORY'; category: EditorCategory }

  // Zone Actions
  | { type: 'START_ZONE_DRAG'; tileX: number; tileY: number }
  | { type: 'UPDATE_ZONE_DRAG'; tileX: number; tileY: number }
  | { type: 'COMPLETE_ZONE'; tileX: number; tileY: number; name?: string }
  | { type: 'DELETE_ZONE'; index: number }
  | { type: 'START_EDIT_ZONE'; index: number }
  | { type: 'UPDATE_ZONE_NAME'; index: number; name: string }
  | { type: 'SET_ZONE_NAME'; name: string }

  // Asset Actions
  | { type: 'SELECT_ASSET'; asset: PackItem }
  | { type: 'PLACE_ASSET'; tileX: number; tileY: number }
  | { type: 'START_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'UPDATE_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'COMPLETE_ASSET_DRAG'; tileX: number; tileY: number }
  | { type: 'DELETE_ASSET'; id: string }
  | { type: 'ADD_PACK_ITEMS'; items: PackItem[] }

  // Tileset Actions
  | { type: 'REGISTER_TILESET'; tileset: Tileset }
  | { type: 'LOAD_TILESETS'; tilesets: Tileset[] }

  // Spawn Actions
  | { type: 'SET_SPAWN'; x: number; y: number }
  | { type: 'CLEAR_SPAWN' }

  // State Actions
  | { type: 'SET_BACKGROUND_COLOR'; color: string }
  | { type: 'SET_TERRAIN_COLOR'; color: string }
  | { type: 'TOGGLE_GRID' }
  | { type: 'LOAD_STATE'; state: Partial<EditorState> }
  | { type: 'CLEAR_DRAG' }

  // Zone Portal Actions
  | { type: 'UPDATE_ZONE_TYPE'; index: number; zoneType: 'default' | 'portal' }
  | { type: 'UPDATE_ZONE_PORTAL'; index: number; portalTarget?: string; portalSpawnX?: number; portalSpawnY?: number }

  // Rotation Actions
  | { type: 'ROTATE_PENDING_ASSET' }

  // Autotile Actions
  | { type: 'SELECT_WALL_TYPE'; wallTypeId: number }

  // V2 Tile Selection
  | { type: 'SELECT_TILE_REF'; tileRefId: number; slot: number; tileIndex: number }

  // Object Selection (for Properties Panel)
  | { type: 'SELECT_MAP_OBJECT'; objectId: string | null }
  | { type: 'UPDATE_MAP_OBJECT'; objectId: number | string; updates: Partial<MapObjectRecord> }

  // Pending Changes
  | { type: 'ADD_PENDING_TERRAIN_PAINT'; paint: TerrainPaintOp }
  | { type: 'ADD_PENDING_OBJECT_CREATE'; object: MapObjectRecord }
  | { type: 'ADD_PENDING_OBJECT_DELETE'; objectId: number | string }
  | { type: 'ADD_PENDING_OBJECT_UPDATE'; objectId: number | string; updates: Partial<MapObjectRecord> }
  | { type: 'MARK_ZONES_MODIFIED' }
  | { type: 'SET_PENDING_SPAWN'; x: number; y: number }
  | { type: 'CLEAR_PENDING_CHANGES' }

  // Map Objects
  | { type: 'LOAD_MAP_OBJECTS'; objects: MapObjectRecord[] }

  // View Toggles
  | { type: 'TOGGLE_VIEW'; key: keyof ViewToggles };

export type EditorListener = (state: EditorState) => void;
