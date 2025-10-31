type LayersDump = { editorGround: number[] | null; editorWalls?: number[] | null; collision: number[] | null; w?: number; h?: number };

export function loadJSON<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    return parsed ?? def;
  } catch {
    return def;
  }
}

export function saveJSON<T>(key: string, value: T): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export const keys = {
  zones: 'meetropolis.zones',
  assets: 'meetropolis.assets',
  tilesets: 'meetropolis.tilesets',
  layers: 'meetropolis.editorLayers',
};

export function loadLayers(): LayersDump | null {
  const data = loadJSON<LayersDump | null>(keys.layers, null);
  return data ?? null;
}

export function saveLayers(dump: LayersDump): void {
  saveJSON(keys.layers, dump);
}

export function buildServerPayloadFromLocal(): { editorGround: number[] | null; editorWalls?: number[] | null; collision: number[] | null } {
  const layers = loadLayers();
  return {
    editorGround: layers?.editorGround ?? null,
    editorWalls: layers?.editorWalls ?? null,
    collision: layers?.collision ?? null,
  };
}


export function buildEditorSavePayload(zones: any[] | null | undefined): any {
  const layers = loadLayers();
  const tilesets = loadJSON<any[]>(keys.tilesets, []);
  const assets = loadJSON<any[]>(keys.assets, []);
  let backgroundColor = '#202020';
  try { backgroundColor = (localStorage.getItem('meetropolis.backgroundColor') || '#202020'); } catch {}
  const payload: any = {
    editorGround: layers?.editorGround ?? null,
    editorWalls: layers?.editorWalls ?? null,
    collision: layers?.collision ?? null,
    tilesets,
    assets,
    backgroundColor,
    replaceZones: true,
  };
  if (Array.isArray(zones)) payload.zones = zones;
  return payload;
}


