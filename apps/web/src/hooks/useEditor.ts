import React from 'react';

export type EditorTool = 'zone' | 'asset' | 'select' | 'floor' | 'walls' | 'collision' | 'erase';
export type EditorCategory = 'terrain' | 'structures' | 'objects' | 'zones';

export type EditorState = {
  active: boolean;
  tool: EditorTool;
  category: EditorCategory;
  tempPoints: { x: number; y: number }[];
  name: string;
  zones: { name: string; points: { x: number; y: number }[] }[];
  editingZoneIndex?: number | null;
  assets: { id: string; key: string; dataUrl: string; x: number; y: number }[];
  pendingAsset?: { key: string; dataUrl: string } | null;
  tilePaint?: { tilesetKey: string; tileIndex: number; tileWidth: number; tileHeight: number; margin?: number; spacing?: number } | null;
  drag?: { startTileX: number; startTileY: number; endTileX: number; endTileY: number } | null;
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
    tilePaint: { tilesetKey: 'office_tiles', tileIndex: 1, tileWidth: 16, tileHeight: 16 },
    drag: null,
    tilesets: [],
    backgroundColor: (typeof window !== 'undefined' && localStorage.getItem('meetropolis.backgroundColor')) || '#202020',
  });
  return [editor, setEditor];
}


