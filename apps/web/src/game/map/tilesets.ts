import Phaser from 'phaser';
import { logger } from '../../lib/logger';

export function registerTileset(scene: Phaser.Scene & any, ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number | undefined; spacing?: number | undefined }): void {
  const nameForTileset = (() => {
    const k = ts.key || '';
    if (!k || k.length > 64 || k.startsWith('data:') || k.includes('data:image')) {
      return `tileset-${Date.now()}`;
    }
    return k;
  })();
  logger.debug('[ASSETS_DBG][Scene] registerTileset', { key: nameForTileset, url: ts.dataUrl?.slice?.(0, 32) || typeof ts.dataUrl, tw: ts.tileWidth, th: ts.tileHeight, m: ts.margin ?? 0, s: ts.spacing ?? 0 });
  if (!scene.mapRef || !scene.game || !(scene.game as any).renderer) return;

  const existingTileset = scene.mapRef.tilesets.find((t: any) => t.name === nameForTileset);
  if (existingTileset) {
    scene.dynamicTilesets.set(nameForTileset, existingTileset);
    return;
  }
  try { if (scene.dynamicTilesets.has(ts.key)) return; } catch {}
  if (!scene.textures.exists(ts.key)) {
    let key = nameForTileset;
    while (scene.textures.exists(key)) { key = `${nameForTileset}-${Date.now()}`; }
    const safeKey = key;
    scene.textures.once('addtexture', (key: string) => {
      logger.debug('[ASSETS_DBG][Scene] addtexture event', { key, safeKey });
      if (key === safeKey && scene.mapRef) {
        let tileset: Phaser.Tilemaps.Tileset | null = null;
        try {
          let textureKeyForMap = safeKey;
          let tileWForMap = ts.tileWidth;
          let tileHForMap = ts.tileHeight;
          try {
            const map = scene.mapRef as Phaser.Tilemaps.Tilemap;
            const tex = scene.textures.get(safeKey);
            const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
            if (map && src && (ts.tileWidth !== map.tileWidth || ts.tileHeight !== map.tileHeight)) {
              const sx = map.tileWidth / ts.tileWidth;
              const sy = map.tileHeight / ts.tileHeight;
              const cw = Math.max(1, Math.round((src as any).width * sx));
              const ch = Math.max(1, Math.round((src as any).height * sy));
              const scaledKey = `${safeKey}__scaled_${map.tileWidth}x${map.tileHeight}`;
              if (!scene.textures.exists(scaledKey)) {
                const ctex = scene.textures.createCanvas(scaledKey, cw, ch);
                const ctx = ctex?.getContext();
                if (ctex && ctx) {
                  ctx.clearRect(0, 0, cw, ch);
                  ctx.imageSmoothingEnabled = true;
                  ctx.imageSmoothingQuality = 'high' as any;
                  ctx.drawImage(src as any, 0, 0, cw, ch);
                  ctex.refresh();
                }
              }
              if (scene.textures.exists(scaledKey)) {
                textureKeyForMap = scaledKey;
                tileWForMap = map.tileWidth;
                tileHForMap = map.tileHeight;
              }
            }
          } catch {}
          try {
            const tex2 = scene.textures.get(textureKeyForMap);
            const src2 = tex2?.getSourceImage?.() as HTMLImageElement | HTMLCanvasElement | undefined;
            const margin = ts.margin ?? 0;
            const spacing = ts.spacing ?? 0;
            const imgW = (src2 as any)?.width || 0;
            const imgH = (src2 as any)?.height || 0;
            const fitsW = imgW > 0 ? ((imgW - margin + spacing) % (tileWForMap + spacing) === 0) : true;
            const fitsH = imgH > 0 ? ((imgH - margin + spacing) % (tileHForMap + spacing) === 0) : true;
            if (!fitsW || !fitsH) {
              logger.debug('[ASSETS_DBG][Scene] skip tileset (non-multiple area)', { key: ts.key, imgW, imgH, tileWForMap, tileHForMap, margin, spacing });
              return;
            }
          } catch {}
          const existingTileset2 = scene.mapRef.tilesets.find((t: any) => t.name === nameForTileset);
          if (existingTileset2) {
            tileset = existingTileset2;
            scene.dynamicTilesets.set(nameForTileset, tileset);
            logger.debug('Tileset', `Using existing tileset ${existingTileset2.name} for ${nameForTileset}`);
          } else {
            try {
              let assignedFirstGid = 0;
              try {
                const mapAny = scene.mapRef as any;
                if (!mapAny._nextDynamicFirstGid) {
                  const maxGid = Math.max(1, ...scene.mapRef.tilesets.map((t: any) => (t as any).firstgid || 1));
                  mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
                }
                assignedFirstGid = mapAny._nextDynamicFirstGid;
                mapAny._nextDynamicFirstGid += 1024;
              } catch {}
              try {
                const mapAny = scene.mapRef as any;
                const data = mapAny.data;
                const tex = scene.textures.get(textureKeyForMap);
                const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
                if (data && src) {
                  const margin = ts.margin ?? 0;
                  const spacing = ts.spacing ?? 0;
                  const imgW = (src as any).width || 0;
                  const imgH = (src as any).height || 0;
                  const cols = Math.max(1, Math.floor((imgW - margin + spacing) / (tileWForMap + spacing)));
                  const rows = Math.max(1, Math.floor((imgH - margin + spacing) / (tileHForMap + spacing)));
                  const tilecount = Math.max(0, cols * rows);
                  const existsInData = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === nameForTileset);
                  if (!existsInData) {
                    data.tilesets = data.tilesets || [];
                    data.tilesets.push({ firstgid: assignedFirstGid || 1, source: undefined, name: nameForTileset, image: textureKeyForMap, imagewidth: imgW, imageheight: imgH, tilewidth: tileWForMap, tileheight: tileHForMap, margin, spacing, columns: cols, tilecount });
                  }
                }
              } catch {}
              try {
                if (!scene.mapRef.tilesets.find((t: any) => t.name === nameForTileset)) {
                  const meta = new Phaser.Tilemaps.Tileset(nameForTileset, assignedFirstGid || 1, tileWForMap, tileHForMap, ts.margin ?? 0, ts.spacing ?? 0);
                  (scene.mapRef.tilesets as any).push(meta);
                }
              } catch {}
              tileset = scene.mapRef.addTilesetImage(nameForTileset, textureKeyForMap, tileWForMap, tileHForMap, ts.margin ?? 0, ts.spacing ?? 0, assignedFirstGid || (undefined as any));
              if (tileset) {
                try { if (!scene.mapRef.tilesets.find((t: any) => t.name === (tileset as any).name)) { (scene.mapRef.tilesets as any).push(tileset); } } catch {}
                scene.dynamicTilesets.set(nameForTileset, tileset);
                logger.debug('Tileset', `Successfully added tileset ${nameForTileset}`);
              }
            } catch (err) {
              logger.warn('Tileset', `Failed to create tileset ${safeKey}:`, err);
              return;
            }
          }
          if (tileset) {
            const allTilesets = Array.from(scene.dynamicTilesets.values());
            const extra = scene.mapRef ? scene.mapRef.tilesets.filter((t: any) => !scene.dynamicTilesets.has(t.name)) : [] as Phaser.Tilemaps.Tileset[];
            allTilesets.push(...extra);
            if (scene.editorGround) { try { (scene.editorGround as any).setTilesets?.(allTilesets); } catch {} try { (scene.editorGround as any).tileset = allTilesets; } catch {} }
            if (scene.wallsLayer) { try { (scene.wallsLayer as any).setTilesets?.(allTilesets); } catch {} try { (scene.wallsLayer as any).tileset = allTilesets; } catch {} }
            if (scene.collisionLayer) { (scene.collisionLayer as any).setTilesets(allTilesets); }
            if (!scene.editorGround && scene.mapRef) {
              try {
                const tmp = scene.mapRef.createBlankLayer('EditorGround', tileset, 0, 0, scene.mapRef.width, scene.mapRef.height, scene.mapRef.tileWidth, scene.mapRef.tileHeight);
                scene.editorGround = tmp as any;
                if (scene.editorGround) scene.editorGround.setDepth(1);
              } catch {}
            }
          }
        } catch (error) {
          logger.warn('Tileset', `Failed to add tileset ${safeKey}:`, error);
          return;
        }
      }
    });
    const isDataUrl = typeof ts.dataUrl === 'string' && ts.dataUrl.startsWith('data:');
    if (isDataUrl) {
      scene.textures.addBase64(safeKey, ts.dataUrl);
    } else {
      try { scene.load.image(safeKey, ts.dataUrl); scene.load.start(); } catch {}
    }
  } else {
    try {
      let assignedFirstGid = 0;
      try {
        const mapAny = scene.mapRef as any;
        if (!mapAny._nextDynamicFirstGid) {
          const maxGid = Math.max(1, ...scene.mapRef.tilesets.map((t: any) => (t as any).firstgid || 1));
          mapAny._nextDynamicFirstGid = Math.ceil((maxGid + 1) / 1024) * 1024;
        }
        assignedFirstGid = mapAny._nextDynamicFirstGid;
        mapAny._nextDynamicFirstGid += 1024;
      } catch {}
      try {
        const mapAny = scene.mapRef as any;
        const data = mapAny.data;
        const tex = scene.textures.get(ts.key);
        const src = tex?.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
        if (data && src) {
          const margin = ts.margin ?? 0;
          const spacing = ts.spacing ?? 0;
          const imgW = (src as any).width || 0;
          const imgH = (src as any).height || 0;
          const cols = Math.max(1, Math.floor((imgW - margin + spacing) / ((ts.tileWidth || 16) + spacing)));
          const rows = Math.max(1, Math.floor((imgH - margin + spacing) / ((ts.tileHeight || 16) + spacing)));
          const tilecount = Math.max(0, cols * rows);
          const existsInData = Array.isArray(data.tilesets) && data.tilesets.find((t: any) => t.name === ts.key);
          if (!existsInData) {
            data.tilesets = data.tilesets || [];
            data.tilesets.push({ firstgid: assignedFirstGid || 1, source: undefined, name: ts.key, image: ts.key, imagewidth: imgW, imageheight: imgH, tilewidth: ts.tileWidth, tileheight: ts.tileHeight, margin, spacing, columns: cols, tilecount });
          }
        }
      } catch {}
      try {
        if (!scene.mapRef.tilesets.find((t: any) => t.name === ts.key)) {
          const meta = new Phaser.Tilemaps.Tileset(ts.key, assignedFirstGid || 1, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0);
          (scene.mapRef.tilesets as any).push(meta);
        }
      } catch {}
      const tileset = scene.mapRef.addTilesetImage(ts.key, ts.key, ts.tileWidth, ts.tileHeight, ts.margin ?? 0, ts.spacing ?? 0, assignedFirstGid || (undefined as any));
      if (tileset) {
        scene.dynamicTilesets.set(ts.key, tileset);
        const allTilesets = Array.from(scene.dynamicTilesets.values());
        allTilesets.push(...scene.mapRef.tilesets.filter((t: any) => !scene.dynamicTilesets.has(t.name)));
        if (scene.editorGround) { try { (scene.editorGround as any).setTilesets?.(allTilesets); } catch {} try { (scene.editorGround as any).tileset = allTilesets; } catch {} }
        if (scene.wallsLayer) { try { (scene.wallsLayer as any).setTilesets?.(allTilesets); } catch {} try { (scene.wallsLayer as any).tileset = allTilesets; } catch {} }
        if (scene.collisionLayer) { (scene.collisionLayer as any).setTilesets(allTilesets); }
      }
    } catch (error) {
      logger.warn('Tileset', `Failed to add existing tileset ${ts.key}:`, error);
    }
  }
}

