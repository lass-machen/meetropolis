// Game-related type definitions

export interface Position {
  x: number;
  y: number;
}

export interface RemotePlayer extends Position {
  dnd?: boolean;
  avatarId?: string;
}

export interface Zone {
  name: string;
  points: Position[];
}

export interface ZoneManager {
  getZones(): Zone[];
  setZones(zones: Zone[]): void;
  update(pos: Position): void;
}

/** Direction value used by the player schema; mirrors `Direction` in bridge.ts. */
export type PlayerDirection = 'up' | 'down' | 'left' | 'right';

/** Layer name accepted by `applyChunkUpdates`. */
export type ChunkLayerName = 'ground' | 'walls' | 'collision' | 'walls_auto';

/** Layer name accepted by `applyTilePaint`. */
export type EditorPaintLayer = 'EditorGround' | 'EditorWalls' | 'Collision';

export interface RemotePlayerData {
  x: number;
  y: number;
  direction: PlayerDirection;
  name?: string | undefined;
  dnd?: boolean | undefined;
  avatarId?: string | undefined;
  isNpc?: boolean | undefined;
}

export interface RemotePlayerPatch {
  x?: number;
  y?: number;
  direction?: PlayerDirection;
  name?: string | undefined;
  dnd?: boolean | undefined;
  avatarId?: string | undefined;
}

export interface TilePaintEdit {
  layer: EditorPaintLayer;
  tilesetKey: string;
  tileIndex: number;
  rect: { startX: number; startY: number; endX: number; endY: number };
}

export interface TilesetRegistration {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number | undefined;
  spacing?: number | undefined;
}

export interface ChunkUpdateEntry {
  key: string;
  version: number;
  encoding: string;
  data: string;
}

export interface AutotileRegistration {
  wallTypeId: number;
  key: string;
  textureUrl: string;
  tileWidth: number;
  tileHeight: number;
  variants: Record<string, { col: number; row: number }>;
  packUuid: string;
}

export interface ObjectsUpdatedPayload {
  action: 'add' | 'remove' | 'update';
  objects?: unknown[] | undefined;
  objectIds?: number[] | undefined;
}

export interface EditorUpdatePayload {
  type?: string;
  edit?: TilePaintEdit;
  polys?: Zone[];
  pos?: { x: number; y: number };
  [key: string]: unknown;
}

export interface AssetPreviewPayload {
  dataUrl: string;
  width?: number | undefined;
  height?: number | undefined;
  rotation?: number | undefined;
  packUuid?: string | undefined;
  itemId?: string | undefined;
}

/**
 * Independent reasons that can freeze the local player. Several subsystems
 * write the movement lock concurrently; the bridge keeps the active reasons
 * so that releasing one never clears another one's lock.
 */
export type MovementLockReason = 'dnd' | 'bubble' | 'editor';

/**
 * Canonical bridge between the React world and the Phaser scene. The
 * implementation lives in `../game/bridge.ts` as the `gameBridge` object.
 * Optional members reflect the underlying SceneApi which may be partially
 * implemented or not yet attached.
 */
export interface GameBridge {
  // Player sync
  syncRemotePlayers: (players: Record<string, RemotePlayerData>) => void;
  addRemotePlayer: (id: string, data: RemotePlayerData) => void;
  updateRemotePlayer: (id: string, data: RemotePlayerPatch) => void;
  removeRemotePlayer: (id: string) => void;
  updateRemotePlayerDnd: (id: string, dnd: boolean) => void;

  // Zones
  setZoneOverlay: (polys: Zone[]) => void;
  setZonesVisible: (visible: boolean) => void;

  // Spawn
  setSpawnMarker: (pos: { x: number; y: number } | null) => void;

  // Tiles / editor
  applyTilePaint: (edit: TilePaintEdit) => void;
  fetchAndApplyServerLayers: () => void;
  handleEditorUpdate?: (data: EditorUpdatePayload) => void;
  applyChunkUpdates?: (layer: ChunkLayerName, updates: ChunkUpdateEntry[]) => void;
  updateTilesetRegistry?: (registry: unknown[]) => void;
  reloadEditorLayers: () => void;
  setCollisionVisible: (visible: boolean) => void;
  setBackgroundColor: (color: string) => void;
  registerTileset: (config: TilesetRegistration) => void;
  saveEditorLayersHard?: () => void;
  forceReloadMap?: () => void;
  captureEditorSnapshot: () => void;
  restoreEditorSnapshot: () => void;
  registerAutotiles: (items: AutotileRegistration[]) => void;
  hydrateTilesetsCache: (tilesets: TilesetRegistration[]) => void;
  handleObjectsUpdated: (data: ObjectsUpdatedPayload) => void;
  setAssetPreview: (preview: AssetPreviewPayload | null) => void;
  setEditorMode: (enabled: boolean) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  changeHeroAvatar: (avatarId: string) => void;

  // Legacy paint methods (no-ops kept for compatibility)
  applyTerrainPaint: (edit: {
    rect: { startX: number; startY: number; endX: number; endY: number };
    dataUrl: string;
  }) => void;
  applyTerrainPaintV2: (edit: {
    rect: { x0: number; y0: number; x1: number; y1: number };
    tileRefId: number;
    layer: string;
  }) => void;
  eraseTerrainRect: (rect: { startX: number; startY: number; endX: number; endY: number }) => void;
  applyWallPaint: (edit: {
    rect: { startX: number; startY: number; endX: number; endY: number };
    wallTypeId: number;
  }) => void;

  // Bubble / DND / volume
  setDoNotDisturb: (enabled: boolean) => void;
  setMovementLocked: (locked: boolean, reason: MovementLockReason) => void;
  setBubbleMembers: (members: Set<string>) => void;
  updateSpeakingStates: (speakingIds: Set<string>) => void;
  setHeroName: (name: string) => void;

  // Pointer / hero
  onLocalMove: (pos: { x: number; y: number; direction: PlayerDirection }) => void;
  onCameraManualChange?: (active: boolean) => void;
  onPointerDown: (pos: { x: number; y: number }) => void;
  onRightClick: (data: { x: number; y: number; playerId?: string }) => void;
  // Legacy tile pointer callbacks (no-op)
  onPointerDownTile: (pos: { tileX: number; tileY: number }) => void;
  onPointerMoveTile: (pos: { tileX: number; tileY: number }) => void;
  onPointerUpTile: (pos: { tileX: number; tileY: number }) => void;

  // Scene wiring
  // Typed as `unknown` because the concrete SceneApi shape lives in
  // `../game/bridge.ts` and importing it here would create a cycle.
  setSceneApi: (api: unknown) => void;

  // Navigation helpers
  findFreeSpotNear: (id: string, opts?: { radius?: number; step?: number }) => { x: number; y: number } | null;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  recenterCamera: () => void;
}

export interface VolumeManager {
  update(): Record<string, number>;
  getLastVolumes(): Record<string, number>;
}
