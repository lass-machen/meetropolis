export type Direction = 'up' | 'down' | 'left' | 'right';

type Bridge = {
  onLocalMove: (p: { x: number; y: number; direction: Direction }) => void;
  setSceneApi: (api: SceneApi | null) => void;
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
};

export type SceneApi = {
  syncRemotePlayers: (players: Record<string, { x: number; y: number; direction: Direction }>) => void;
};

let sceneApi: SceneApi | null = null;

export const gameBridge: Bridge = {
  onLocalMove: () => {},
  setSceneApi: (api) => {
    sceneApi = api;
  },
  syncRemotePlayers: (players) => {
    sceneApi?.syncRemotePlayers(players);
  }
};

