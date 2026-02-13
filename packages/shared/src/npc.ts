// NPC System Types

export interface NpcDefinition {
  id: string;
  tenantId: string;
  identity: string;
  name: string;
  avatarId: string;
  spawnX: number;
  spawnY: number;
  spawnDirection: string;
  enabled: boolean;
  showBadge: boolean;
  mapName?: string | null;
  config?: Record<string, unknown> | null;
}

export interface NpcMediaFileInfo {
  id: string;
  npcId: string;
  filename: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  duration: number | null;
  mediaType: 'audio' | 'video' | 'screenshare';
}

export interface NpcSpawnCommand {
  npc: NpcDefinition;
  tenantSlug: string;
  serverUrl: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

export type NpcCommandAction =
  | 'move'
  | 'stop_movement'
  | 'play_audio'
  | 'play_video'
  | 'play_screenshare'
  | 'stop_media'
  | 'set_dnd'
  | 'set_avatar';

export interface NpcMovePayload {
  x: number;
  y: number;
  speed?: number; // px/s, default 40
}

export interface NpcPlayMediaPayload {
  mediaFileId: string;
  loop?: boolean;
}

export interface NpcSetDndPayload {
  dnd: boolean;
}

export interface NpcSetAvatarPayload {
  avatarId: string;
}

export type NpcRoomCommand =
  | { action: 'move'; payload: NpcMovePayload }
  | { action: 'stop_movement'; payload?: undefined }
  | { action: 'play_audio'; payload: NpcPlayMediaPayload }
  | { action: 'play_video'; payload: NpcPlayMediaPayload }
  | { action: 'play_screenshare'; payload: NpcPlayMediaPayload }
  | { action: 'stop_media'; payload?: undefined }
  | { action: 'set_dnd'; payload: NpcSetDndPayload }
  | { action: 'set_avatar'; payload: NpcSetAvatarPayload };
