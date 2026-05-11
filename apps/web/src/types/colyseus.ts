import type { Room } from '@colyseus/sdk';
import { Schema, MapSchema } from '@colyseus/schema';
import type { ZoneLockInfo } from '@meetropolis/shared';

// Player schema for the Colyseus state, mirrors apps/server/src/rooms/WorldRoom.ts Player.
// Fields must match the server exactly, otherwise values are silently dropped
// during state decoding. The web client does not need @type() decorators
// (schema binding is provided by the server at runtime), but the property
// list must line up structurally for typed access like
// state.players.get(id).dnd.
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

// World room state, mirrors apps/server/src/rooms/WorldRoom.ts WorldState.
export class WorldRoomState extends Schema {
  players = new MapSchema<PlayerSchema>();
}

// Colyseus Room type
// Note: client-side @colyseus/sdk Room<T = any, State = InferState<T>> infers
// State automatically when T is a Schema class; the single-generic form remains valid.
export type WorldRoom = Room<WorldRoomState>;

// Player movement direction sent by server.
export type PlayerDirection = 'up' | 'down' | 'left' | 'right';

// Common player fields delivered as part of full_state / state.players.
// Mirrors apps/server/src/rooms/WorldRoom.ts Player schema.
export interface PlayerStateData {
  id: string;
  x: number;
  y: number;
  direction: PlayerDirection;
  name?: string;
  identity?: string;
  dnd?: boolean;
  avatarId?: string;
  isNpc?: boolean;
  mapId?: string;
  mapName?: string;
}

// Message types from server
export interface FullStateMessage {
  players: PlayerStateData[];
}

// player_joined broadcast (see apps/server/src/rooms/lifecycle/onJoin.ts).
export interface PlayerJoinedMessage {
  id: string;
  x: number;
  y: number;
  direction: PlayerDirection;
  name?: string;
  identity?: string;
  dnd?: boolean;
  avatarId?: string;
  isNpc?: boolean;
  mapId?: string;
  mapName?: string;
}

// player_moved broadcast (see apps/server/src/rooms/handlers/playerHandlers.ts).
export interface PlayerMovedMessage {
  id: string;
  x: number;
  y: number;
  direction: PlayerDirection;
  mapId?: string;
  mapName?: string;
}

export interface PlayerLeftMessage {
  id: string;
}

// player_dnd broadcast (see apps/server/src/rooms/handlers/dndHandler.ts).
export interface PlayerDndMessage {
  id: string;
  dnd: boolean;
}

// player_avatar broadcast (see apps/server/src/rooms/handlers/avatarHandler.ts).
export interface PlayerAvatarMessage {
  id: string;
  avatarId: string;
}

// player_map_changed broadcast (see apps/server/src/rooms/handlers/mapSwitchHandler.ts).
export interface PlayerMapChangedMessage {
  id: string;
  oldMapId?: string;
  newMapId?: string;
  oldMapName: string;
  newMapName: string;
  mapId?: string;
  mapName?: string;
  x: number;
  y: number;
  name?: string;
  identity?: string;
  avatarId?: string;
  dnd?: boolean;
  isNpc?: boolean;
}

// editor_update payload. The server sends arbitrary `{ type: string; ... }` data
// (see apps/server/src/rooms/handlers/editorHandler.ts), so the shape varies
// per `type` discriminator. Known variants are listed below; unknown fields
// are accepted via the index signature.
export interface EditorUpdateMessage {
  type: string;
  mapId?: string;
  // Zone polygons (type === 'zone')
  polys?: unknown[];
  // Spawn marker (type === 'spawn')
  pos?: { x: number; y: number };
  // Tile paint edit (type === 'tile_paint')
  edit?: unknown;
  // Additional payload fields tolerated by the server (Record<string, unknown>).
  [key: string]: unknown;
}

// remote_control payload sent by API to a target session.
// Each field is optional and toggles the corresponding local AV state.
export interface RemoteControlMessage {
  mic?: boolean;
  cam?: boolean;
  share?: boolean;
  dnd?: boolean;
}

// remote_controls broadcast: wraps RemoteControlMessage for many clients.
export interface RemoteControlsMessage {
  payload?: RemoteControlMessage;
}

// remote_controls_for: targeted variant identified by `forIdentity`.
export interface RemoteControlsForMessage {
  forIdentity?: string;
  payload?: RemoteControlMessage;
}

// bubble_state broadcast (see apps/server/src/rooms/utils/bubbleHelpers.ts).
export interface BubbleStateMessage {
  members?: string[];
  groups?: Array<{ id: string; members: string[] }>;
}

// zone_lock_state broadcast (see apps/server/src/rooms/handlers/zoneLockHandler.ts).
export interface ZoneLockStateMessage {
  locks?: ZoneLockInfo[];
}

// zone_move_blocked / zone_access_denied (server-side messages with a zone name).
export interface ZoneNameMessage {
  zoneName?: string;
}

// chunks_updated payload forwarded via presence subscribe in editorHandler.
export interface ChunksUpdatedMessage {
  mapId?: string;
  layer?: string;
  updates?: unknown[];
}

// objects_updated payload forwarded via presence subscribe in editorHandler.
export interface ObjectsUpdatedMessage {
  mapId?: string;
  [key: string]: unknown;
}

// tileset_registry_updated payload forwarded via presence subscribe.
export interface TilesetRegistryUpdatedMessage {
  mapId?: string;
  tilesetRegistry?: unknown[];
}

// presence_recent / presence_update payloads use ApiPresence from
// apps/web/src/features/participants/presence.ts. The shape is re-exported
// loosely here to avoid a circular import; handlers import ApiPresence
// directly from the presence module.

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
