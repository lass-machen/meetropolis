import { useEffect, useRef } from 'react';
import { logger } from '../../../lib/logger';
import { splitTilesetImage } from '../../../lib/tilesetUtils';
import { gameBridge } from '../../../game/bridge';
import { useMapStore } from '../../../state/mapStore';
import { loadFromPacks } from '../../../lib/directionalImageRegistry';
import { EditorService } from '../../../services/EditorService';

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

interface UseEditorLoaderParams {
  me: { id: string; email: string; name?: string } | null;
  apiBase: string;
  setEditor: (editor: any) => void;
}

async function buildPackItemsFromTerrain(p: any, apiBase: string, packItems: any[]) {
  const uuid = p.uuid;
  for (const t of p.terrain || []) {
    const resolvedTerrainUrl = resolvePackUrl(t.dataURL, apiBase);
    if (t.dataURL) {
      try {
        const tiles = await splitTilesetImage(resolvedTerrainUrl, {
          tileWidth: t.tileWidth,
          tileHeight: t.tileHeight,
          margin: t.margin,
          spacing: t.spacing,
        });
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

async function processPacks(packs: any[], apiBase: string): Promise<{ packTilesets: any[]; packItems: any[] }> {
  const packTilesets: any[] = [];
  const packItems: any[] = [];
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

function buildAutotileItems(packs: any[], apiBase: string) {
  const autotileItems: Array<any> = [];
  let nextWallTypeId = 1;
  const sortedPacksForAutotiles = [...(packs || [])].sort((a: any, b: any) =>
    (a.uuid || '').localeCompare(b.uuid || ''),
  );
  for (const p of sortedPacksForAutotiles) {
    const sortedAutotiles = [...(p.autotiles || [])].sort((a: any, b: any) => (a.id || '').localeCompare(b.id || ''));
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

function applyPackTilesetsToEditor(setEditor: any, packTilesets: any[]) {
  setEditor((s: any) => {
    const existing = s.tilesets || [];
    const merged = [...existing];
    for (const ts of packTilesets) {
      const idx = merged.findIndex((m: any) => m.key === ts.key);
      if (idx >= 0) merged[idx] = ts;
      else merged.push(ts);
    }
    (window as any).pendingTilesets = merged;
    return { ...s, tilesets: merged };
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

function applyLocalPackItems(setEditor: any) {
  try {
    const raw = localStorage.getItem('meetropolis.packItems');
    if (!raw) return;
    const local = JSON.parse(raw);
    if (!Array.isArray(local)) return;
    setEditor((s: any) => {
      const current = s.packItems || [];
      const seen = new Set(current.map((p: any) => p.key));
      const next = [...current];
      for (const li of local) {
        if (!seen.has(li.key)) {
          next.push(li);
          seen.add(li.key);
        }
      }
      return { ...s, packItems: next };
    });
  } catch (e) {
    logger.debug('[WorldApp] Operation failed', e);
  }
}

async function loadAssetPacks(apiBase: string, setEditor: any) {
  try {
    const res = await fetch(`${apiBase}/asset-packs`, { credentials: 'include' });
    if (res.ok) {
      const packs = await res.json();
      loadFromPacks(packs || [], (url: string) => resolvePackUrl(url, apiBase));
      const { packTilesets, packItems } = await processPacks(packs || [], apiBase);
      if (packTilesets.length > 0) applyPackTilesetsToEditor(setEditor, packTilesets);
      setEditor((s: any) => ({ ...s, packItems }));
      const autotileItems = buildAutotileItems(packs || [], apiBase);
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

function loadDefaultTilesets(setEditor: any) {
  const defaultTs = [
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
  (window as any).pendingTilesets = defaultTs;
  setEditor((s: any) => ({ ...s, tilesets: defaultTs }));
  // registerTileset ist sync (returns void), kein await nötig — aber wir wrappen
  // in try/catch, weil die interne Pipeline Promise-spawning Side-Effects hat.
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

function applyEditorState(data: any, setEditor: any) {
  if (data?.zones)
    try {
      const zones = Array.isArray(data.zones)
        ? data.zones.map((z: any) => {
            const anyZ = z || {};
            const pts = Array.isArray(anyZ.points)
              ? anyZ.points
              : Array.isArray(anyZ.polygon)
                ? anyZ.polygon
                : anyZ.polygon && Array.isArray(anyZ.polygon.points)
                  ? anyZ.polygon.points
                  : [];
            return {
              name: anyZ.name,
              points: pts,
              type: anyZ.type,
              portalTarget: anyZ.portalTarget,
              portalSpawnX: anyZ.portalSpawnX,
              portalSpawnY: anyZ.portalSpawnY,
            };
          })
        : [];
      setEditor((s: any) => ({ ...s, zones }));
      try {
        gameBridge.setZoneOverlay(zones);
      } catch (e) {
        logger.debug('[WorldApp] Operation failed', e);
      }
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  if (typeof data?.backgroundColor === 'string') {
    setEditor((s: any) => ({ ...s, backgroundColor: data.backgroundColor }));
    try {
      gameBridge.setBackgroundColor(data.backgroundColor);
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  if (Array.isArray(data?.editorGround) || Array.isArray(data?.editorWalls) || Array.isArray(data?.collision)) {
    try {
      gameBridge.reloadEditorLayers();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
  if (data?.spawn && typeof data.spawn.x === 'number') {
    setEditor((s: any) => ({ ...s, spawn: { x: data.spawn.x, y: data.spawn.y } }));
    try {
      gameBridge.setSpawnMarker({ x: data.spawn.x, y: data.spawn.y });
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
  }
}

async function loadMapObjects(apiBase: string, mapId: string, setEditor: any) {
  try {
    const objRes = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/objects`, { credentials: 'include' });
    if (!objRes.ok) return;
    const objects = await objRes.json();
    if (!Array.isArray(objects)) return;
    EditorService.dispatch({ type: 'LOAD_MAP_OBJECTS', objects });
    const TILE_SIZE = 16;
    const derivedAssets = objects.map((obj: any) => ({
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
    setEditor((s: any) => ({ ...s, assets: derivedAssets }));
  } catch (e) {
    logger.debug('[WorldApp] Failed to load map objects', e);
  }
}

async function loadMapEditorData(apiBase: string, setEditor: any) {
  try {
    const mapId = useMapStore.getState().currentMapId;
    if (!mapId) return;
    const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
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

    void loadAssetPacks(apiBase, (updater: any) => setEditorRef.current(updater));
    try {
      gameBridge.fetchAndApplyServerLayers();
    } catch {
      /* */
    }
    loadDefaultTilesets((updater: any) => setEditorRef.current(updater));
    try {
      gameBridge.reloadEditorLayers();
    } catch (e) {
      logger.debug('[WorldApp] Operation failed', e);
    }
    void loadMapEditorData(apiBase, (updater: any) => setEditorRef.current(updater));
  }, [me, apiBase]);
}
