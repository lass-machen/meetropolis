import { useEffect, useRef } from 'react';
import { logger } from '../../../lib/logger';
import { splitTilesetImage } from '../../../lib/tilesetUtils';
import { gameBridge } from '../../../game/bridge';
import { useMapStore } from '../../../state/mapStore';
import { loadFromPacks } from '../../../lib/directionalImageRegistry';
import { EditorService } from '../../../services/EditorService';
import type {
  AssetPackJson,
  AutotileEditorItem,
  EditorStatePayload,
  MapObjectPayload,
  PackItem,
  PackTileset,
} from '../../../types/assetPack';

/**
 * Resolves relative pack URLs (e.g. "/packs/{uuid}/file.png") to absolute URLs
 * using the API base. This is necessary for Tauri/WKWebView where relative URLs
 * resolve against the internal origin (tauri://localhost) instead of the API server.
 *
 * Data URLs, blob URLs, and already-absolute HTTP(S) URLs are returned unchanged.
 */
function resolvePackUrl(url: string, apiBase: string): string {
  if (
    !url ||
    url.startsWith('data:') ||
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('blob:')
  )
    return url;
  if (url.startsWith('/')) return `${apiBase}${url}`;
  return url;
}

// Setter is loosely typed because the editor store is typed as `any` at the
// caller (see useWorldHooksComposite.ts). We preserve that contract here.
type EditorSetter = (updater: unknown) => void;

interface UseEditorLoaderParams {
  me: { id: string; email: string; name?: string } | null;
  apiBase: string;
  setEditor: EditorSetter;
}

async function buildPackItemsFromTerrain(p: AssetPackJson, apiBase: string, packItems: PackItem[]) {
  const uuid = p.uuid;
  for (const t of p.terrain || []) {
    const resolvedTerrainUrl = resolvePackUrl(t.dataURL, apiBase);
    if (t.dataURL) {
      try {
        const splitOpts: { tileWidth: number; tileHeight: number; margin?: number; spacing?: number } = {
          tileWidth: t.tileWidth,
          tileHeight: t.tileHeight,
        };
        if (t.margin !== undefined) splitOpts.margin = t.margin;
        if (t.spacing !== undefined) splitOpts.spacing = t.spacing;
        const tiles = await splitTilesetImage(resolvedTerrainUrl, splitOpts);
        for (const tile of tiles) {
          packItems.push({
            packUuid: uuid,
            itemId: `${t.id}:${tile.row}:${tile.col}`,
            key: `${t.key}-${tile.row}-${tile.col}`,
            category: 'terrain',
            dataUrl: tile.dataUrl,
            width: t.tileWidth,
            height: t.tileHeight,
            collide: !!t.collide,
          });
        }
      } catch (e) {
        logger.warn('[WorldApp] Failed to split tileset:', t.key, e);
        packItems.push({
          packUuid: uuid,
          itemId: t.id,
          key: t.key,
          category: 'terrain',
          dataUrl: resolvedTerrainUrl,
          width: t.tileWidth,
          height: t.tileHeight,
          collide: !!t.collide,
        });
      }
    } else {
      packItems.push({
        packUuid: uuid,
        itemId: t.id,
        key: t.key,
        category: 'terrain',
        dataUrl: resolvedTerrainUrl,
        width: t.tileWidth,
        height: t.tileHeight,
        collide: !!t.collide,
      });
    }
  }
}

async function processPacks(
  packs: AssetPackJson[],
  apiBase: string,
): Promise<{ packTilesets: PackTileset[]; packItems: PackItem[] }> {
  const packTilesets: PackTileset[] = [];
  const packItems: PackItem[] = [];
  for (const p of packs || []) {
    const uuid = p.uuid;
    for (const t of p.terrain || []) {
      packTilesets.push({
        key: `${uuid}:${t.key}`,
        dataUrl: resolvePackUrl(t.dataURL, apiBase),
        tileWidth: t.tileWidth,
        tileHeight: t.tileHeight,
        margin: t.margin ?? 0,
        spacing: t.spacing ?? 0,
        category: 'terrain',
      });
    }
    await buildPackItemsFromTerrain(p, apiBase, packItems);
    for (const s of p.structures || []) {
      packItems.push({
        packUuid: uuid,
        itemId: s.id,
        key: s.key,
        category: 'structures',
        dataUrl: resolvePackUrl(s.dataURL, apiBase),
        width: s.width,
        height: s.height,
        collide: !!s.collide,
        scaleFactor: s.scaleFactor || 1,
      });
    }
    for (const o of p.objects || []) {
      packItems.push({
        packUuid: uuid,
        itemId: o.id,
        key: o.key,
        category: 'objects',
        dataUrl: resolvePackUrl(o.dataURL, apiBase),
        width: o.width,
        height: o.height,
        collide: !!o.collide,
        rotationAllowed: !!o.rotationAllowed,
        hasDirectionalImages: Array.isArray(o.directionalImages) && o.directionalImages.length > 0,
        scaleFactor: o.scaleFactor || 1,
      });
    }
  }
  return { packTilesets, packItems };
}

function buildAutotileItems(packs: AssetPackJson[], apiBase: string): AutotileEditorItem[] {
  const autotileItems: AutotileEditorItem[] = [];
  let nextWallTypeId = 1;
  const sortedPacksForAutotiles = [...(packs || [])].sort((a, b) => (a.uuid || '').localeCompare(b.uuid || ''));
  for (const p of sortedPacksForAutotiles) {
    const sortedAutotiles = [...(p.autotiles || [])].sort((a, b) => (a.id || '').localeCompare(b.id || ''));
    for (const at of sortedAutotiles) {
      autotileItems.push({
        wallTypeId: nextWallTypeId++,
        packUuid: p.uuid,
        autotileId: at.id,
        key: at.key,
        textureUrl: resolvePackUrl(at.dataURL, apiBase),
        tileWidth: at.tileWidth,
        tileHeight: at.tileHeight,
        variants: at.variants || {},
        collide: at.collide ?? true,
        placement: at.placement ?? 'wall',
      });
    }
  }
  return autotileItems;
}

interface EditorStateWithTilesets {
  tilesets?: PackTileset[];
  packItems?: PackItem[];
  [k: string]: unknown;
}

function applyPackTilesetsToEditor(setEditor: EditorSetter, packTilesets: PackTileset[]) {
  setEditor((s: unknown) => {
    const state = (s as EditorStateWithTilesets) || {};
    const existing = state.tilesets || [];
    const merged: PackTileset[] = [...existing];
    for (const ts of packTilesets) {
      const idx = merged.findIndex((m) => m.key === ts.key);
      if (idx >= 0) merged[idx] = ts;
      else merged.push(ts);
    }
    window.pendingTilesets = merged;
    return { ...state, tilesets: merged };
  });
  try {
    for (const ts of packTilesets) {
      gameBridge.registerTileset({
        key: ts.key,
        dataUrl: ts.dataUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        margin: ts.margin ?? 0,
        spacing: ts.spacing ?? 0,
      });
    }
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

function applyLocalPackItems(setEditor: EditorSetter) {
  try {
    const raw = localStorage.getItem('meetropolis.packItems');
    if (!raw) return;
    const local: unknown = JSON.parse(raw);
    if (!Array.isArray(local)) return;
    const localItems = local as PackItem[];
    setEditor((s: unknown) => {
      const state = (s as EditorStateWithTilesets) || {};
      const current: PackItem[] = state.packItems || [];
      const seen = new Set(current.map((p) => p.key));
      const next: PackItem[] = [...current];
      for (const li of localItems) {
        if (li && !seen.has(li.key)) {
          next.push(li);
          seen.add(li.key);
        }
      }
      return { ...state, packItems: next };
    });
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

async function loadAssetPacks(apiBase: string, setEditor: EditorSetter) {
  try {
    const res = await fetch(`${apiBase}/asset-packs`, { credentials: 'include' });
    if (res.ok) {
      const packs = ((await res.json()) as AssetPackJson[]) || [];
      loadFromPacks(packs, (url: string) => resolvePackUrl(url, apiBase));
      const { packTilesets, packItems } = await processPacks(packs, apiBase);
      if (packTilesets.length > 0) applyPackTilesetsToEditor(setEditor, packTilesets);
      setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), packItems }));
      const autotileItems = buildAutotileItems(packs, apiBase);
      if (autotileItems.length > 0) {
        EditorService.dispatch({ type: 'SET_AUTOTILE_ITEMS', items: autotileItems });
        try {
          gameBridge.registerAutotiles(autotileItems);
        } catch (e) {
          logger.debug('[EditorLoader] Autotile registration deferred', e);
        }
      }
    }
    applyLocalPackItems(setEditor);
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

function loadDefaultTilesets(setEditor: EditorSetter) {
  const defaultTs: Array<{
    key: string;
    dataUrl: string;
    tileWidth: number;
    tileHeight: number;
    category: 'terrain' | 'objects';
  }> = [
    {
      key: 'office_tiles',
      dataUrl: '/assets/tilesets/office_tiles.png',
      tileWidth: 16,
      tileHeight: 16,
      category: 'terrain',
    },
    {
      key: 'furniture_tiles',
      dataUrl: '/assets/tilesets/furniture_tiles.png',
      tileWidth: 16,
      tileHeight: 16,
      category: 'objects',
    },
    {
      key: 'decor_tiles',
      dataUrl: '/assets/tilesets/decor_tiles.png',
      tileWidth: 16,
      tileHeight: 16,
      category: 'objects',
    },
  ];
  window.pendingTilesets = defaultTs;
  setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), tilesets: defaultTs }));
  // registerTileset is synchronous (returns void) so no await is needed,
  // but it is wrapped in try/catch because the internal pipeline has
  // promise-spawning side effects.
  try {
    for (const ts of defaultTs) {
      gameBridge.registerTileset({
        key: ts.key,
        dataUrl: ts.dataUrl,
        tileWidth: ts.tileWidth,
        tileHeight: ts.tileHeight,
        margin: 0,
        spacing: 0,
      });
    }
  } catch (e) {
    logger.warn('[EDITOR] Tileset registration failed (non-critical):', e);
  }
}

type EditorStateZone = NonNullable<EditorStatePayload['zones']>[number];

function extractZonePoints(poly: EditorStateZone): Array<{ x: number; y: number }> {
  if (Array.isArray(poly.points)) return poly.points;
  if (Array.isArray(poly.polygon)) return poly.polygon;
  if (poly.polygon && typeof poly.polygon === 'object' && 'points' in poly.polygon) {
    const inner = poly.polygon.points;
    if (Array.isArray(inner)) return inner;
  }
  return [];
}

function applyEditorState(data: EditorStatePayload | null | undefined, setEditor: EditorSetter) {
  if (!data) return;
  if (data.zones)
    try {
      const zones = Array.isArray(data.zones)
        ? data.zones.map((z) => {
            const pts = extractZonePoints(z);
            return {
              name: z.name,
              points: pts,
              type: z.type,
              portalTarget: z.portalTarget,
              portalSpawnX: z.portalSpawnX,
              portalSpawnY: z.portalSpawnY,
            };
          })
        : [];
      setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), zones }));
      try {
        gameBridge.setZoneOverlay(zones.map((z) => ({ name: z.name ?? '', points: z.points })));
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  if (typeof data.backgroundColor === 'string') {
    const backgroundColor = data.backgroundColor;
    setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), backgroundColor }));
    try {
      gameBridge.setBackgroundColor(backgroundColor);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  if (Array.isArray(data.editorGround) || Array.isArray(data.editorWalls) || Array.isArray(data.collision)) {
    try {
      gameBridge.reloadEditorLayers();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  if (data.spawn && typeof data.spawn.x === 'number') {
    const spawn = { x: data.spawn.x, y: data.spawn.y };
    setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), spawn }));
    try {
      gameBridge.setSpawnMarker(spawn);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
}

async function loadMapObjects(apiBase: string, mapId: string, setEditor: EditorSetter) {
  try {
    const objRes = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/objects`, { credentials: 'include' });
    if (!objRes.ok) return;
    const objects = (await objRes.json()) as MapObjectPayload[];
    if (!Array.isArray(objects)) return;
    EditorService.dispatch({ type: 'LOAD_MAP_OBJECTS', objects });
    const TILE_SIZE = 16;
    const derivedAssets = objects.map((obj) => ({
      id: String(obj.id),
      key: `${obj.assetPackUuid}:${obj.itemId}`,
      dataUrl: resolvePackUrl(obj.dataUrl || '', apiBase),
      x: obj.tileX * TILE_SIZE,
      y: obj.tileY * TILE_SIZE,
      packUuid: obj.assetPackUuid,
      itemId: obj.itemId,
      category: obj.category,
      collide: obj.collide,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation ?? 0,
      scaleFactor: obj.scaleFactor ?? 1,
    }));
    setEditor((s: unknown) => ({ ...((s as EditorStateWithTilesets) || {}), assets: derivedAssets }));
  } catch (e) {
    logger.debug('[WorldApp] Failed to load map objects', e);
  }
}

async function loadMapEditorData(apiBase: string, setEditor: EditorSetter) {
  try {
    const mapId = useMapStore.getState().currentMapId;
    if (!mapId) return;
    const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`, { credentials: 'include' });
    if (res.ok) {
      const data = (await res.json()) as EditorStatePayload;
      applyEditorState(data, setEditor);
    }
    await loadMapObjects(apiBase, mapId, setEditor);
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

export function useEditorLoader({ me, apiBase, setEditor }: UseEditorLoaderParams) {
  const hasLoadedRef = useRef(false);
  const setEditorRef = useRef(setEditor);
  setEditorRef.current = setEditor;

  useEffect(() => {
    if (!me) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    void loadAssetPacks(apiBase, (updater: unknown) => setEditorRef.current(updater));
    try {
      gameBridge.fetchAndApplyServerLayers();
    } catch {
      /* */
    }
    loadDefaultTilesets((updater: unknown) => setEditorRef.current(updater));
    try {
      gameBridge.reloadEditorLayers();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    void loadMapEditorData(apiBase, (updater: unknown) => setEditorRef.current(updater));
  }, [me, apiBase]);
}
