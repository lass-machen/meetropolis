export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  onPointerDown: (p: { x: number; y: number }) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  onPointerDownTile: (p: { tileX: number; tileY: number }) => void;
  onPointerMoveTile: (p: { tileX: number; tileY: number }) => void;
  onPointerUpTile: (p: { tileX: number; tileY: number }) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
};

let sceneApi: SceneApi | null = null;

export const gameBridge: Bridge = {
  onLocalMove: () => {},
  onPointerDown: () => {},
  setSceneApi: (api) => {
    sceneApi = api;
  },
  syncRemotePlayers: (players) => {
    sceneApi?.syncRemotePlayers(players);
  },
  setDesiredPosition: (pos) => {
    sceneApi?.setDesiredPosition(pos);
  },
  setZoneOverlay: (polys) => {
    sceneApi?.setZoneOverlay(polys);
  },
  setEditorAssets: (assets) => {
    sceneApi?.setEditorAssets(assets);
  },
  onPointerDownTile: () => {},
  onPointerMoveTile: () => {},
  onPointerUpTile: () => {},
  setSelectionRect: (rect) => {
    sceneApi?.setSelectionRect(rect);
  },
  applyTilePaint: (edit) => {
    sceneApi?.applyTilePaint(edit);
  },
  registerTileset: (ts) => {
    sceneApi?.registerTileset(ts);
  }
};
