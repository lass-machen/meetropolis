export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  onPointerDown: (p: { x: number; y: number }) => void;
  onRightClick: (p: { x: number; y: number }) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  onPointerDownTile: (p: { tileX: number; tileY: number }) => void;
  onPointerMoveTile: (p: { tileX: number; tileY: number }) => void;
  onPointerUpTile: (p: { tileX: number; tileY: number }) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName: (name: string) => void;
  updateSpeakingStates: (speakingIds: Set<string>) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction; name?: string }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
  setEditorAssets: (assets: { id: string; key: string; dataUrl: string; x: number; y: number }[]) => void;
  setSelectionRect: (rect: { x: number; y: number; w: number; h: number } | null) => void;
  applyTilePaint: (edit: { layer: 'EditorGround' | 'Collision'; tilesetKey: string; tileIndex: number; rect: { startX: number; startY: number; endX: number; endY: number } }) => void;
  registerTileset: (ts: { key: string; dataUrl: string; tileWidth: number; tileHeight: number; margin?: number; spacing?: number }) => void;
  setCollisionVisible: (visible: boolean) => void;
  reloadEditorLayers: () => void;
  setBubbleMembers: (members: Set<string>) => void;
  setHeroName?: (name: string) => void;
  updateSpeakingStates?: (speakingIds: Set<string>) => void;
};

let sceneApi: SceneApi | null = null;
let cachedZones: { name: string; points: { x: number; y: number }[] }[] = [];
let cachedAssets: { id: string; key: string; dataUrl: string; x: number; y: number }[] = [];
let cachedCollisionVisible = false;
let cachedHeroName: string | null = null;

export const gameBridge: Bridge = {
  onLocalMove: () => {},
  onPointerDown: () => {},
  onRightClick: () => {},
  setSceneApi: (api) => {
    sceneApi = api;
    // Wenn Szene frisch gebunden wird, zuletzt bekannte Overlays/Assets anwenden
    if (sceneApi) {
      try { sceneApi.setZoneOverlay(cachedZones); } catch {}
      try { sceneApi.setEditorAssets(cachedAssets); } catch {}
      try { sceneApi.setCollisionVisible(cachedCollisionVisible); } catch {}
      try { sceneApi.reloadEditorLayers(); } catch {}
      // Set cached hero name if available
      if (cachedHeroName && sceneApi.setHeroName) {
        try { sceneApi.setHeroName(cachedHeroName); } catch {}
      }
    }
  },
  syncRemotePlayers: (players) => {
    sceneApi?.syncRemotePlayers(players);
  },
  setDesiredPosition: (pos) => {
    sceneApi?.setDesiredPosition(pos);
  },
  setZoneOverlay: (polys) => {
    cachedZones = Array.isArray(polys) ? polys : [];
    sceneApi?.setZoneOverlay(polys);
  },
  setEditorAssets: (assets) => {
    cachedAssets = Array.isArray(assets) ? assets : [];
    sceneApi?.setEditorAssets(assets);
  },
  // Optional: dedizierter Weg um Bubble-Mitglieder zu cachen (UI steuert dieses Set)
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
  },
  setCollisionVisible: (visible) => {
    cachedCollisionVisible = !!visible;
    sceneApi?.setCollisionVisible(visible);
  },
  reloadEditorLayers: () => {
    sceneApi?.reloadEditorLayers();
  },
  setBubbleMembers: (members) => {
    sceneApi?.setBubbleMembers(members);
  },
  setHeroName: (name) => {
    cachedHeroName = name;
    sceneApi?.setHeroName?.(name);
  },
  updateSpeakingStates: (speakingIds) => {
    sceneApi?.updateSpeakingStates?.(speakingIds);
  }
};
