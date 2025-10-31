import React from 'react';
import { rectsOverlap } from '../lib/geom';

type EditorState = any;

export function useEditorBridge(params: {
  editor: EditorState;
  setEditor: (updater: (s: EditorState) => EditorState) => void;
  gameBridge: any;
}) {
  const { editor, setEditor, gameBridge } = params;
  const editorActiveRef = React.useRef(false);
  const settingSpawnRef = React.useRef(false);
  React.useEffect(() => { editorActiveRef.current = !!editor.active; }, [editor.active]);
  React.useEffect(() => { settingSpawnRef.current = !!(editor as any)?.settingSpawn; }, [(editor as any)?.settingSpawn]);

  React.useEffect(() => {
    const tileSize = 16;

    const setRectPx = (drag: { startTileX: number; startTileY: number; endTileX: number; endTileY: number }) => {
      try {
        const x0 = Math.min(drag.startTileX, drag.endTileX) * tileSize;
        const y0 = Math.min(drag.startTileY, drag.endTileY) * tileSize;
        const x1 = (Math.max(drag.startTileX, drag.endTileX) + 1) * tileSize;
        const y1 = (Math.max(drag.startTileY, drag.endTileY) + 1) * tileSize;
        gameBridge.setSelectionRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      } catch {}
    };

    const handleDown = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => ({ ...s, drag: { startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY }, lastTile: { tileX, tileY } }));
      setRectPx({ startTileX: tileX, startTileY: tileY, endTileX: tileX, endTileY: tileY });
    };

    const handleMove = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      setEditor(s => {
        if (!s.drag) return s;
        const drag = { ...s.drag, endTileX: tileX, endTileY: tileY };
        setRectPx(drag);
        return { ...s, drag };
      });
    };

    const handleUp = ({ tileX, tileY }: { tileX: number; tileY: number }) => {
      if (!editorActiveRef.current) return;
      // Wenn Spawn-Setzmodus aktiv: Spawn speichern und Marker zeichnen
      if (settingSpawnRef.current) {
        const tileSize = 16;
        const x = tileX * tileSize + tileSize / 2;
        const y = tileY * tileSize + tileSize / 2;
        try { localStorage.setItem('meetropolis.spawn', JSON.stringify({ x, y })); } catch {}
        try { (window as any).initialPlayerPosition = { x, y }; } catch {}
        try { gameBridge.setSpawnMarker?.({ x, y }); } catch {}
        try { gameBridge.setDesiredPosition?.({ x, y }); } catch {}
        try {
          const ev = new CustomEvent('editor:toast', { detail: { title: 'Spawn gesetzt', description: `Startposition: (${Math.round(x)}, ${Math.round(y)})`, intent: 'success' } });
          window.dispatchEvent(ev);
        } catch {}
        setEditor(s => ({ ...s, settingSpawn: false, spawn: { x, y }, lastTile: { tileX, tileY }, drag: null }));
        try { gameBridge.setSelectionRect(null); } catch {}
        return;
      }
      setEditor(s => {
        if (!s.drag) return { ...s, lastTile: { tileX, tileY } } as any;
        const rect = s.drag;
        const tileSize = 16;
        // Zonen-Logik: nur wenn Tool 'zone' aktiv ist
        if (s.tool === 'zone' || (s.category === 'zones' && s.tool === 'select')) {
          const x0 = Math.min(rect.startTileX, rect.endTileX) * tileSize;
          const y0 = Math.min(rect.startTileY, rect.endTileY) * tileSize;
          const x1 = (Math.max(rect.startTileX, rect.endTileX) + 1) * tileSize;
          const y1 = (Math.max(rect.startTileY, rect.endTileY) + 1) * tileSize;
          const name = (s.name || `Zone ${s.zones.length + 1}`).trim();
          const poly = { name, points: [ { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 } ] };
          const newRect = { x0, y0, x1, y1 };
          const hasOverlap = (Array.isArray(s.zones) ? s.zones : []).some((z: any, idx: number) => {
            const editingIdx = s.editingZoneIndex ?? null;
            if (editingIdx !== null && idx === editingIdx) return false;
            if (!z?.points || z.points.length < 4) return false;
            const zx0 = Math.min(z.points[0].x, z.points[3].x);
            const zy0 = Math.min(z.points[0].y, z.points[1].y);
            const zx1 = Math.max(z.points[1].x, z.points[2].x);
            const zy1 = Math.max(z.points[2].y, z.points[3].y);
            return rectsOverlap(newRect, { x0: zx0, y0: zy0, x1: zx1, y1: zy1 });
          });
          if (hasOverlap) {
            try { window.dispatchEvent(new CustomEvent('editor:toast', { detail: { title: 'Überlappung verhindert', description: 'Zonen dürfen sich nicht überlappen.', intent: 'error' } })); } catch {}
            try { gameBridge.setSelectionRect(null); } catch {}
            return { ...s, drag: null, lastTile: { tileX, tileY } } as any;
          }
          const editingIdx = s.editingZoneIndex ?? null;
          const zones = Array.isArray(s.zones) ? s.zones.slice() : [];
          if (editingIdx !== null && editingIdx >= 0 && editingIdx < zones.length) {
            zones[editingIdx] = poly as any;
          } else {
            zones.push(poly as any);
          }
          try { localStorage.setItem('meetropolis.zones', JSON.stringify(zones)); } catch {}
          try { gameBridge.setZoneOverlay(zones); } catch {}
          // Best-effort Server-Update (optional, ohne UI-Block)
          try {
            const base = (window as any).VITE_API_BASE || (import.meta as any).env?.VITE_API_BASE || `${window.location.protocol}//${window.location.hostname}:2567`;
            const body = JSON.stringify({ zones, replaceZones: true });
            if (body.length < 100000) {
              fetch(`${base}/maps/office/editor-state`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
            }
          } catch {}
          return { ...s, zones, drag: null, editingZoneIndex: null, lastTile: { tileX, tileY } } as any;
        }
        try { gameBridge.setSelectionRect(null); } catch {}
        return { ...s, drag: null, lastTile: { tileX, tileY } } as any;
      });
    };

    try {
      gameBridge.onPointerDownTile = handleDown;
      gameBridge.onPointerMoveTile = handleMove;
      gameBridge.onPointerUpTile = handleUp;
    } catch {}

    return () => {
      try {
        gameBridge.onPointerDownTile = () => {};
        gameBridge.onPointerMoveTile = () => {};
        gameBridge.onPointerUpTile = () => {};
      } catch {}
    };
  }, [editor.active]);
}


