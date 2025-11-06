import Phaser from 'phaser';

export function saveEditorLayers(scene: Phaser.Scene & any): void {
  if (!scene.mapRef) return;
  const width = scene.mapRef.width;
  const height = scene.mapRef.height;
  const dumpLayer = (layer?: Phaser.Tilemaps.TilemapLayer) => {
    if (!layer) return null;
    const arr: number[] = new Array(width * height).fill(-1);
    let tileCount = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        try {
          const tile = layer.getTileAt(x, y);
          const tileIndex = tile ? tile.index : -1;
          arr[y * width + x] = tileIndex;
          if (tileIndex !== -1) tileCount++;
        } catch {
          arr[y * width + x] = -1;
        }
      }
    }
    return tileCount > 0 ? arr : null;
  };
  try {
    const data = {
      editorGround: dumpLayer(scene.editorGround),
      editorWalls: dumpLayer(scene.wallsLayer),
      collision: dumpLayer(scene.collisionLayer),
      w: width,
      h: height,
    };
    localStorage.setItem('meetropolis.editorLayers', JSON.stringify(data));
    let base = (window as any).VITE_API_BASE || (import.meta as any).env.VITE_API_BASE as any;
    if (!base && typeof window !== 'undefined') base = `${window.location.protocol}//${window.location.hostname}:2567`;
    if (!base) base = 'http://localhost:2567';
    const terrainTilesets: any[] = [];
    try {
      scene.dynamicTilesets.forEach((ts: any, name: string) => {
        void ts;
        if (name && name.startsWith('terrain:')) {
          const src = scene.terrainTilesetSources.get(name) || '';
          terrainTilesets.push({ key: name, dataUrl: src, tileWidth: scene.mapRef!.tileWidth, tileHeight: scene.mapRef!.tileHeight, category: 'terrain' });
        }
      });
    } catch {}
    const serverPayload: any = { editorGround: data.editorGround, editorWalls: data.editorWalls, collision: data.collision, tilesets: terrainTilesets };
    const jsonStr = JSON.stringify(serverPayload);
    if (jsonStr.length < 100000) {
      fetch(`${base}/maps/${encodeURIComponent(scene.currentMapName)}/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: jsonStr }).catch(()=>{});
    }
  } catch {}
}

export function saveEditorLayersHard(scene: Phaser.Scene & any): void {
  if (!scene.mapRef) return;
  const width = scene.mapRef.width;
  const height = scene.mapRef.height;
  const dumpLayer = (layer?: Phaser.Tilemaps.TilemapLayer): number[] | null => {
    if (!layer) return null;
    const arr: number[] = new Array(width * height).fill(-1);
    let hasAny = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const t = layer.getTileAt(x, y);
        const idx = t ? t.index : -1;
        arr[y * width + x] = idx;
        if (idx !== -1) hasAny = true;
      }
    }
    return hasAny ? arr : null;
  };
  const data = { editorGround: dumpLayer(scene.editorGround), editorWalls: dumpLayer(scene.wallsLayer), collision: dumpLayer(scene.collisionLayer), w: width, h: height };
  try { localStorage.setItem('meetropolis.editorLayers', JSON.stringify(data)); } catch {}
  try {
    let base = (window as any).VITE_API_BASE || (import.meta as any).env.VITE_API_BASE as any;
    if (!base && typeof window !== 'undefined') base = `${window.location.protocol}//${window.location.hostname}:2567`;
    if (!base) base = 'http://localhost:2567';
    const serverPayload: any = { editorGround: data.editorGround, editorWalls: data.editorWalls, collision: data.collision, tilesets: [] };
    try {
      const terrainTilesets: any[] = [];
      scene.dynamicTilesets.forEach((_: any, name: string) => {
        if (name && name.startsWith('terrain:')) {
          const src = scene.terrainTilesetSources.get(name) || '';
          terrainTilesets.push({ key: name, dataUrl: src, tileWidth: scene.mapRef!.tileWidth, tileHeight: scene.mapRef!.tileHeight, category: 'terrain' });
        }
      });
      serverPayload.tilesets = terrainTilesets;
    } catch {}
    fetch(`${base}/maps/${encodeURIComponent(scene.currentMapName)}/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(serverPayload) }).catch(()=>{});
  } catch {}
}

export function loadEditorLayers(scene: Phaser.Scene & any): void {
  if (!scene.mapRef) return;
  try {
    const raw = localStorage.getItem('meetropolis.editorLayers');
    if (!raw) return;
    const data = JSON.parse(raw);
    const storedW = (typeof data?.w === 'number' && data.w > 0) ? data.w : scene.mapRef.width;
    const storedH = (typeof data?.h === 'number' && data.h > 0) ? data.h : scene.mapRef.height;
    const width = Math.min(scene.mapRef.width, storedW);
    const height = Math.min(scene.mapRef.height, storedH);
    scene.ensureEditorLayers();
    const applyArr = (arr: number[] | null | undefined, layer?: Phaser.Tilemaps.TilemapLayer, layerName?: 'editorGround' | 'editorWalls' | 'collision') => {
      if (!arr || !layer) return;
      try {
        const allTilesets = Array.from(scene.dynamicTilesets.values());
        allTilesets.push(...scene.mapRef!.tilesets.filter((ts: any) => !scene.dynamicTilesets.has(ts.name)));
        (layer as any).setTilesets?.(allTilesets);
        (layer as any).tileset = allTilesets;
      } catch {}
      if (layerName === 'collision' && scene.mapRef) {
        const layerData = (layer as any).layer;
        if (layerData?.data) {
          const expectedRows = scene.mapRef!.height;
          while (layerData.data.length < expectedRows) {
            const newRow = new Array(scene.mapRef!.width);
            for (let x = 0; x < scene.mapRef!.width; x++) {
              newRow[x] = new Phaser.Tilemaps.Tile(
                layerData,
                -1,
                x,
                layerData.data.length,
                scene.mapRef!.tileWidth,
                scene.mapRef!.tileHeight,
                scene.mapRef!.tileWidth,
                scene.mapRef!.tileHeight
              );
            }
            layerData.data.push(newRow);
          }
          layerData.height = expectedRows;
        }
      }
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const stride = storedW!;
          const idx = arr[y * stride + x];
          if (typeof idx === 'number' && idx >= 0) {
            try { layer.putTileAt(idx, x, y); } catch {}
          }
        }
      }
    };
    applyArr(data?.editorGround, scene.editorGround, 'editorGround');
    applyArr(data?.editorWalls, scene.wallsLayer, 'editorWalls');
    applyArr(data?.collision, scene.collisionLayer, 'collision');
    if (data?.collision) {
      scene.rebuildStaticColliders();
      scene.ensureCollisionCollider();
    }
  } catch {}
}

export function reloadEditorLayers(scene: Phaser.Scene & any): void {
  try { loadEditorLayers(scene); } catch {}
  try { scene.updateCollisionOverlay(); } catch {}
}


