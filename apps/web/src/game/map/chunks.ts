import Phaser from 'phaser';
import { fetchChunks, decodeRLE, tileRefIdToGid } from '../../lib/mapV2';
import { logger } from '../../lib/logger';

export async function loadVisibleChunks(scene: Phaser.Scene & any, layerName: 'ground' | 'walls' | 'collision'): Promise<void> {
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
  const keys: string[] = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const k = `${cx}:${cy}`;
    if (!scene.loadedChunks.has(`${layerName}:${k}`)) keys.push(k);
  }
  if (keys.length === 0) return;
  const chunks = await fetchChunks(scene.currentMapName, layerName, keys);
  const updates = Object.entries(chunks).map(([key, val]: any) => ({ key, version: val.version, encoding: val.encoding, data: val.data }));
  if (layerName === 'collision' && updates.length > 0) {
    logger.debug(`[Chunks] Applying ${updates.length} collision updates for keys: ${updates.map(u => u.key).join(', ')}`);
  }
  applyChunkUpdates(scene, layerName, updates);
}

export function applyChunkUpdates(scene: Phaser.Scene & any, layerName: 'ground' | 'walls' | 'collision', updates: Array<{ key: string; version: number; encoding: string; data: string }>): void {
  if (!scene.v2 || !scene.mapRef) return;
  const layer = layerName === 'collision' ? scene.collisionLayer : (layerName === 'walls' ? scene.wallsLayer : scene.editorGround);
  if (!layer) {
     logger.warn(`[Chunks] Layer ${layerName} not found on scene`);
     return;
  }
  const cs = scene.v2.chunkSize;
  const total = cs * cs;
  for (const u of updates) {
    const [xs, ys] = u.key.split(':');
    const cx = Number(xs), cy = Number(ys);
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
          } catch (e) { logger.warn('[Chunks] putTileAt failed', e); }
        } else {
          try { layer.removeTileAt(gx, gy); } catch {}
        }
      } else {
        const gid = tileRefIdToGid(arr[i] | 0, scene.v2.firstGids);
        if (gid < 0) layer.removeTileAt(gx, gy);
        else layer.putTileAt(gid, gx, gy);
      }
    }
    scene.loadedChunks.add(`${layerName}:${cx}:${cy}`);
  }
  if (layerName === 'collision') {
    scene.ensureCollisionCollider();
    try { scene.rebuildStaticColliders(); } catch (e) { console.error('[Chunks] Failed to rebuild static colliders', e); }
    if (scene.v2) { try { scene.collisionLayer?.setVisible(false); } catch {} }
  }
}


