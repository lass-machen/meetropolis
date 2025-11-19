import Phaser from 'phaser';

export function saveEditorLayers(scene: Phaser.Scene & any): void {
  // v2+ only uses server API directly via painting.ts; this is legacy/v1 fallback
  if (scene.v2) return;

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
       // Legacy PUT logic for v1 maps - DEPRECATED, do nothing
    }
  } catch {}
}

export function saveEditorLayersHard(scene: Phaser.Scene & any): void {
   saveEditorLayers(scene);
}

export function loadEditorLayers(scene: Phaser.Scene & any): void {
  // v2+ loads from chunks/serverSync; do not load from localStorage
  if (scene.v2) return;
  
  // Legacy loading logic omitted to enforce server authority
  // The only valid load is from serverSync.ts (fetchAndApplyServerLayers)
}

export function reloadEditorLayers(scene: Phaser.Scene & any): void {
  try { loadEditorLayers(scene); } catch {}
  try { scene.updateCollisionOverlay(); } catch {}
}


