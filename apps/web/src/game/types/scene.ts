/**
 * Type definition for the Phaser scene used by helper functions in
 * `apps/web/src/game/{ui,collision,camera,map,editor}`.
 *
 * Background: these helpers were historically typed via `Phaser.Scene & any`.
 * This interface documents which properties and methods the scene must
 * provide. The interface is structurally compatible with `MainScene` but
 * also with other scene subclasses (for example from enterprise submodules)
 * that implement the same boundary.
 *
 * Properties are uniformly optional because:
 * - some are set by manager classes or external lifecycle hooks rather than
 *   in the constructor;
 * - some are not currently set in OSS code (for example `hero`, `nameLabels`,
 *   `remotes`) but are read defensively in the helpers; the library
 *   interface allows external subclasses to set them.
 */

import type Phaser from 'phaser';
import type { AutotileGrid, AutotileRenderer } from '../autotile';
import type { V2State } from '../../lib/mapV2';

/**
 * Custom data attached to name-label `Phaser.GameObjects.Container` instances
 * by `ui/nameLabels.ts`. Phaser containers can carry arbitrary properties at
 * runtime; this type documents the fields the helpers read and write so the
 * helpers do not need `any` casts.
 *
 * `width` and `height` overlap with Container's own public members (number)
 * so the extension only narrows their meaning, it does not introduce a new
 * type.
 */
export type NameLabelContainer = Phaser.GameObjects.Container & {
  text?: Phaser.GameObjects.Text;
  playerId?: string | undefined;
  isNpc?: boolean;
  paddingX?: number;
  paddingY?: number;
  bgTexKey?: string;
  bgSprite?: Phaser.GameObjects.Image;
};

/**
 * Tile data nested inside Phaser's runtime tilemap. The public Phaser typings
 * stop at `Phaser.Tilemaps.Tilemap`; the internal `data` blob carries the
 * raw tileset/layer descriptors that `serverSync.ts`, `tilesets.ts` etc. need
 * for serialisation.
 */
export interface TilesetDataEntry {
  name?: string;
  firstgid?: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  margin?: number;
  spacing?: number;
  columns?: number;
  total?: number;
  rows?: number;
}

export interface LayerDataEntry {
  name?: string;
  data?: number[][];
  width?: number;
  height?: number;
  visible?: boolean;
}

export interface TilemapInternalData {
  tilesets?: TilesetDataEntry[];
  layers?: LayerDataEntry[];
  width?: number;
  height?: number;
  tileWidth?: number;
  tileHeight?: number;
}

/**
 * Narrow extension of `Phaser.Tilemaps.Tilemap` exposing the internal `data`
 * blob (which is not part of the public typings).
 */
export type TilemapWithData = Phaser.Tilemaps.Tilemap & {
  data?: TilemapInternalData;
};

/**
 * Minimal shape used as a callback-target by `gameBridge.setSceneApi` while
 * staying decoupled from the SceneApi defined in `bridge.ts`. Helper sites
 * use this when they only need to know that something is "scene-like" and
 * exposes `labelLayer`.
 */
export type SceneWithLabelLayer = Phaser.Scene & {
  labelLayer?: Phaser.GameObjects.Layer | null;
};

export interface MainSceneShape {
  // ---------- Tilemap state (populated by SceneInitializer + chunks/tilesets) ----------
  mapRef?: Phaser.Tilemaps.Tilemap;
  editorGround?: Phaser.Tilemaps.TilemapLayer;
  wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
  loadedChunks: Set<string>;
  v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  bubbleOutlines: Map<string, Phaser.GameObjects.Graphics>;

  // ---------- Public scene state ----------
  currentMapId: string;
  currentMapName: string;
  terrainTilesetSources: Map<string, string>;
  collisionVisible: boolean;
  collisionOverlay?: Phaser.GameObjects.Graphics;
  autotileGrid?: AutotileGrid;
  autotileRenderer?: AutotileRenderer;

  // ---------- Helper-function boundary (set by ui/camera/collision/editor) ----------
  // These properties are only set/read by the `Phaser.Scene & any` helper
  // functions. Data running in parallel on the OSS manager path (e.g.
  // PlayerManager.hero, NameLabelManager.heroNameLabel) is kept separately.
  hero?: Phaser.Physics.Arcade.Sprite;
  nameLabels?: Map<string, Phaser.GameObjects.Container>;
  heroNameLabel?: Phaser.GameObjects.Container;
  remotes?: Map<string, Phaser.GameObjects.Sprite>;
  recenterUi?: Phaser.GameObjects.Container;
  manualCameraActive?: boolean;
  _lastCameraManualNotified?: boolean;
  ghostSprite?: Phaser.GameObjects.Image | undefined;
  ghostTextureKey?: string | undefined;
  _ghostDataUrl?: string;
  staticColliders?: Phaser.Physics.Arcade.StaticGroup;
  heroVsStaticCollider?: Phaser.Physics.Arcade.Collider;
  heroVsTilesCollider?: Phaser.Physics.Arcade.Collider;
  labelLayer?: Phaser.GameObjects.Layer | null;
  labelCamera?: Phaser.Cameras.Scene2D.Camera | null;

  // ---------- Methods that helper functions invoke on the scene ----------
  ensureCollisionCollider(): void;
  rebuildStaticColliders(): void;
  registerTileset(ts: {
    key: string;
    dataUrl: string;
    tileWidth: number;
    tileHeight: number;
    margin?: number | undefined;
    spacing?: number | undefined;
  }): void;
  setSpawnMarker(pos: { x: number; y: number } | null): void;
  setZoneOverlay(polys: { name: string; points: { x: number; y: number }[] }[]): void;
  updateCollisionOverlay(): void;
  ensureEditorLayers(): void;
  waitForTilesetsReady(keys: string[], timeoutMs?: number): Promise<void>;
}

/**
 * Phaser.Scene with all the extensions helper functions expect.
 * Helper functions in `game/{ui,collision,camera,map,editor}` parameterise
 * themselves on this type instead of `Phaser.Scene & any`.
 */
export type MainSceneLike = Phaser.Scene & MainSceneShape;
