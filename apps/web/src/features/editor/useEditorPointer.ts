import * as React from 'react';
import { gameBridge } from '../../game/bridge';

type EditorState = any;

export function useEditorPointer({ editor, setEditor, apiBase }: { editor: EditorState; setEditor: React.Dispatch<React.SetStateAction<any>>; apiBase: string }) {
  React.useEffect(() => {
    const tileSize = 16;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSaveAssets = (assets: any[]) => {
      try { if (saveTimer) clearTimeout(saveTimer); } catch {}
      saveTimer = setTimeout(() => {
        try {
          const mapName = (typeof window !== 'undefined' && (((window as any).__map_name) || (window as any).MAP_NAME)) || 'office';
          const body = JSON.stringify({ assets });
          if (body.length < 100000) {
            fetch(`${apiBase}/maps/${encodeURIComponent(mapName)}/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body }).catch(()=>{});
          }
        } catch {}
      }, 300);
    };

    const placeAsset = (tileX: number, tileY: number) => {
      const p = editor.pendingAsset;
      if (!p) return;
      const x = tileX * tileSize + tileSize / 2;
      const y = tileY * tileSize + tileSize / 2;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const next: { id: string; key: string; dataUrl: string; x: number; y: number; packUuid?: string; itemId?: string; category?: 'structures' | 'objects'; collide?: boolean; width?: number; height?: number } = { id, key: p.key, dataUrl: p.dataUrl, x, y };
      if (p.packUuid) next.packUuid = p.packUuid;
      if (p.itemId) next.itemId = p.itemId;
      if (p.category) next.category = p.category;
      if (p.collide) next.collide = true;
      if (typeof p.width === 'number') next.width = p.width;
      if (typeof p.height === 'number') next.height = p.height;
      setEditor((s: any) => {
        const assets = [...s.assets, next];
        try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
        try { gameBridge.setEditorAssets(assets); } catch {}
        scheduleSaveAssets(assets);
        if (next.collide === true) {
          const wTiles = Math.max(1, Math.round(((next.width ?? tileSize) / tileSize)));
          const hTiles = Math.max(1, Math.round(((next.height ?? tileSize) / tileSize)));
          const startX = tileX - Math.floor(wTiles / 2);
          const startY = tileY - Math.floor(hTiles / 2);
          const endX = startX + wTiles - 1;
          const endY = startY + hTiles - 1;
          try { gameBridge.applyTilePaint({ layer: 'Collision', tilesetKey: 'collision_tiles', tileIndex: 0, rect: { startX, startY, endX, endY } }); } catch {}
        }
        return { ...s, assets };
      });
    };

    const endDragAssets = () => {
      setEditor((s: any) => {
        const d = s.drag;
        if (!d || !s.pendingAsset) return s;
        const p = s.pendingAsset;
        const minX = Math.min(d.startTileX, d.endTileX);
        const minY = Math.min(d.startTileY, d.endTileY);
        const maxX = Math.max(d.startTileX, d.endTileX);
        const maxY = Math.max(d.startTileY, d.endTileY);
        const nextAssets = s.assets.slice();
        for (let ty = minY; ty <= maxY; ty++) {
          for (let tx = minX; tx <= maxX; tx++) {
            const x = tx * tileSize + tileSize / 2;
            const y = ty * tileSize + tileSize / 2;
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const na: any = { id, key: p.key, dataUrl: p.dataUrl, x, y };
            if (p.packUuid) na.packUuid = p.packUuid;
            if (p.itemId) na.itemId = p.itemId;
            if (p.category) na.category = p.category;
            if (p.collide) na.collide = true;
            if (typeof p.width === 'number') na.width = p.width;
            if (typeof p.height === 'number') na.height = p.height;
            nextAssets.push(na);
          }
        }
        try { localStorage.setItem('meetropolis.assets', JSON.stringify(nextAssets)); } catch {}
        try { gameBridge.setEditorAssets(nextAssets); } catch {}
        scheduleSaveAssets(nextAssets);
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, assets: nextAssets, drag: null };
      });
    };

    const beginDrag = (tileX: number, tileY: number) => {
      setEditor((s: any) => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY } }));
      try {
        const x0 = tileX * tileSize;
        const y0 = tileY * tileSize;
        gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize });
      } catch {}
    };

    const updateDrag = (tileX: number, tileY: number) => {
      setEditor((s: any) => {
        if (!s.drag) return s;
        const next = { ...s.drag, endTileX: tileX, endTileY: tileY };
        try {
          const x0 = Math.min(next.startTileX, next.endTileX) * tileSize;
          const y0 = Math.min(next.startTileY, next.endTileY) * tileSize;
          const x1 = (Math.max(next.startTileX, next.endTileX) + 1) * tileSize;
          const y1 = (Math.max(next.startTileY, next.endTileY) + 1) * tileSize;
          gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        } catch {}
        return { ...s, drag: next };
      });
    };

    const endDragPaint = (layer: 'EditorGround' | 'Collision', tilesetKey: string, tileIndex: number) => {
      setEditor((s: any) => {
        const d = s.drag;
        if (!d) return s;
        const rect = { startX: Math.min(d.startTileX, d.endTileX), startY: Math.min(d.startTileY, d.endTileY), endX: Math.max(d.startTileX, d.endTileX), endY: Math.max(d.startTileY, d.endTileY) };
        try { gameBridge.applyTilePaint({ layer, tilesetKey, tileIndex, rect }); } catch {}
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, drag: null };
      });
    };
    const endDragZone = () => {
      setEditor((s: any) => {
        const d = s.drag;
        if (!d) return s;
        const x0 = Math.min(d.startTileX, d.endTileX) * tileSize;
        const y0 = Math.min(d.startTileY, d.endTileY) * tileSize;
        const x1 = (Math.max(d.startTileX, d.endTileX) + 1) * tileSize;
        const y1 = (Math.max(d.startTileY, d.endTileY) + 1) * tileSize;
        const poly = [ { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 } ];
        const zones = s.zones.slice();
        zones.push({ name: s.name || 'Zone', points: poly } as any);
        try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
        try { gameBridge.setZoneOverlay(zones as any); } catch {}
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, zones, drag: null, editingZoneIndex: null, tool: 'select' };
      });
    };

    const handleDown = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'asset' && editor.pendingAsset) { beginDrag(tileX, tileY); return; }
      if (editor.tool === 'floor' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) { beginDrag(tileX, tileY); return; }
      if (editor.tool === 'collision' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) { beginDrag(tileX, tileY); return; }
      if (editor.tool === 'erase' && editor.category === 'terrain') { beginDrag(tileX, tileY); return; }
      if (editor.tool === 'erase' && (editor.category === 'objects' || editor.category === 'structures')) {
        const x = tileX * tileSize + tileSize / 2;
        const y = tileY * tileSize + tileSize / 2;
        setEditor((s: any) => {
          const radius = tileSize / 2;
          const idx = [...s.assets].reverse().findIndex((a: any) => Math.abs(a.x - x) <= radius && Math.abs(a.y - y) <= radius);
          if (idx === -1) return s;
          const realIdx = s.assets.length - 1 - idx;
          const assets = s.assets.slice();
          assets.splice(realIdx, 1);
          try { localStorage.setItem('meetropolis.assets', JSON.stringify(assets)); } catch {}
          try { gameBridge.setEditorAssets(assets); } catch {}
          scheduleSaveAssets(assets);
          return { ...s, assets };
        });
        return;
      }
      if (editor.tool === 'zone') { beginDrag(tileX, tileY); return; }
    };

    const handleMove = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'asset' && editor.pendingAsset) {
        if (editor.drag) updateDrag(tileX, tileY);
        return;
      }
      if (editor.tool === 'floor' || editor.tool === 'collision') {
        if (editor.drag) updateDrag(tileX, tileY);
        else if (editor.tilePaint && editor.tilePaint.tileIndex >= 0) {
          const x0 = tileX * tileSize; const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      if (editor.tool === 'erase' && editor.category === 'terrain') {
        if (editor.drag) updateDrag(tileX, tileY);
        else {
          const x0 = tileX * tileSize; const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      if (editor.tool === 'zone') {
        if (editor.drag) updateDrag(tileX, tileY);
        else {
          const x0 = tileX * tileSize; const y0 = tileY * tileSize;
          try { gameBridge.setSelectionRect({ x: x0, y: y0, w: tileSize, h: tileSize }); } catch {}
        }
        return;
      }
      try { gameBridge.setSelectionRect(null); } catch {}
    };

    const handleUp = (_arg: { tileX: number; tileY: number }) => {
      if (!editor.active) return;
      if (editor.tool === 'asset' && editor.pendingAsset) {
        if (!editor.drag) { return; }
        endDragAssets();
        return;
      }
      if (editor.tool === 'floor' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) { if (!editor.drag) return; endDragPaint('EditorGround', editor.tilePaint.tilesetKey, editor.tilePaint.tileIndex); return; }
      if (editor.tool === 'collision' && editor.tilePaint && editor.tilePaint.tileIndex >= 0) { if (!editor.drag) return; endDragPaint('Collision', editor.tilePaint.tilesetKey, editor.tilePaint.tileIndex); return; }
      if (editor.tool === 'erase' && editor.category === 'terrain') {
        if (!editor.drag) return;
        setEditor((s: any) => {
          const d = s.drag;
          if (!d) { try { gameBridge.setSelectionRect(null); } catch {} return s; }
          const rect = { startX: Math.min(d.startTileX, d.endTileX), startY: Math.min(d.startTileY, d.endTileY), endX: Math.max(d.startTileX, d.endTileX), endY: Math.max(d.startTileY, d.endTileY) };
          try { gameBridge.applyTilePaint({ layer: 'EditorGround', tilesetKey: s.tilePaint?.tilesetKey || 'office_tiles', tileIndex: -1, rect }); } catch {}
          try { gameBridge.applyTilePaint({ layer: 'Collision', tilesetKey: 'collision_tiles', tileIndex: -1, rect }); } catch {}
          try { gameBridge.setSelectionRect(null); } catch {}
          return { ...s, drag: null };
        });
        return;
      }
      if (editor.tool === 'zone') { if (!editor.drag) return; endDragZone(); return; }
    };
    const noop = () => {};
    try {
      (gameBridge as any).onPointerDownTile = handleDown;
      (gameBridge as any).onPointerMoveTile = handleMove;
      (gameBridge as any).onPointerUpTile = handleUp;
    } catch {}
    return () => {
      try {
        (gameBridge as any).onPointerDownTile = noop;
        (gameBridge as any).onPointerMoveTile = noop;
        (gameBridge as any).onPointerUpTile = noop;
      } catch {}
    };
  }, [editor.active, editor.tool, editor.pendingAsset, editor.tilePaint, editor.drag, editor.name, editor.editingZoneIndex, apiBase]);
}


