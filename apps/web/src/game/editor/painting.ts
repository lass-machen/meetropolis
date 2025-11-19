import Phaser from 'phaser';
import { editorLog, editorError } from '../../lib/editorLog';

export async function ensureTerrainTilesetFor(scene: Phaser.Scene & any, dataUrl: string): Promise<string | null> {
  try {
    if (!scene.mapRef) return null;
    const map = scene.mapRef as Phaser.Tilemaps.Tilemap;
    const simpleKey = dataUrl.replace(/[^a-zA-Z0-9_:\-]/g, '_');
    const tilesetName = `terrain:${simpleKey}`;
    if (scene.dynamicTilesets.has(tilesetName) || map.tilesets.find(t => t.name === tilesetName)) {
      return tilesetName;
    }
    const texKey = `terrain_tex_${simpleKey}`;
    const doAddTileset = () => {
      let assignedFirstGid = 0;
      try {
        const mapAny = map as any;
        if (!mapAny._nextDynamicFirstGid) {
          const maxGid = Math.max(1, ...map.tilesets.map(t => (t as any).firstgid || 1));
          mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
        }
        assignedFirstGid = mapAny._nextDynamicFirstGid;
        mapAny._nextDynamicFirstGid += 1024;
      } catch (e) { editorError('Paint', 'Failed to assign first gid', e); }
      try {
        const mapAny = map as any;
        const data = mapAny.data;
        const tex = scene.textures.get(texKey);
        const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
        if (data && src) {
          const imgW = (src as any).width || map.tileWidth;
          const imgH = (src as any).height || map.tileHeight;
          const exists = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === tilesetName);
          if (!exists) {
            data.tilesets = data.tilesets || [];
            data.tilesets.push({
              firstgid: assignedFirstGid || 1,
              name: tilesetName,
              image: texKey,
              imagewidth: imgW,
              imageheight: imgH,
              tilewidth: map.tileWidth,
              tileheight: map.tileHeight,
              margin: 0,
              spacing: 0,
              columns: 1,
              tilecount: 1
            });
          }
        }
      } catch (e) { editorError('Paint', 'Failed to update map data', e); }
      try {
        if (!map.tilesets.find(t => t.name === tilesetName)) {
          const meta = new Phaser.Tilemaps.Tileset(tilesetName, assignedFirstGid || 1, map.tileWidth, map.tileHeight, 0, 0);
          (map.tilesets as any).push(meta);
        }
      } catch (e) { editorError('Paint', 'Failed to push tileset meta', e); }
      const tileset = map.addTilesetImage(tilesetName, texKey, map.tileWidth, map.tileHeight, 0, 0, assignedFirstGid || (undefined as any));
      if (tileset) {
        scene.dynamicTilesets.set(tilesetName, tileset);
        try { scene.terrainTilesetSources.set(tilesetName, dataUrl); } catch (e) { editorError('Paint', 'Failed to set terrain source', e); }
        const all = Array.from(new Set([...(map.tilesets || []), ...scene.dynamicTilesets.values()]));
        try { (scene.editorGround as any)?.setTilesets?.(all); } catch (e) { editorError('Paint', 'Failed to set ground tilesets', e); }
        try { (scene.wallsLayer as any)?.setTilesets?.(all); } catch (e) { editorError('Paint', 'Failed to set walls tilesets', e); }
        try { (scene.collisionLayer as any)?.setTilesets?.(all); } catch (e) { editorError('Paint', 'Failed to set collision tilesets', e); }
        return tilesetName;
      }
      return null;
    };
    if (scene.textures.exists(texKey)) {
      return doAddTileset();
    }
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tw = map.tileWidth;
        const th = map.tileHeight;
        const ctex = scene.textures.createCanvas(texKey, tw, th);
        const ctx = ctex?.getContext();
        if (ctex && ctx) {
          ctx.clearRect(0, 0, tw, th);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high' as any;
          ctx.drawImage(img, 0, 0, tw, th);
          ctex.refresh();
          resolve(doAddTileset());
        } else {
            resolve(null);
        }
      };
      img.onerror = () => {
          editorError('Paint', 'Failed to load image for terrain', null);
          resolve(null);
      };
      img.src = dataUrl;
    });
  } catch (e) {
    editorError('Paint', 'ensureTerrainTilesetFor failed', e);
    return null;
  }
}

export async function applyTerrainPaint(scene: Phaser.Scene & any, edit: { rect: { startX: number; startY: number; endX: number; endY: number }; dataUrl: string; attempt?: number }): Promise<void> {
  if (!scene.mapRef) return;
  const targetLayer = scene.editorGround as Phaser.Tilemaps.TilemapLayer | undefined;
  if (!targetLayer) return;
  const map = scene.mapRef as Phaser.Tilemaps.Tilemap;
  const tilesetKey = await ensureTerrainTilesetFor(scene, edit.dataUrl);
  if (!tilesetKey) return;
  const tileset = scene.dynamicTilesets.get(tilesetKey) || map.tilesets.find(t => t.name === tilesetKey);
  if (!tileset) {
     // Should not happen if ensureTerrainTilesetFor works correctly and returns valid key only when ready
    return;
  }
  try {
    const allTilesets = Array.from(new Set([...(scene.mapRef?.tilesets || []), ...scene.dynamicTilesets.values()]));
    (targetLayer as any).setTilesets?.(allTilesets);
    (targetLayer as any).tileset = allTilesets;
  } catch (e) { editorError('Paint', 'Failed to set tilesets for terrain', e); }
  const gid = (tileset as any).firstgid || 1;
  const globalIndex = gid + 0;
  const { startX, startY, endX, endY } = edit.rect;
  const x0 = Math.min(startX, endX);
  const y0 = Math.min(startY, endY);
  const x1 = Math.max(startX, endX);
  const y1 = Math.max(startY, endY);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      try { targetLayer.putTileAt(globalIndex, tx, ty); } catch (e) { editorError('Paint', 'Failed to put tile', e); }
    }
  }
  scene.saveEditorLayers();
}

export function eraseTerrainRect(scene: Phaser.Scene & any, rect: { startX: number; startY: number; endX: number; endY: number }): void {
  if (!scene.mapRef || !scene.editorGround) return;
  const layer = scene.editorGround as Phaser.Tilemaps.TilemapLayer;
  const { startX, startY, endX, endY } = rect;
  const x0 = Math.min(startX, endX);
  const y0 = Math.min(startY, endY);
  const x1 = Math.max(startX, endX);
  const y1 = Math.max(startY, endY);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      try { layer.removeTileAt(tx, ty); } catch (e) { editorError('Paint', 'Failed to remove tile', e); }
    }
  }
  scene.saveEditorLayers();
}

export function applyTilePaint(scene: Phaser.Scene & any, edit: { layer: 'EditorGround' | 'EditorWalls' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }): void {
  if (!scene.mapRef) return;
  const targetLayer = edit.layer === 'Collision' ? scene.collisionLayer : edit.layer === 'EditorWalls' ? scene.wallsLayer : scene.editorGround;
  if (!targetLayer) return;
  if (targetLayer) {
    const allTilesets = Array.from(scene.dynamicTilesets.values());
    allTilesets.push(...scene.mapRef.tilesets.filter((ts: any) => !scene.dynamicTilesets.has(ts.name)));
    try { (targetLayer as any).setTilesets?.(allTilesets); } catch (e) { editorError('Paint', 'Failed to set tilesets', e); }
    try { (targetLayer as any).tileset = allTilesets; } catch (e) { editorError('Paint', 'Failed to set tileset prop', e); }
  }
  let tileset = scene.dynamicTilesets.get(edit.tilesetKey) || scene.mapRef.tilesets.find((ts: any) => ts.name === edit.tilesetKey);
  if (!tileset && edit.tileIndex >= 0) {
    const pending = scene.pendingTilesetRegistrations?.find((ts: any) => ts.key === edit.tilesetKey);
    if (pending) {
      scene.registerTileset(pending);
      setTimeout(() => { applyTilePaint(scene, edit); }, 200);
      return;
    }
    return;
  }
  const x0 = Math.min(edit.rect.startX, edit.rect.endX);
  const y0 = Math.min(edit.rect.startY, edit.rect.endY);
  const x1 = Math.max(edit.rect.startX, edit.rect.endX);
  const y1 = Math.max(edit.rect.startY, edit.rect.endY);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (edit.tileIndex < 0) {
        (targetLayer as Phaser.Tilemaps.TilemapLayer).removeTileAt(tx, ty);
      } else if (tileset) {
        const globalIndex = (tileset as any).firstgid + edit.tileIndex;
        try {
          (targetLayer as Phaser.Tilemaps.TilemapLayer).putTileAt(globalIndex, tx, ty);
        } catch (error) {
          if (edit.layer === 'Collision') {
            editorError('Paint', 'Failed to put collision tile', error);
          }
        }
      }
    }
  }
  try { (((targetLayer as any).layer) || targetLayer)["dirty"] = true; } catch (e) { editorError('Paint', 'Failed to set dirty flag', e); }
  try { const a = (targetLayer as Phaser.Tilemaps.TilemapLayer).alpha; (targetLayer as Phaser.Tilemaps.TilemapLayer).setAlpha(a === 1 ? 0.999 : 1); setTimeout(() => { try { (targetLayer as Phaser.Tilemaps.TilemapLayer).setAlpha(1); } catch (e) { editorError('Paint', 'Failed to restore alpha', e); } }, 0); } catch (e) { editorError('Paint', 'Failed to toggle alpha', e); }
  if (targetLayer === scene.collisionLayer) {
    scene.ensureCollisionCollider();
    // WICHTIG: Auch für den Editor sofort static bodies neu bauen, damit die Physik konsistent ist
    try { scene.rebuildStaticColliders(); } catch (e) { editorError('Paint', 'Failed to rebuild static colliders', e); }
    if (scene.v2) { try { scene.collisionLayer?.setVisible(false); } catch (e) { editorError('Paint', 'Failed to hide collision layer', e); } }
    try { if (scene.collisionVisible) scene.updateCollisionOverlay(); } catch (e) { editorError('Paint', 'Failed to update collision overlay', e); }
    try {
      if (scene.v2) {
        const base = (window as any).VITE_API_BASE || (import.meta as any).env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
        const body = JSON.stringify({ layer: 'collision', rect: { x0, y0, x1, y1 }, erase: edit.tileIndex < 0, tileRefId: 1 });
        fetch(`${base}/maps/${encodeURIComponent(scene.currentMapName)}/paint-rect`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body })
          .then(res => { if (!res.ok) console.error('Paint failed', res.status, res.statusText); })
          .catch((e)=>{ editorError('Paint', 'Failed to patch collision', e); });
      }
    } catch (e) { editorError('Paint', 'Failed to sync collision', e); }
  }

  try {
    const base = (window as any).VITE_API_BASE || (import.meta as any).env.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
    const bodyCommon = { rect: { x0, y0, x1, y1 }, erase: edit.tileIndex < 0 } as any;
    if (edit.layer === 'EditorGround' || edit.layer === 'EditorWalls') {
      const layerName = edit.layer === 'EditorGround' ? 'ground' : 'walls';
      let tileRefId: number | undefined = undefined;
      if (!bodyCommon.erase) {
        try {
          const ts = scene.v2?.state?.tilesetRegistry?.find((t: any) => t?.key === edit.tilesetKey);
          const slot = typeof ts?.slot === 'number' ? ts.slot : 0;
          const idx = Math.max(0, edit.tileIndex | 0);
          tileRefId = ((slot & 0xffff) << 16) | (idx & 0xffff);
        } catch (e) { editorError('Paint', 'Failed to compute tileRefId', e); }
      }
      const body = JSON.stringify({ layer: layerName, ...bodyCommon, tileRefId });
      fetch(`${base}/maps/${encodeURIComponent(scene.currentMapName)}/paint-rect`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body })
        .then(res => { if (!res.ok) console.error('Paint failed', res.status, res.statusText); })
        .catch((e)=>{ editorError('Paint', 'Failed to patch layer', e); });
    }
  } catch (e) { editorError('Paint', 'Failed to sync paint', e); }
}


