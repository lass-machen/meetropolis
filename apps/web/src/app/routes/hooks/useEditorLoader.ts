import { useEffect, useRef } from 'react';
import { logger } from '../../../lib/logger';
import { splitTilesetImage } from '../../../lib/tilesetUtils';
import { gameBridge } from '../../../game/bridge';
import { useMapStore } from '../../../state/mapStore';
import { loadFromPacks } from '../../../lib/directionalImageRegistry';
import { EditorService } from '../../../services/EditorService';

interface UseEditorLoaderParams {
  me: { id: string; email: string; name?: string } | null;
  apiBase: string;
  setEditor: (editor: any) => void;
}

export function useEditorLoader({ me, apiBase, setEditor }: UseEditorLoaderParams) {
  const hasLoadedRef = useRef(false);
  const setEditorRef = useRef(setEditor);
  setEditorRef.current = setEditor;

  useEffect(() => {
    if (!me) return;
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;

    try {
      (async () => {
        const res = await fetch(`${apiBase}/asset-packs`, { credentials: 'include' });
        if (res.ok) {
          const packs = await res.json();
          loadFromPacks(packs || []);
          const packTilesets: any[] = [];
          const packItems: any[] = [];
          for (const p of packs || []) {
            const uuid = p.uuid;
            for (const t of (p.terrain || [])) {
              packTilesets.push({ key: `${uuid}:${t.key}`, dataUrl: t.dataURL, tileWidth: t.tileWidth, tileHeight: t.tileHeight, margin: t.margin ?? 0, spacing: t.spacing ?? 0, category: 'terrain' });
            }
            for (const t of (p.terrain || [])) {
              if (t.dataURL) {
                try {
                  const tiles = await splitTilesetImage(t.dataURL, { tileWidth: t.tileWidth, tileHeight: t.tileHeight, margin: t.margin, spacing: t.spacing });
                  for (const tile of tiles) {
                    packItems.push({ packUuid: uuid, itemId: `${t.id}:${tile.row}:${tile.col}`, key: `${t.key}-${tile.row}-${tile.col}`, category: 'terrain', dataUrl: tile.dataUrl, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
                  }
                } catch (e) {
                  logger.warn('[WorldApp] Failed to split tileset:', t.key, e);
                  packItems.push({ packUuid: uuid, itemId: t.id, key: t.key, category: 'terrain', dataUrl: t.dataURL, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
                }
              } else {
                packItems.push({ packUuid: uuid, itemId: t.id, key: t.key, category: 'terrain', dataUrl: t.dataURL, width: t.tileWidth, height: t.tileHeight, collide: !!t.collide });
              }
            }
            for (const s of (p.structures || [])) {
              packItems.push({ packUuid: uuid, itemId: s.id, key: s.key, category: 'structures', dataUrl: s.dataURL, width: s.width, height: s.height, collide: !!s.collide, scaleFactor: s.scaleFactor || 1 });
            }
            for (const o of (p.objects || [])) {
              packItems.push({
                packUuid: uuid, itemId: o.id, key: o.key, category: 'objects',
                dataUrl: o.dataURL, width: o.width, height: o.height, collide: !!o.collide,
                rotationAllowed: !!o.rotationAllowed,
                hasDirectionalImages: Array.isArray(o.directionalImages) && o.directionalImages.length > 0,
                scaleFactor: o.scaleFactor || 1,
              });
            }
          }
          if (packTilesets.length > 0) {
            setEditorRef.current((s: any) => {
              const existing = s.tilesets || [];
              const merged = [...existing];
              for (const ts of packTilesets) {
                const idx = merged.findIndex((m: any) => m.key === ts.key);
                if (idx >= 0) merged[idx] = ts; else merged.push(ts);
              }
              (window as any).pendingTilesets = merged;
              return { ...s, tilesets: merged };
            });
            try {
              for (const ts of packTilesets) {
                gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin ?? 0, spacing: ts.spacing ?? 0 });
              }
            } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
          setEditorRef.current((s: any) => ({ ...s, packItems }));
        }
        try {
          const raw = localStorage.getItem('meetropolis.packItems');
          if (raw) {
            const local = JSON.parse(raw);
            if (Array.isArray(local)) {
              setEditorRef.current((s: any) => {
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
            }
          }
        } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
      })();
    } catch (e) { logger.debug('[WorldApp] Operation failed', e); }

    try { gameBridge.fetchAndApplyServerLayers(); } catch (e) { }

    const defaultTs = [
      { key: 'office_tiles', dataUrl: '/assets/tilesets/office_tiles.png', tileWidth: 16, tileHeight: 16, category: 'terrain' },
      { key: 'furniture_tiles', dataUrl: '/assets/tilesets/furniture_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
      { key: 'decor_tiles', dataUrl: '/assets/tilesets/decor_tiles.png', tileWidth: 16, tileHeight: 16, category: 'objects' },
    ];
    (window as any).pendingTilesets = defaultTs;
    setEditorRef.current((s: any) => ({ ...s, tilesets: defaultTs }));

    (async () => {
      try {
        for (const ts of defaultTs) {
          await gameBridge.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: 0, spacing: 0 });
        }
      } catch (e) { logger.warn('[EDITOR] Tileset registration failed (non-critical):', e); }
    })();

    try { gameBridge.reloadEditorLayers(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }

    (async () => {
      try {
        const mapId = useMapStore.getState().currentMapId;
        if (!mapId) return;
        const res = await fetch(`${apiBase}/maps/${encodeURIComponent(mapId)}/editor-state`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data?.zones) try {
            const zones = Array.isArray(data.zones) ? data.zones.map((z: any) => {
              const anyZ = z || {};
              const pts = Array.isArray(anyZ.points) ? anyZ.points : Array.isArray(anyZ.polygon) ? anyZ.polygon : (anyZ.polygon && Array.isArray(anyZ.polygon.points)) ? anyZ.polygon.points : [];
              return { name: anyZ.name, points: pts, type: anyZ.type, portalTarget: anyZ.portalTarget, portalSpawnX: anyZ.portalSpawnX, portalSpawnY: anyZ.portalSpawnY };
            }) : [];
            setEditorRef.current((s: any) => ({ ...s, zones }));
            try { gameBridge.setZoneOverlay(zones); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          if (typeof data?.backgroundColor === 'string') {
            setEditorRef.current((s: any) => ({ ...s, backgroundColor: data.backgroundColor }));
            try { gameBridge.setBackgroundColor(data.backgroundColor); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
          if (Array.isArray(data?.editorGround) || Array.isArray(data?.editorWalls) || Array.isArray(data?.collision)) {
            try { gameBridge.reloadEditorLayers(); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
          if (data?.spawn && typeof data.spawn.x === 'number') {
            setEditorRef.current((s: any) => ({ ...s, spawn: { x: data.spawn.x, y: data.spawn.y } }));
            try { gameBridge.setSpawnMarker({ x: data.spawn.x, y: data.spawn.y }); } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
          }
        }

        // Load map objects via REST API
        try {
          const objRes = await fetch(
            `${apiBase}/maps/${encodeURIComponent(mapId)}/objects`,
            { credentials: 'include' },
          );
          if (objRes.ok) {
            const objects = await objRes.json();
            if (Array.isArray(objects)) {
              EditorService.dispatch({ type: 'LOAD_MAP_OBJECTS', objects });

              // mapObjects → visual assets for EditorRenderer
              const TILE_SIZE = 16;
              const derivedAssets = objects.map((obj: any) => ({
                id: String(obj.id),
                key: `${obj.assetPackUuid}:${obj.itemId}`,
                dataUrl: obj.dataUrl || '',
                x: obj.tileX * TILE_SIZE + TILE_SIZE / 2,
                y: obj.tileY * TILE_SIZE + TILE_SIZE / 2,
                packUuid: obj.assetPackUuid,
                itemId: obj.itemId,
                category: obj.category,
                collide: obj.collide,
                width: obj.width,
                height: obj.height,
                rotation: obj.rotation ?? 0,
                scaleFactor: obj.scaleFactor ?? 1,
              }));
              setEditorRef.current((s: any) => ({ ...s, assets: derivedAssets }));
            }
          }
        } catch (e) {
          logger.debug('[WorldApp] Failed to load map objects', e);
        }
      } catch (e) { logger.debug('[WorldApp] Operation failed', e); }
    })();
  }, [me, apiBase]);
}
