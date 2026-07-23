import Phaser from 'phaser';
import { logger } from '../../lib/logger';
import type { MainSceneLike, TilemapWithData, TilesetDataEntry } from '../types/scene';

type TilesetSpec = {
  key: string;
  dataUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number | undefined;
  spacing?: number | undefined;
};

/**
 * Phaser's `TilemapLayer` does not publicly declare `setTilesets` or the
 * `tileset` field, both of which exist at runtime and are used to refresh
 * the layer with newly registered tilesets.
 */
type LayerWithTilesets = Phaser.Tilemaps.TilemapLayer & {
  setTilesets?: (tilesets: Phaser.Tilemaps.Tileset[]) => void;
  tileset?: Phaser.Tilemaps.Tileset[];
};

/**
 * Tilemap instance with the internal `_nextDynamicFirstGid` allocator state
 * used by `assignNextDynamicFirstGid`.
 */
type TilemapWithAllocator = TilemapWithData & {
  _nextDynamicFirstGid?: number;
};

function computeNameForTileset(key: string): string {
  if (!key || key.length > 64 || key.startsWith('data:') || key.includes('data:image')) {
    return `tileset-${Date.now()}`;
  }
  return key;
}

function assignNextDynamicFirstGid(scene: MainSceneLike): number {
  try {
    if (!scene.mapRef) return 0;
    const map = scene.mapRef as TilemapWithAllocator;
    if (!map._nextDynamicFirstGid) {
      const maxGid = Math.max(1, ...scene.mapRef.tilesets.map((t) => t.firstgid || 1));
      map._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
    }
    const assigned = map._nextDynamicFirstGid;
    map._nextDynamicFirstGid += 1024;
    return assigned;
  } catch {
    return 0;
  }
}

function pushTilesetIntoMapData(
  scene: MainSceneLike,
  textureKey: string,
  name: string,
  tileW: number,
  tileH: number,
  margin: number,
  spacing: number,
  assignedFirstGid: number,
): void {
  try {
    const data = (scene.mapRef as TilemapWithData | undefined)?.data;
    const tex = scene.textures.get(textureKey);
    const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
    if (data && src) {
      const imgW = src.width || 0;
      const imgH = src.height || 0;
      const cols = Math.max(1, Math.floor((imgW - margin + spacing) / (tileW + spacing)));
      const rows = Math.max(1, Math.floor((imgH - margin + spacing) / (tileH + spacing)));
      const tilecount = Math.max(0, cols * rows);
      const existsInData = Array.isArray(data.tilesets) && data.tilesets.find((t) => t.name === name);
      if (!existsInData) {
        data.tilesets = data.tilesets || [];
        const entry: TilesetDataEntry & { source?: undefined; tilecount?: number } = {
          firstgid: assignedFirstGid || 1,
          source: undefined,
          name,
          image: textureKey,
          imagewidth: imgW,
          imageheight: imgH,
          tilewidth: tileW,
          tileheight: tileH,
          margin,
          spacing,
          columns: cols,
          tilecount,
        };
        data.tilesets.push(entry);
      }
    }
  } catch {}
}

function maybeCreateScaledTexture(
  scene: MainSceneLike,
  ts: TilesetSpec,
  safeKey: string,
): { textureKey: string; tileW: number; tileH: number } {
  let textureKeyForMap = safeKey;
  let tileWForMap = ts.tileWidth;
  let tileHForMap = ts.tileHeight;
  try {
    const map = scene.mapRef;
    const tex = scene.textures.get(safeKey);
    const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
    if (map && src && (ts.tileWidth !== map.tileWidth || ts.tileHeight !== map.tileHeight)) {
      const sx = map.tileWidth / ts.tileWidth;
      const sy = map.tileHeight / ts.tileHeight;
      const cw = Math.max(1, Math.round(src.width * sx));
      const ch = Math.max(1, Math.round(src.height * sy));
      const scaledKey = `${safeKey}__scaled_${map.tileWidth}x${map.tileHeight}`;
      if (!scene.textures.exists(scaledKey)) {
        const ctex = scene.textures.createCanvas(scaledKey, cw, ch);
        const ctx = ctex?.getContext();
        if (ctex && ctx) {
          ctx.clearRect(0, 0, cw, ch);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(src, 0, 0, cw, ch);
          ctex.refresh();
        }
      }
      if (scene.textures.exists(scaledKey)) {
        textureKeyForMap = scaledKey;
        tileWForMap = map.tileWidth;
        tileHForMap = map.tileHeight;
      }
    }
  } catch {}
  return { textureKey: textureKeyForMap, tileW: tileWForMap, tileH: tileHForMap };
}

function tilesetFitsArea(
  scene: MainSceneLike,
  ts: TilesetSpec,
  textureKey: string,
  tileW: number,
  tileH: number,
): boolean {
  try {
    const tex2 = scene.textures.get(textureKey);
    const src2 = tex2?.getSourceImage?.() as HTMLImageElement | HTMLCanvasElement | undefined;
    const margin = ts.margin ?? 0;
    const spacing = ts.spacing ?? 0;
    const imgW = src2?.width ?? 0;
    const imgH = src2?.height ?? 0;
    const fitsW = imgW > 0 ? (imgW - margin + spacing) % (tileW + spacing) === 0 : true;
    const fitsH = imgH > 0 ? (imgH - margin + spacing) % (tileH + spacing) === 0 : true;
    if (!fitsW || !fitsH) {
      logger.debug('[ASSETS_DBG][Scene] skip tileset (non-multiple area)', {
        key: ts.key,
        imgW,
        imgH,
        tileWForMap: tileW,
        tileHForMap: tileH,
        margin,
        spacing,
      });
      return false;
    }
  } catch {}
  return true;
}

function applyTilesetsToAllLayers(scene: MainSceneLike, tileset: Phaser.Tilemaps.Tileset): void {
  const allTilesets = Array.from(scene.dynamicTilesets.values());
  const extra = scene.mapRef
    ? scene.mapRef.tilesets.filter((t) => !scene.dynamicTilesets.has(t.name))
    : ([] as Phaser.Tilemaps.Tileset[]);
  allTilesets.push(...extra);
  if (scene.editorGround) {
    const layer = scene.editorGround as LayerWithTilesets;
    try {
      layer.setTilesets?.(allTilesets);
    } catch {}
    try {
      layer.tileset = allTilesets;
    } catch {}
  }
  if (scene.wallsLayer) {
    const layer = scene.wallsLayer as LayerWithTilesets;
    try {
      layer.setTilesets?.(allTilesets);
    } catch {}
    try {
      layer.tileset = allTilesets;
    } catch {}
  }
  if (scene.collisionLayer) {
    (scene.collisionLayer as LayerWithTilesets).setTilesets?.(allTilesets);
  }
  if (!scene.editorGround && scene.mapRef) {
    try {
      const tmp = scene.mapRef.createBlankLayer(
        'EditorGround',
        tileset,
        0,
        0,
        scene.mapRef.width,
        scene.mapRef.height,
        scene.mapRef.tileWidth,
        scene.mapRef.tileHeight,
      );
      if (tmp) {
        scene.editorGround = tmp;
        scene.editorGround.setDepth(1);
      }
    } catch {}
  }
}

function createTilesetOnMap(
  scene: MainSceneLike,
  ts: TilesetSpec,
  name: string,
  textureKey: string,
  tileW: number,
  tileH: number,
): Phaser.Tilemaps.Tileset | null {
  try {
    if (!scene.mapRef) return null;
    const map = scene.mapRef;
    const assignedFirstGid = assignNextDynamicFirstGid(scene);
    pushTilesetIntoMapData(scene, textureKey, name, tileW, tileH, ts.margin ?? 0, ts.spacing ?? 0, assignedFirstGid);
    try {
      if (!map.tilesets.find((t) => t.name === name)) {
        const meta = new Phaser.Tilemaps.Tileset(
          name,
          assignedFirstGid || 1,
          tileW,
          tileH,
          ts.margin ?? 0,
          ts.spacing ?? 0,
        );
        map.tilesets.push(meta);
      }
    } catch {}
    const tileset = map.addTilesetImage(
      name,
      textureKey,
      tileW,
      tileH,
      ts.margin ?? 0,
      ts.spacing ?? 0,
      assignedFirstGid || undefined,
    );
    if (tileset) {
      try {
        if (!map.tilesets.find((t) => t.name === tileset.name)) {
          map.tilesets.push(tileset);
        }
      } catch {}
      scene.dynamicTilesets.set(name, tileset);
      logger.debug('Tileset', `Successfully added tileset ${name}`);
    }
    return tileset;
  } catch (err) {
    logger.warn('Tileset', `Failed to create tileset ${name}:`, err);
    return null;
  }
}

function handleTextureLoaded(scene: MainSceneLike, ts: TilesetSpec, safeKey: string, nameForTileset: string): void {
  let tileset: Phaser.Tilemaps.Tileset | null = null;
  try {
    if (!scene.mapRef) return;
    const { textureKey, tileW, tileH } = maybeCreateScaledTexture(scene, ts, safeKey);
    if (!tilesetFitsArea(scene, ts, textureKey, tileW, tileH)) return;

    const existingTileset2 = scene.mapRef.tilesets.find((t) => t.name === nameForTileset);
    if (existingTileset2) {
      tileset = existingTileset2;
      scene.dynamicTilesets.set(nameForTileset, tileset);
      logger.debug('Tileset', `Using existing tileset ${existingTileset2.name} for ${nameForTileset}`);
    } else {
      tileset = createTilesetOnMap(scene, ts, nameForTileset, textureKey, tileW, tileH);
      if (!tileset) return;
    }
    if (tileset) applyTilesetsToAllLayers(scene, tileset);
  } catch (error) {
    logger.warn('Tileset', `Failed to add tileset ${safeKey}:`, error);
  }
}

function loadTextureForTileset(scene: MainSceneLike, ts: TilesetSpec, safeKey: string): void {
  const isDataUrl = typeof ts.dataUrl === 'string' && ts.dataUrl.startsWith('data:');
  if (isDataUrl) {
    scene.textures.addBase64(safeKey, ts.dataUrl);
  } else {
    try {
      if (typeof ts.dataUrl === 'string' && !ts.dataUrl.startsWith('data:')) {
        scene.load.setCORS('anonymous');
      }
      scene.load.image(safeKey, ts.dataUrl);
      scene.load.start();
    } catch {}
  }
}

function handleTilesetWithExistingTexture(scene: MainSceneLike, ts: TilesetSpec): void {
  try {
    if (!scene.mapRef) return;
    const map = scene.mapRef;
    const assignedFirstGid = assignNextDynamicFirstGid(scene);
    pushTilesetIntoMapData(
      scene,
      ts.key,
      ts.key,
      ts.tileWidth || 16,
      ts.tileHeight || 16,
      ts.margin ?? 0,
      ts.spacing ?? 0,
      assignedFirstGid,
    );
    try {
      if (!map.tilesets.find((t) => t.name === ts.key)) {
        const meta = new Phaser.Tilemaps.Tileset(
          ts.key,
          assignedFirstGid || 1,
          ts.tileWidth,
          ts.tileHeight,
          ts.margin ?? 0,
          ts.spacing ?? 0,
        );
        map.tilesets.push(meta);
      }
    } catch {}
    const tileset = map.addTilesetImage(
      ts.key,
      ts.key,
      ts.tileWidth,
      ts.tileHeight,
      ts.margin ?? 0,
      ts.spacing ?? 0,
      assignedFirstGid || undefined,
    );
    if (tileset) {
      scene.dynamicTilesets.set(ts.key, tileset);
      const allTilesets = Array.from(scene.dynamicTilesets.values());
      allTilesets.push(...scene.mapRef.tilesets.filter((t) => !scene.dynamicTilesets.has(t.name)));
      if (scene.editorGround) {
        const layer = scene.editorGround as LayerWithTilesets;
        try {
          layer.setTilesets?.(allTilesets);
        } catch {}
        try {
          layer.tileset = allTilesets;
        } catch {}
      }
      if (scene.wallsLayer) {
        const layer = scene.wallsLayer as LayerWithTilesets;
        try {
          layer.setTilesets?.(allTilesets);
        } catch {}
        try {
          layer.tileset = allTilesets;
        } catch {}
      }
      if (scene.collisionLayer) {
        (scene.collisionLayer as LayerWithTilesets).setTilesets?.(allTilesets);
      }
    }
  } catch (error) {
    logger.warn('Tileset', `Failed to add existing tileset ${ts.key}:`, error);
  }
}

export function registerTileset(scene: MainSceneLike, ts: TilesetSpec): void {
  const nameForTileset = computeNameForTileset(ts.key || '');
  logger.debug('[ASSETS_DBG][Scene] registerTileset', {
    key: nameForTileset,
    url: ts.dataUrl?.slice?.(0, 32) || typeof ts.dataUrl,
    tw: ts.tileWidth,
    th: ts.tileHeight,
    m: ts.margin ?? 0,
    s: ts.spacing ?? 0,
  });
  // The renderer presence check is a runtime guard: in tests/SSR the game
  // object may be present without a renderer, which would crash addTilesetImage.
  if (!scene.mapRef || !scene.game || !(scene.game as Phaser.Game & { renderer?: unknown }).renderer) return;

  const existingTileset = scene.mapRef.tilesets.find((t) => t.name === nameForTileset);
  if (existingTileset) {
    scene.dynamicTilesets.set(nameForTileset, existingTileset);
    return;
  }
  try {
    if (scene.dynamicTilesets.has(ts.key)) return;
  } catch {}
  if (!scene.textures.exists(ts.key)) {
    let key = nameForTileset;
    while (scene.textures.exists(key)) {
      key = `${nameForTileset}-${Date.now()}`;
    }
    const safeKey = key;
    scene.textures.once('addtexture', (eventKey: string) => {
      logger.debug('[ASSETS_DBG][Scene] addtexture event', { key: eventKey, safeKey });
      if (eventKey === safeKey && scene.mapRef) {
        handleTextureLoaded(scene, ts, safeKey, nameForTileset);
      }
    });
    loadTextureForTileset(scene, ts, safeKey);
  } else {
    handleTilesetWithExistingTexture(scene, ts);
  }
}
