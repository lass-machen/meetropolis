import { logger } from './logger';
import { getApiBaseFromWindow } from './runtimeConfig';

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
  mapMeta: {
    width: number | null;
    height: number | null;
    tileWidth: number | null;
    tileHeight: number | null;
    chunkSize: number;
    version: number | null;
  };
  tilesetRegistry: V2Tileset[];
  layerIndex: Record<string, { keys: string[]; chunkSize: number }>;
};

export type V2ChunkPayload = { version: number; encoding: string; data: string };

export function baseUrl(): string {
  return getApiBaseFromWindow();
}

export async function fetchStateV2(mapId: string): Promise<V2State | null> {
  const res = await fetch(`${baseUrl()}/maps/${encodeURIComponent(mapId)}/state-v2`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('failed to fetch state-v2');
  return (await res.json()) as V2State;
}

export async function fetchChunks(
  mapId: string,
  layer: string,
  keys: string[],
): Promise<Record<string, V2ChunkPayload>> {
  if (keys.length === 0) return {};
  const qs = keys.join(',');
  // Prevent aggressive webview/browser caching with timestamp
  const ts = Date.now();
  const res = await fetch(
    `${baseUrl()}/maps/${encodeURIComponent(mapId)}/chunks?layer=${encodeURIComponent(layer)}&keys=${encodeURIComponent(qs)}&t=${ts}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error('failed to fetch chunks');
  const json = (await res.json()) as unknown as { chunks?: Record<string, V2ChunkPayload> };
  return json?.chunks ?? {};
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
  // Offset by 1 (0 is reserved for empty)
  const raw = id - 1;
  const slot = (raw >>> 16) & 0xffff;
  const tileIndex = raw & 0xffff;
  return { slot, tileIndex };
}

export function makeTileRefId(slot: number, tileIndex: number): number {
  return (((slot & 0xffff) << 16) | (tileIndex & 0xffff)) + 1;
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
    const onComplete = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      scene.load.off('complete', onComplete);
    };

    scene.load.once('complete', onComplete);

    for (const { key, url } of toLoad) {
      const resolvedUrl = url.startsWith('/') ? `${baseUrl()}${url}` : url;
      scene.load.image(key, resolvedUrl);
    }
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
    const src = tex?.getSourceImage?.() as { width?: number; height?: number } | undefined;
    let cols = 1,
      rows = 1;
    const tw = ts.tileWidth;
    const th = ts.tileHeight;
    const spacing = ts.spacing ?? 0;
    const margin = ts.margin ?? 0;
    if (src && typeof src.width === 'number' && typeof src.height === 'number' && src.width > 0 && src.height > 0) {
      const w = src.width;
      const h = src.height;
      cols = Math.max(1, Math.floor((w - margin * 2 + spacing) / (tw + spacing)));
      rows = Math.max(1, Math.floor((h - margin * 2 + spacing) / (th + spacing)));
    } else {
      // Fallback: reserve a safe chunk of IDs if texture is missing
      // Assuming max 1024x1024 texture as safe upper bound or 64x64 tiles
      logger.warn(`[MapV2] Texture missing for tileset ${ts.key}, using fallback dimensions`);
      cols = 64;
      rows = 64;
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
