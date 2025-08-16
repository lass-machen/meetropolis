import type { Room } from 'colyseus.js';
import { Schema, MapSchema } from '@colyseus/schema';

// Player Schema for Colyseus state
export class PlayerSchema extends Schema {
  x!: number;
  y!: number;
  direction!: 'up' | 'down' | 'left' | 'right';
  name?: string;
}

// World Room State
export class WorldRoomState extends Schema {
  players = new MapSchema<PlayerSchema>();
}

// Colyseus Room type
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