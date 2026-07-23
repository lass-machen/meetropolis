import { fetchChunks, decodeRLE, tileRefIdToGid, type V2ChunkPayload } from '../../lib/mapV2';
import { computeBackoffDelayMs } from '../../lib/backoff';
import { logger } from '../../lib/logger';
import type { MainSceneLike } from '../types/scene';

export type ChunkLayerName = 'ground' | 'walls' | 'collision' | 'walls_auto';

const CHUNK_RETRY_BASE_DELAY_MS = 1_000;
const CHUNK_RETRY_MAX_DELAY_MS = 30_000;
const MAX_CHUNK_FETCH_ATTEMPTS = 8;

type ChunkRetryState = { attempts: number; nextRetryAt: number };

// Retry bookkeeping is scoped per scene instance; the WeakMap avoids leaking
// state when a scene is destroyed.
const chunkRetryStates = new WeakMap<object, Map<string, ChunkRetryState>>();

function getChunkRetryMap(scene: MainSceneLike): Map<string, ChunkRetryState> {
  let map = chunkRetryStates.get(scene);
  if (!map) {
    map = new Map();
    chunkRetryStates.set(scene, map);
  }
  return map;
}

function retryKeyOf(scene: MainSceneLike, layerName: ChunkLayerName, chunkKey: string): string {
  return `${scene.currentMapId}:${layerName}:${chunkKey}`;
}

function registerChunkFetchFailure(
  scene: MainSceneLike,
  layerName: ChunkLayerName,
  keys: string[],
  error: unknown,
): void {
  const retryMap = getChunkRetryMap(scene);
  const now = Date.now();
  let exhausted = 0;
  let maxAttempts = 0;
  for (const k of keys) {
    const rk = retryKeyOf(scene, layerName, k);
    const attempts = (retryMap.get(rk)?.attempts ?? 0) + 1;
    maxAttempts = Math.max(maxAttempts, attempts);
    if (attempts >= MAX_CHUNK_FETCH_ATTEMPTS) {
      exhausted++;
      retryMap.set(rk, { attempts, nextRetryAt: Number.POSITIVE_INFINITY });
    } else {
      retryMap.set(rk, {
        attempts,
        nextRetryAt:
          now +
          computeBackoffDelayMs(attempts, {
            baseDelayMs: CHUNK_RETRY_BASE_DELAY_MS,
            maxDelayMs: CHUNK_RETRY_MAX_DELAY_MS,
          }),
      });
    }
  }
  if (exhausted > 0) {
    logger.error(
      `[Chunks] Giving up on ${exhausted} chunk(s) for layer ${layerName} after ${MAX_CHUNK_FETCH_ATTEMPTS} attempts`,
      error,
    );
  } else {
    logger.warn(
      `[Chunks] Failed to fetch ${keys.length} chunk(s) for layer ${layerName} (attempt ${maxAttempts})`,
      error,
    );
  }
}

export async function loadVisibleChunks(scene: MainSceneLike, layerName: ChunkLayerName): Promise<void> {
  if (!scene.v2 || !scene.mapRef) return;
  const cam = scene.cameras.main;
  const tileW = scene.mapRef.tileWidth;
  const tileH = scene.mapRef.tileHeight;
  const cs = scene.v2.chunkSize;
  const x0 = Math.max(0, Math.floor(cam.worldView.x / tileW));
  const y0 = Math.max(0, Math.floor(cam.worldView.y / tileH));
  const x1 = Math.min(scene.mapRef.width - 1, Math.floor((cam.worldView.x + cam.worldView.width) / tileW));
  const y1 = Math.min(scene.mapRef.height - 1, Math.floor((cam.worldView.y + cam.worldView.height) / tileH));
  const cx0 = Math.floor(x0 / cs);
  const cy0 = Math.floor(y0 / cs);
  const cx1 = Math.floor(x1 / cs);
  const cy1 = Math.floor(y1 / cs);
  const retryMap = getChunkRetryMap(scene);
  const now = Date.now();
  const keys: string[] = [];
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const k = `${cx}:${cy}`;
      if (scene.loadedChunks.has(`${layerName}:${k}`)) continue;
      const retryState = retryMap.get(retryKeyOf(scene, layerName, k));
      if (retryState && (retryState.attempts >= MAX_CHUNK_FETCH_ATTEMPTS || retryState.nextRetryAt > now)) continue;
      keys.push(k);
    }
  if (keys.length === 0) return;
  let chunks: Record<string, V2ChunkPayload>;
  try {
    chunks = await fetchChunks(scene.currentMapId, layerName, keys);
  } catch (e) {
    registerChunkFetchFailure(scene, layerName, keys, e);
    return;
  }
  for (const k of keys) {
    retryMap.delete(retryKeyOf(scene, layerName, k));
    // The server omits chunks without stored data; mark those as loaded so
    // the camera loop does not refetch the same empty chunks on every
    // viewport change.
    if (!(k in chunks)) scene.loadedChunks.add(`${layerName}:${k}`);
  }
  const updates = Object.entries(chunks).map(([key, val]) => ({
    key,
    version: val.version,
    encoding: val.encoding,
    data: val.data,
  }));
  if (layerName === 'collision' && updates.length > 0) {
    logger.debug(
      `[Chunks] Applying ${updates.length} collision updates for keys: ${updates.map((u) => u.key).join(', ')}`,
    );
  }
  applyChunkUpdates(scene, layerName, updates);
}

export function applyChunkUpdates(
  scene: MainSceneLike,
  layerName: ChunkLayerName,
  updates: Array<{ key: string; version: number; encoding: string; data: string }>,
): void {
  if (!scene.v2 || !scene.mapRef) return;

  // Handle walls_auto separately: populate AutotileGrid instead of the tilemap.
  if (layerName === 'walls_auto') {
    if (!scene.autotileGrid || !scene.autotileRenderer) return;
    const cs = scene.v2.chunkSize;
    const total = cs * cs;
    for (const u of updates) {
      const [xs, ys] = u.key.split(':');
      const cx = Number(xs),
        cy = Number(ys);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      const arr = decodeRLE(u.data, total);
      for (let i = 0; i < total; i++) {
        const vx = i % cs;
        const vy = Math.floor(i / cs);
        const gx = cx * cs + vx;
        const gy = cy * cs + vy;
        if (gx >= scene.mapRef.width || gy >= scene.mapRef.height) continue;
        const wallTypeId = arr[i];
        if (wallTypeId > 0) {
          scene.autotileGrid.set(gx, gy, wallTypeId);
        } else {
          scene.autotileGrid.remove(gx, gy);
        }
      }
      scene.loadedChunks.add(`${layerName}:${cx}:${cy}`);
    }
    scene.autotileRenderer.updateAllVisible();
    return;
  }

  const layer =
    layerName === 'collision' ? scene.collisionLayer : layerName === 'walls' ? scene.wallsLayer : scene.editorGround;
  if (!layer) {
    logger.warn(`[Chunks] Layer ${layerName} not found on scene`);
    return;
  }
  const cs = scene.v2.chunkSize;
  const total = cs * cs;
  for (const u of updates) {
    const [xs, ys] = u.key.split(':');
    const cx = Number(xs),
      cy = Number(ys);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
    const arr = decodeRLE(u.data, total);
    for (let i = 0; i < total; i++) {
      const vx = i % cs;
      const vy = Math.floor(i / cs);
      const gx = cx * cs + vx;
      const gy = cy * cs + vy;
      if (gx >= scene.mapRef.width || gy >= scene.mapRef.height) continue;
      if (layerName === 'collision') {
        const v = arr[i] !== 0;
        if (v) {
          try {
            const t = layer.putTileAt(1, gx, gy);
            if (t) t.setCollision(true, true, true, true);
          } catch (e) {
            logger.warn('[Chunks] putTileAt failed', e);
          }
        } else {
          try {
            layer.removeTileAt(gx, gy);
          } catch {}
        }
      } else {
        const gid = tileRefIdToGid(arr[i] | 0, scene.v2.firstGids);
        if (gid < 0) {
          try {
            layer.removeTileAt(gx, gy);
          } catch {}
        } else {
          try {
            layer.putTileAt(gid, gx, gy);
          } catch {}
        }
      }
    }
    scene.loadedChunks.add(`${layerName}:${cx}:${cy}`);
  }
  if (layerName === 'collision') {
    scene.ensureCollisionCollider();
    try {
      scene.rebuildStaticColliders();
    } catch (e) {
      logger.error('[Chunks] Failed to rebuild static colliders', e);
    }
    if (scene.v2) {
      try {
        scene.collisionLayer?.setVisible(false);
      } catch {}
    }
  }
}
