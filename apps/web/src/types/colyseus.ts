import type { Room } from '@colyseus/sdk';
import { Schema, MapSchema } from '@colyseus/schema';

// Player Schema for Colyseus state — Mirror von apps/server/src/rooms/WorldRoom.ts Player.
// Felder müssen 1:1 mit dem Server übereinstimmen, sonst werden Werte beim
// State-Decoding ignoriert. Der Web-Client braucht keine @type()-Decorators
// (das Schema-Binding kommt zur Laufzeit vom Server), aber die Property-Liste
// muss strukturell passen für getypte Zugriffe wie state.players.get(id).dnd.
export class PlayerSchema extends Schema {
  id!: string;
  x!: number;
  y!: number;
  direction!: string;
  identity!: string;
  name!: string;
  dnd!: boolean;
  avatarId!: string;
  isNpc!: boolean;
  mapId!: string;
  mapName!: string;
}

// World Room State — Mirror von apps/server/src/rooms/WorldRoom.ts WorldState.
export class WorldRoomState extends Schema {
  players = new MapSchema<PlayerSchema>();
}

// Colyseus Room type
// Note: client-side @colyseus/sdk Room<T = any, State = InferState<T>> infers
// State automatically when T is a Schema class — single-generic form remains valid.
export type WorldRoom = Room<WorldRoomState>;

// Message types from server
export interface FullStateMessage {
  players: Array<{
    id: string;
    x: number;
    y: number;
    direction: 'up' | 'down' | 'left' | 'right';
    name?: string;
  }>;
}

export interface PlayerJoinedMessage {
  id: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  name?: string;
}

export interface PlayerMovedMessage {
  id: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

export interface PlayerLeftMessage {
  id: string;
}

export interface EditorUpdateMessage {
  type: 'tileset' | 'asset' | 'zone' | 'layers' | 'all';
  data?: any; // This will be refined based on the specific type
}

// Join options
export interface JoinWorldOptions {
  identity?: string;
  name?: string;
  x?: number;
  y?: number;
  direction?: string;
}

// Helper type for player data
export interface PlayerData {
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  name?: string;
}
