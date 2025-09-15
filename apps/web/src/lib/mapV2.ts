export type V2Tileset = {
  id: string;
  slot: number;
  key: string;
  imageUrl: string;
  tileWidth: number;
  tileHeight: number;
  margin?: number | null;
  spacing?: number | null;
  hash?: string | null;
};

export type V2State = {
  mapMeta: { width: number | null; height: number | null; tileWidth: number | null; tileHeight: number | null; chunkSize: number; version: number | null };
  tilesetRegistry: V2Tileset[];
  layerIndex: Record<string, { keys: string[]; chunkSize: number }>;
};

export type V2ChunkPayload = { version: number; encoding: string; data: string };

export function baseUrl(): string {
  let base: string | undefined = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE;
  if (!base && typeof window !== 'undefined') {
    base = `${window.location.protocol}//${window.location.hostname}:2567`;
  }
  return base || 'http://localhost:2567';
}

export async function fetchStateV2(mapName: string): Promise<V2State | null> {
  const res = await fetch(`${baseUrl()}/maps/${encodeURIComponent(mapName)}/state-v2`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to fetch state-v2');
  return (await res.json()) as V2State;
}

export async function fetchChunks(mapName: string, layer: string, keys: string[]): Promise<Record<string, V2ChunkPayload>> {
  if (keys.length === 0) return {};
  const qs = keys.join(',');
  const res = await fetch(`${baseUrl()}/maps/${encodeURIComponent(mapName)}/chunks?layer=${encodeURIComponent(layer)}&keys=${encodeURIComponent(qs)}`, { credentials: 'include' });
  if (!res.ok) throw new Error('failed to fetch chunks');
  const json = await res.json();
  return (json?.chunks ?? {}) as Record<string, V2ChunkPayload>;
}

export function decodeRLE(base64: string, total: number): number[] {
  try {
    const json = atob(base64);
    const pairs = JSON.parse(json) as Array<[number, number]>;
    const out = new Array<number>(total);
    let i = 0;
    for (const [v, cnt] of pairs) {
      for (let c = 0; c < cnt && i < total; c++) out[i++] = v;
      if (i >= total) break;
    }
    while (i < total) out[i++] = 0;
    return out;
  } catch {
    return new Array<number>(total).fill(0);
  }
}

export function splitTileRefId(id: number): { slot: number; tileIndex: number } {
  const slot = (id >>> 16) & 0xffff;
  const tileIndex = id & 0xffff;
  return { slot, tileIndex };
}

export async function preloadTilesetImages(scene: Phaser.Scene, tilesets: V2Tileset[]): Promise<void> {
  const toLoad: Array<{ key: string; url: string }> = [];
  for (const ts of tilesets) {
    const key = ts.key;
    if (!scene.textures.exists(key)) {
      toLoad.push({ key, url: ts.imageUrl });
    }
  }
  if (toLoad.length === 0) return;
  await new Promise<void>((resolve) => {
    scene.load.once('complete', () => resolve());
    for (const { key, url } of toLoad) scene.load.image(key, url);
    scene.load.start();
  });
}

export function computeFirstGids(tilesets: V2Tileset[], scene: Phaser.Scene): number[] {
  // Compute gid ranges by loading texture dimensions
  const first: number[] = [];
  let acc = 1; // Tiled gids start at 1
  const sorted = [...tilesets].sort((a, b) => a.slot - b.slot);
  for (const ts of sorted) {
    const tex = scene.textures.get(ts.key);
    const src: any = tex?.getSourceImage?.();
    let cols = 1, rows = 1;
    const tw = ts.tileWidth;
    const th = ts.tileHeight;
    const spacing = (ts.spacing ?? 0) as number;
    const margin = (ts.margin ?? 0) as number;
    if (src && typeof (src as any).width === 'number' && typeof (src as any).height === 'number') {
      const w = (src as any).width;
      const h = (src as any).height;
      cols = Math.max(1, Math.floor((w - margin * 2 + spacing) / (tw + spacing)));
      rows = Math.max(1, Math.floor((h - margin * 2 + spacing) / (th + spacing)));
    }
    first[ts.slot] = acc;
    acc += cols * rows;
  }
  return first;
}

export function tileRefIdToGid(tileRefId: number, firstGids: number[]): number {
  if (!tileRefId) return -1;
  const { slot, tileIndex } = splitTileRefId(tileRefId);
  const fg = firstGids[slot] ?? 1;
  return fg + tileIndex;
}


