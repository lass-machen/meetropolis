export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
  setDesiredPosition: (pos: { x: number; y: number } | null) => void;
  setZoneOverlay: (polys: { name: string; points: { x: number; y: number }[] }[]) => void;
};

let sceneApi: SceneApi | null = null;

export const gameBridge: Bridge = {
  onLocalMove: () => {},
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
  }
};
