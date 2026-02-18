import Phaser from 'phaser';
import { gameBridge } from '../bridge';
import { logger } from '../../lib/logger';

export async function fetchAndApplyServerLayers(scene: Phaser.Scene & any): Promise<void> {
  try {
    const anyWin = window as any;
    const base = anyWin.desktop?.apiBase || anyWin.__MEETROPOLIS_API_BASE__ || anyWin.VITE_API_BASE || (import.meta as any).env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
    const res = await fetch(`${base}/maps/${encodeURIComponent(scene.currentMapName)}/editor-state?t=${Date.now()}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    let requiredTsKeys: string[] = [];
    try {
      const arr = Array.isArray((data as any)?.tilesets) ? (data as any).tilesets : [];
      // Hydrate bridge cache so subsequent uploads don't overwrite existing tilesets
      try { gameBridge.hydrateTilesetsCache(arr); } catch (e) { logger.error('Failed to hydrate tileset cache', e); }

      for (const ts of arr) {
        if (ts && ts.key && ts.dataUrl && ts.tileWidth && ts.tileHeight) {
          scene.registerTileset({ key: ts.key, dataUrl: ts.dataUrl, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: (ts as any).margin ?? 0, spacing: (ts as any).spacing ?? 0 });
          if (typeof ts.key === 'string' && typeof ts.dataUrl === 'string' && ts.key.startsWith('terrain:')) {
            scene.terrainTilesetSources.set(ts.key, ts.dataUrl);
          }
          try { requiredTsKeys.push(ts.key); } catch {}
        }
      }
    } catch {}
    try {
      const bg = typeof (data as any)?.backgroundColor === 'string' ? (data as any).backgroundColor : null;
      if (bg) {
        scene.cameras.main.setBackgroundColor(bg);
      }
      const sp = (data as any)?.spawn;
      if (sp && typeof sp.x === 'number' && typeof sp.y === 'number') {
        try { scene.setSpawnMarker(sp); } catch {}
      }
    } catch {}
    if (data?.collision) {
      const collisionTiles = data.collision.filter((t: number) => t !== -1).length;
      logger.debug('Load', `Received from server: ${collisionTiles} collision tiles`);
    }
    try {
      const zones = Array.isArray((data as any)?.zones) ? (data as any).zones.map((z: any) => {
        const anyZ = z || {};
        const pts = Array.isArray(anyZ.points) ? anyZ.points : Array.isArray(anyZ.polygon) ? anyZ.polygon : (anyZ.polygon && Array.isArray(anyZ.polygon.points)) ? anyZ.polygon.points : [];
        return {
          name: anyZ.name,
          points: pts,
          capacity: anyZ.capacity ?? undefined,
          type: anyZ.type ?? undefined,
          portalTarget: anyZ.portalTarget ?? undefined,
          portalSpawnX: anyZ.portalSpawnX ?? undefined,
          portalSpawnY: anyZ.portalSpawnY ?? undefined,
        };
      }) : [];
      if (zones.length > 0) {
        try { scene.setZoneOverlay(zones); } catch {}
        // Dispatch event so ZoneManager gets updated with server-loaded zones (including portal metadata)
        try { window.dispatchEvent(new CustomEvent('server_zones_loaded', { detail: { zones } })); } catch {}
      }
    } catch {}
    try { await scene.waitForTilesetsReady(requiredTsKeys, 1500); } catch {}
    if (!scene.mapRef) return;
    const storedW = scene.mapRef.width;
    const width = scene.mapRef.width;
    const height = scene.mapRef.height;
    scene.ensureEditorLayers();
    const applyArr = (arr: number[] | null | undefined, layer?: Phaser.Tilemaps.TilemapLayer, layerName?: 'editorGround' | 'editorWalls' | 'collision') => {
      if (!arr || !layer) return;
      try {
        const allTilesets = Array.from(scene.dynamicTilesets.values());
        allTilesets.push(...scene.mapRef!.tilesets.filter((ts: any) => !scene.dynamicTilesets.has(ts.name)));
        (layer as any).setTilesets?.(allTilesets);
        (layer as any).tileset = allTilesets;
      } catch {}
      if (layerName === 'collision') {
        logger.debug('Load', `Applying collision: ${arr.length} tiles to ${width}x${height} layer`);
        const allTilesets = Array.from(scene.dynamicTilesets.values());
        allTilesets.push(...scene.mapRef!.tilesets.filter((ts: any) => !scene.dynamicTilesets.has(ts.name)));
        (layer as any).setTilesets(allTilesets);
        const layerData = (layer as any).layer;
        if (layerData?.data) {
          logger.debug('Load', `Collision layer actual size: ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
          const expectedRows = scene.mapRef!.height;
          const actualRows = layerData.data.length;
          if (actualRows < expectedRows) {
            logger.debug('Load', `Fixing collision layer dimensions again: ${actualRows} rows -> ${expectedRows} rows`);
            while (layerData.data.length < expectedRows) {
              const newRow = new Array(scene.mapRef!.width);
              for (let x = 0; x < scene.mapRef!.width; x++) {
                newRow[x] = new Phaser.Tilemaps.Tile(layerData, -1, x, layerData.data.length, scene.mapRef!.tileWidth, scene.mapRef!.tileHeight, scene.mapRef!.tileWidth, scene.mapRef!.tileHeight);
              }
              layerData.data.push(newRow);
            }
            layerData.height = expectedRows;
            logger.debug('Load', `Fixed collision layer to ${layerData.data.length}x${layerData.data[0]?.length || 0}`);
          }
        }
      }
      let appliedCount = 0;
      let validTileCount = 0;
      for (const idx of arr) { if (typeof idx === 'number' && idx >= 0) validTileCount++; }
      if (layerName === 'collision') { logger.debug('Load', `Found ${validTileCount} valid collision tiles`); }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = arr[y * storedW + x];
          if (typeof idx === 'number' && idx >= 0) {
            try { layer.putTileAt(idx, x, y); appliedCount++; } catch (e) {
              if (layerName === 'collision' && appliedCount === 0) {
                logger.error('Load', `First collision tile failed at ${x},${y} with index ${idx}`, e);
              }
            }
          }
        }
      }
      if (layerName === 'collision') { logger.debug('Load', `Applied ${appliedCount} collision tiles`); }
    };
    applyArr((data as any)?.editorGround, scene.editorGround, 'editorGround');
    applyArr((data as any)?.editorWalls, scene.wallsLayer, 'editorWalls');
    applyArr((data as any)?.collision, scene.collisionLayer, 'collision');
    if ((data as any)?.collision) {
      scene.rebuildStaticColliders();
      scene.ensureCollisionCollider();
    }
    if (scene.collisionVisible) scene.updateCollisionOverlay();
    try {
      if (Array.isArray((data as any)?.assets)) {
        const assets = (data as any).assets;
        scene.setEditorAssets(assets);
      }
    } catch {}
  } catch (e) {
    logger.error('Load', 'Failed to fetch/apply server layers', e);
  }
}

