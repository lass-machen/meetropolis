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


