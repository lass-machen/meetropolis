import React from 'react';

export type EditorTool = 'zone' | 'asset' | 'select' | 'floor' | 'walls' | 'collision' | 'terrain' | 'erase';
export type EditorCategory = 'terrain' | 'structures' | 'objects' | 'zones';

export type EditorState = {
  active: boolean;
  tool: EditorTool;
  category: EditorCategory;
  tempPoints: { x: number; y: number }[];
  name: string;
  zones: { name: string; points: { x: number; y: number }[] }[];
  editingZoneIndex?: number | null;
  assets: { id: string; key: string; dataUrl: string; x: number; y: number; packUuid?: string; itemId?: string; category?: 'structures' | 'objects'; collide?: boolean; width?: number; height?: number }[];
  pendingAsset?: { key: string; dataUrl: string; packUuid?: string; itemId?: string; category?: 'structures' | 'objects'; collide?: boolean; width?: number; height?: number } | null;
  packItems?: { packUuid: string; itemId: string; key: string; category: 'terrain' | 'structures' | 'objects'; dataUrl: string; width: number; height: number; collide: boolean }[];
  pendingTerrain?: { packUuid: string; itemId: string; key: string; dataUrl: string; width?: number; height?: number } | null;
  tilePaint?: { tilesetKey: string; tileIndex: number; tileWidth: number; tileHeight: number; margin?: number; spacing?: number } | null;
  drag?: { startTileX: number; startTileY: number; endTileX: number; endTileY: number } | null;
  // Zuletzt anvisierte Kachel im Editor (für Spawn-Setzen u.ä.)
  lastTile?: { tileX: number; tileY: number } | null;
  // Spawn setzen Modus + persistierter Spawn
  settingSpawn?: boolean;
  spawn?: { x: number; y: number } | null;
  tilesets?: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number; category?: string }[];
  uploadDialog?: { open: boolean; dataUrl: string; fileName: string; tileWidth: number; tileHeight: number; margin: number; spacing: number; category?: string } | null;
  backgroundColor: string;
};

export function useEditor(): [EditorState, React.Dispatch<React.SetStateAction<EditorState>>] {
  const [editor, setEditor] = React.useState<EditorState>({
    active: false,
    tool: 'zone',
    category: 'zones',
    tempPoints: [],
    name: '',
    zones: [],
    editingZoneIndex: null,
    assets: [],
    pendingAsset: null,
    packItems: [],
    pendingTerrain: null,
    tilePaint: { tilesetKey: 'office_tiles', tileIndex: -1, tileWidth: 16, tileHeight: 16 },
    drag: null,
    lastTile: null,
    settingSpawn: false,
    spawn: (typeof window !== 'undefined' && (()=>{ try { const raw = localStorage.getItem('meetropolis.spawn'); return raw ? JSON.parse(raw) : null; } catch { return null; } })()) || null,
    tilesets: [],
    backgroundColor: (typeof window !== 'undefined' && localStorage.getItem('meetropolis.backgroundColor')) || '#202020',
  });
  return [editor, setEditor];
}


