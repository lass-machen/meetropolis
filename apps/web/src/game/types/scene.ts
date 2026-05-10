/**
 * Type-Definition für die Phaser-Scene, wie sie von den Helper-Functions
 * in `apps/web/src/game/{ui,collision,camera,map,editor}` erwartet wird.
 *
 * Hintergrund: Diese Helper-Functions waren historisch via `Phaser.Scene & any`
 * typisiert. Das Interface hier dokumentiert, welche Properties und Methoden
 * tatsächlich auf der Scene erwartet werden — strukturell kompatibel mit
 * `MainScene`, aber auch mit anderen Scene-Subclasses (z.B. aus
 * Enterprise-Submodulen), die dieselben Boundaries bedienen.
 *
 * Properties sind durchgängig optional, weil:
 * - manche von Manager-Klassen oder externen Lifecycle-Hooks gesetzt werden,
 *   nicht im Constructor;
 * - manche im OSS-Code aktuell nicht gesetzt werden (z.B. `hero`, `nameLabels`,
 *   `remotes`), aber in den Helper-Functions defensiv gelesen werden — die
 *   Library-Schnittstelle erlaubt externe Subclasses, sie zu setzen.
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
