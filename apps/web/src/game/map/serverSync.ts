import Phaser from 'phaser';
import { gameBridge } from '../bridge';
import { logger } from '../../lib/logger';
import { getApiBaseFromWindow } from '../../lib/runtimeConfig';
import type { MainSceneLike } from '../types/scene';

type LayerName = 'editorGround' | 'editorWalls' | 'collision';

/** Raw tileset entry from `GET /maps/:id/editor-state`. */
interface ServerTilesetEntry {
  key?: string;
  dataUrl?: string;
  tileWidth?: number;
  tileHeight?: number;
  margin?: number;
  spacing?: number;
}

/** Raw zone entry from server (legacy or modern shape). */
interface ServerZoneEntry {
  name?: string;
  points?: Array<{ x: number; y: number } | [number, number]>;
  polygon?:
    | Array<{ x: number; y: number } | [number, number]>
    | { points?: Array<{ x: number; y: number } | [number, number]> };
  capacity?: number;
  type?: string;
  portalTarget?: string;
  portalSpawnX?: number;
  portalSpawnY?: number;
}

/** Full editor-state response shape. Fields are optional because the API
 *  returns partial states for newly created maps. */
interface ServerEditorState {
  tilesets?: ServerTilesetEntry[];
  backgroundColor?: string;
  spawn?: { x: number; y: number } | null;
  zones?: ServerZoneEntry[];
  editorGround?: number[];
  editorWalls?: number[];
  collision?: number[];
}

/** Minimal view of the internal `TilemapLayer.layer` structure that this
 *  module mutates when patching collision-layer dimensions. */
interface PhaserLayerData {
  data: Phaser.Tilemaps.Tile[][];
  width?: number;
  height?: number;
}

type LayerWithInternal = Phaser.Tilemaps.TilemapLayer & {
  layer?: PhaserLayerData;
  setTilesets?: (tilesets: Phaser.Tilemaps.Tileset[]) => void;
  tileset?: Phaser.Tilemaps.Tileset[];
};

function applyTilesetsFromServer(scene: MainSceneLike, data: ServerEditorState): string[] {
  const requiredTsKeys: string[] = [];
  try {
    const arr: ServerTilesetEntry[] = Array.isArray(data.tilesets) ? data.tilesets : [];
    // Hydrate bridge cache so subsequent uploads don't overwrite existing tilesets
    try {
      gameBridge.hydrateTilesetsCache(
        arr.map((t) => ({
          key: t.key ?? '',
          dataUrl: t.dataUrl ?? '',
          tileWidth: t.tileWidth ?? 0,
          tileHeight: t.tileHeight ?? 0,
          margin: t.margin,
          spacing: t.spacing,
        })),
      );
    } catch (e) {
      logger.error('Failed to hydrate tileset cache', e);
    }

    for (const ts of arr) {
      if (ts && ts.key && ts.dataUrl && ts.tileWidth && ts.tileHeight) {
        scene.registerTileset({
          key: ts.key,
          dataUrl: ts.dataUrl,
          tileWidth: ts.tileWidth,
          tileHeight: ts.tileHeight,
          margin: ts.margin ?? 0,
          spacing: ts.spacing ?? 0,
        });
        if (typeof ts.key === 'string' && typeof ts.dataUrl === 'string' && ts.key.startsWith('terrain:')) {
          scene.terrainTilesetSources.set(ts.key, ts.dataUrl);
        }
        try {
          requiredTsKeys.push(ts.key);
        } catch {}
      }
    }
  } catch {}
  return requiredTsKeys;
}

function applyBackgroundAndSpawn(scene: MainSceneLike, data: ServerEditorState): void {
  try {
    const bg = typeof data.backgroundColor === 'string' ? data.backgroundColor : null;
    if (bg) {
      scene.cameras.main.setBackgroundColor(bg);
    }
    const sp = data.spawn;
    if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
      try {
        scene.setSpawnMarker(sp);
      } catch {}
    }
  } catch {}
}

function normalizeZonePoints(pts: Array<{ x: number; y: number } | [number, number]>): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const v of pts) {
    if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
      out.push({ x: v[0], y: v[1] });
    } else if (
      v &&
      typeof v === 'object' &&
      'x' in v &&
      'y' in v &&
      typeof v.x === 'number' &&
      typeof v.y === 'number'
    ) {
      out.push({ x: v.x, y: v.y });
    }
  }
  return out;
}

function applyZonesFromServer(scene: MainSceneLike, data: ServerEditorState): void {
  try {
    const zones = Array.isArray(data.zones)
      ? data.zones.map((z: ServerZoneEntry) => {
          const anyZ = z ?? {};
          const polygonObj = !Array.isArray(anyZ.polygon) && anyZ.polygon ? anyZ.polygon : null;
          const ptsRaw = Array.isArray(anyZ.points)
            ? anyZ.points
            : Array.isArray(anyZ.polygon)
              ? anyZ.polygon
              : polygonObj && Array.isArray(polygonObj.points)
                ? polygonObj.points
                : [];
          return {
            name: anyZ.name ?? '',
            points: normalizeZonePoints(ptsRaw),
            capacity: anyZ.capacity ?? undefined,
            type: anyZ.type ?? undefined,
            portalTarget: anyZ.portalTarget ?? undefined,
            portalSpawnX: anyZ.portalSpawnX ?? undefined,
            portalSpawnY: anyZ.portalSpawnY ?? undefined,
          };
        })
      : [];
    if (zones.length > 0) {
      try {
        scene.setZoneOverlay(zones);
      } catch {}
      // Dispatch event so ZoneManager gets updated with server-loaded zones (including portal metadata)
      try {
        window.dispatchEvent(new CustomEvent('server_zones_loaded', { detail: { zones } }));
      } catch {}
    }
  } catch {}
}

function fixCollisionLayerDimensions(scene: MainSceneLike, layer: Phaser.Tilemaps.TilemapLayer): void {
  const layerData = (layer as LayerWithInternal).layer;
  if (!layerData?.data) return;
  logger.debug('Load', `Collision layer actual size: ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
  const expectedRows = scene.mapRef!.height;
  const actualRows = layerData.data.length;
  if (actualRows < expectedRows) {
    logger.debug('Load', `Fixing collision layer dimensions again: ${actualRows} rows -> ${expectedRows} rows`);
    while (layerData.data.length < expectedRows) {
      const newRow = new Array<Phaser.Tilemaps.Tile>(scene.mapRef!.width);
      for (let x = 0; x < scene.mapRef!.width; x++) {
        newRow[x] = new Phaser.Tilemaps.Tile(
          layerData,
          -1,
          x,
          layerData.data.length,
          scene.mapRef!.tileWidth,
          scene.mapRef!.tileHeight,
          scene.mapRef!.tileWidth,
          scene.mapRef!.tileHeight,
        );
      }
      layerData.data.push(newRow);
    }
    layerData.height = expectedRows;
    logger.debug('Load', `Fixed collision layer to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
  }
}

function applyTilesToLayer(
  scene: MainSceneLike,
  arr: number[] | null | undefined,
  layer: Phaser.Tilemaps.TilemapLayer | undefined,
  layerName: LayerName | undefined,
  width: number,
  height: number,
  storedW: number,
): void {
  if (!arr || !layer) return;
  try {
    const allTilesets = Array.from(scene.dynamicTilesets.values());
    allTilesets.push(...scene.mapRef!.tilesets.filter((ts) => !scene.dynamicTilesets.has(ts.name)));
    const layerExt = layer as LayerWithInternal;
    layerExt.setTilesets?.(allTilesets);
    layerExt.tileset = allTilesets;
  } catch {}
  if (layerName === 'collision') {
    logger.debug('Load', `Applying collision: ${arr.length} tiles to ${width}x${height} layer`);
    const allTilesets = Array.from(scene.dynamicTilesets.values());
    allTilesets.push(...scene.mapRef!.tilesets.filter((ts) => !scene.dynamicTilesets.has(ts.name)));
    (layer as LayerWithInternal).setTilesets?.(allTilesets);
    fixCollisionLayerDimensions(scene, layer);
  }
  let appliedCount = 0;
  let validTileCount = 0;
  for (const idx of arr) {
    if (typeof idx === 'number' && idx >= 0) validTileCount++;
  }
  if (layerName === 'collision') {
    logger.debug('Load', `Found ${validTileCount} valid collision tiles`);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = arr[y * storedW + x];
      if (typeof idx === 'number' && idx >= 0) {
        try {
          layer.putTileAt(idx, x, y);
          appliedCount++;
        } catch (e) {
          if (layerName === 'collision' && appliedCount === 0) {
            logger.error('Load', `First collision tile failed at ${x},${y} with index ${idx}`, e);
          }
        }
      }
    }
  }
  if (layerName === 'collision') {
    logger.debug('Load', `Applied ${appliedCount} collision tiles`);
  }
}

async function applyLayerData(scene: MainSceneLike, data: ServerEditorState, requiredTsKeys: string[]): Promise<void> {
  try {
    await scene.waitForTilesetsReady(requiredTsKeys, 1500);
  } catch {}
  if (!scene.mapRef) return;
  const storedW = scene.mapRef.width;
  const width = scene.mapRef.width;
  const height = scene.mapRef.height;
  scene.ensureEditorLayers();
  applyTilesToLayer(scene, data.editorGround, scene.editorGround, 'editorGround', width, height, storedW);
  applyTilesToLayer(scene, data.editorWalls, scene.wallsLayer, 'editorWalls', width, height, storedW);
  applyTilesToLayer(scene, data.collision, scene.collisionLayer, 'collision', width, height, storedW);
  if (data.collision) {
    scene.rebuildStaticColliders();
    scene.ensureCollisionCollider();
  }
  if (scene.collisionVisible) scene.updateCollisionOverlay();
}

export async function fetchAndApplyServerLayers(scene: MainSceneLike): Promise<void> {
  try {
    const base = getApiBaseFromWindow();
    const res = await fetch(`${base}/maps/${encodeURIComponent(scene.currentMapId)}/editor-state?t=${Date.now()}`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = (await res.json()) as ServerEditorState;
    const requiredTsKeys = applyTilesetsFromServer(scene, data);
    applyBackgroundAndSpawn(scene, data);
    if (data.collision) {
      const collisionTiles = data.collision.filter((t: number) => t !== -1).length;
      logger.debug('Load', `Received from server: ${collisionTiles} collision tiles`);
    }
    applyZonesFromServer(scene, data);
    await applyLayerData(scene, data, requiredTsKeys);
  } catch (e) {
    logger.error('Load', 'Failed to fetch/apply server layers', e);
  }
}
