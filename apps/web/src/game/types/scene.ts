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

export interface MainSceneShape {
  // ---------- Tilemap-State (per SceneInitializer + chunks/tilesets gesetzt) ----------
  mapRef?: Phaser.Tilemaps.Tilemap;
  editorGround?: Phaser.Tilemaps.TilemapLayer;
  wallsLayer?: Phaser.Tilemaps.TilemapLayer;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  dynamicTilesets: Map<string, Phaser.Tilemaps.Tileset>;
  loadedChunks: Set<string>;
  v2?: { state: V2State; firstGids: number[]; chunkSize: number };
  bubbleOutlines: Map<string, Phaser.GameObjects.Graphics>;

  // ---------- Public Scene-State ----------
  currentMapId: string;
  currentMapName: string;
  terrainTilesetSources: Map<string, string>;
  collisionVisible: boolean;
  collisionOverlay?: Phaser.GameObjects.Graphics;
  autotileGrid?: AutotileGrid;
  autotileRenderer?: AutotileRenderer;

  // ---------- Helper-Function-Boundary (gesetzt von ui/camera/collision/editor) ----------
  // Diese Properties werden nur von den `Phaser.Scene & any`-Helper-Functions
  // gesetzt/gelesen. Im OSS-Manager-Pfad parallel laufende Daten (z.B.
  // PlayerManager.hero, NameLabelManager.heroNameLabel) sind separat.
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

  // ---------- Methoden, die Helper-Functions auf der Scene aufrufen ----------
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
 * Phaser.Scene mit allen Erweiterungen, die Helper-Functions erwarten.
 * Helper-Functions in `game/{ui,collision,camera,map,editor}` parameterisieren
 * sich auf diesen Type statt auf `Phaser.Scene & any`.
 */
export type MainSceneLike = Phaser.Scene & MainSceneShape;
