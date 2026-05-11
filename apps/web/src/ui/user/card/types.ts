import type { Room, RemoteParticipant, LocalParticipant, Participant } from 'livekit-client';

export type PartType = {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
  dnd?: boolean;
  avatarId?: string;
};

// Legacy room shape: older code paths still use `participants` instead of `remoteParticipants`.
export interface LegacyRoom extends Room {
  participants?: Map<string, RemoteParticipant>;
}

export type AnyParticipant = (Participant | RemoteParticipant | LocalParticipant) & { name?: string };
