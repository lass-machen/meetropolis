// Game-related type definitions

export interface Position {
  x: number;
  y: number;
}

export interface RemotePlayer extends Position {
  dnd?: boolean;
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

export interface GameBridge {
  syncRemotePlayers?(players: Record<string, unknown>): void;
  addRemotePlayer?(id: string, data: unknown): void;
  updateRemotePlayer?(id: string, data: unknown): void;
  removeRemotePlayer?(id: string): void;
  updateRemotePlayerDnd?(id: string, dnd: boolean): void;
  setZoneOverlay?(zones: Zone[]): void;
  setSpawnMarker?(pos: Position): void;
  applyTilePaint?(edit: unknown): void;
  fetchAndApplyServerLayers?(): void;
  handleEditorUpdate?(data: unknown): void;
  applyChunkUpdates?(layer: string, updates: unknown[]): void;
  updateTilesetRegistry?(registry: unknown[]): void;
  setDoNotDisturb?(enabled: boolean): void;
  setMovementLocked?(locked: boolean): void;
  setBubbleMembers?(members: Set<string>): void;
  updateSpeakingStates?(speakingIds: Set<string>): void;
  forceReloadMap?(): void;
  onLocalMove?: (pos: Position & { direction: string }) => void;
  onCameraManualChange?: (active: boolean) => void;
  onPointerDown?: (pos: Position) => void;
  onRightClick?: (data: { x: number; y: number; playerId: string | null }) => void;
  lastDirection?: string;
  setSceneApi?(api: unknown): void;
  findFreeSpotNear?(id: string, opts: { radius: number; step: number }): Position | null;
  setDesiredPosition?(pos: Position | null): void;
  recenterCamera?(): void;
  setHeroName?(name: string): void;
  setCollisionVisible?(visible: boolean): void;
  registerTileset?(config: {
    key: string;
    dataUrl: string;
    tileWidth: number;
    tileHeight: number;
    margin: number;
    spacing: number;
  }): Promise<void>;
  reloadEditorLayers?(): void;
  setBackgroundColor?(color: string): void;
}

export interface VolumeManager {
  update(): Record<string, number>;
  getLastVolumes(): Record<string, number>;
}
