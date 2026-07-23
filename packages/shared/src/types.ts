export type PlayerId = string;

export type Player = {
  id: PlayerId;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
};

export type Bubble = {
  id: string;
  members: PlayerId[];
  center: { x: number; y: number };
  radius: number;
};

export type Zone = {
  id: string;
  name: string;
  capacity?: number;
  polygon: { x: number; y: number }[];
  roomId: string;
};

export type MapMeta = {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
};

export type MessageEvent =
  | { type: 'bubble:join'; bubbleId: string; playerId: PlayerId }
  | { type: 'bubble:leave'; bubbleId: string; playerId: PlayerId }
  | { type: 'zone:enter'; zoneId: string; playerId: PlayerId }
  | { type: 'zone:leave'; zoneId: string; playerId: PlayerId };
