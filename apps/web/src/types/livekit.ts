import { 
  Room, 
  RemoteParticipant, 
  LocalParticipant, 
  Participant,
  Track,
  RemoteTrack,
  LocalTrack,
  RemoteTrackPublication,
  LocalTrackPublication,
  TrackPublication,
  VideoTrack,
  AudioTrack,
  TrackEvent,
  RoomEvent,
  ParticipantEvent,
  ConnectionState
} from 'livekit-client';

// Re-export commonly used types
export {
  Room as LiveKitRoom,
  RemoteParticipant,
  LocalParticipant,
  Participant as LiveKitParticipant,
  Track as LiveKitTrack,
  RemoteTrack,
  LocalTrack,
  RemoteTrackPublication,
  LocalTrackPublication,
  TrackPublication as LiveKitTrackPublication,
  VideoTrack as LiveKitVideoTrack,
  AudioTrack as LiveKitAudioTrack,
  TrackEvent,
  RoomEvent,
  ParticipantEvent,
  ConnectionState
};

// Custom UI participant type
export interface UIParticipant {
  sid: string;
  identity: string;
  hasVideo: boolean;
  hasMic: boolean;
  isSpeaking: boolean;
  media: 'camera' | 'screen';
  volume?: number;
}

// Track subscription handlers
export type TrackSubscribedHandler = (
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) => void;

export type TrackUnsubscribedHandler = (
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) => void;

export type TrackPublishedHandler = (
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
) => void;

export type LocalTrackPublishedHandler = (
  publication: LocalTrackPublication,
  participant: LocalParticipant
) => void;

// Helper function to check track types
export function isVideoPublication(pub: TrackPublication): boolean {
  return pub.kind === 'video' && pub.trackName !== 'screen';
}

export function isMicPublication(pub: TrackPublication): boolean {
  return pub.kind === 'audio' && pub.source === 'microphone';
}

export function isScreenPublication(pub: TrackPublication): boolean {
  return pub.kind === 'video' && pub.source === 'screen_share';
}

// Type guard for checking if participant has tracks
export function hasTrackPublications(participant: any): participant is any & {
  trackPublications: Map<string, TrackPublication>;
} {
  return participant.trackPublications !== undefined && participant.trackPublications.size > 0;
}