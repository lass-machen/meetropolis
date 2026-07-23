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
  TrackEvent,
  RoomEvent,
  ParticipantEvent,
  ConnectionState,
} from 'livekit-client';

// Re-export commonly used types.
// Note: livekit-client >= 2.x replaced the generic AudioTrack / VideoTrack
// classes with the explicit Remote/Local-Audio/VideoTrack variants. The
// generic aliases were re-exported here historically but never consumed
// downstream (verified via repo-wide grep) and are therefore omitted.
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
  TrackEvent,
  RoomEvent,
  ParticipantEvent,
  ConnectionState,
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
  participant: RemoteParticipant,
) => void;

export type TrackUnsubscribedHandler = (
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant,
) => void;

export type TrackPublishedHandler = (publication: RemoteTrackPublication, participant: RemoteParticipant) => void;

export type LocalTrackPublishedHandler = (publication: LocalTrackPublication, participant: LocalParticipant) => void;

// Helper function to check track types
export function isVideoPublication(pub: TrackPublication): boolean {
  return pub.kind === Track.Kind.Video && pub.trackName !== 'screen';
}

export function isMicPublication(pub: TrackPublication): boolean {
  return pub.kind === Track.Kind.Audio && pub.source === Track.Source.Microphone;
}

export function isScreenPublication(pub: TrackPublication): boolean {
  return pub.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare;
}

// Type guard for checking if participant has tracks
export function hasTrackPublications(participant: unknown): participant is {
  trackPublications: Map<string, TrackPublication>;
} {
  if (!participant || typeof participant !== 'object') return false;
  const p = participant as { trackPublications?: Map<string, TrackPublication> };
  return p.trackPublications !== undefined && p.trackPublications.size > 0;
}

/**
 * Narrowed view of a LiveKit Track that exposes runtime properties not always
 * present in the static type definitions (depending on track subclass).
 * Used at library boundaries where LiveKit may or may not expose helpers.
 */
export type TrackLike = Track & {
  mediaStreamTrack?: MediaStreamTrack;
  attach?: (element?: HTMLMediaElement) => HTMLMediaElement;
  detach?: (element?: HTMLMediaElement) => HTMLMediaElement | HTMLMediaElement[];
  stop?: () => void;
  setVolume?: (volume: number) => void;
  setEnabled?: (enabled: boolean) => void;
  isEnabled?: boolean;
  enabled?: boolean;
  mute?: () => Promise<unknown>;
  unmute?: () => Promise<unknown>;
  replaceTrack?: (mst: MediaStreamTrack) => Promise<unknown>;
  source?: Track.Source | string;
  kind?: Track.Kind | string;
  sid?: string;
  /**
   * LiveKit-internal flag (not in the public `.d.ts` for livekit-client
   * 2.18.9) that controls whether `mute()` also stops the underlying
   * MediaStreamTrack. Only honored by the SDK for tracks where
   * `isUserProvided` is false. Set via the per-publish `stopMicTrackOnMute`
   * option; mirrored here for live updates without renegotiation.
   */
  stopOnMute?: boolean;
  /**
   * Teardown handle for tracks whose underlying capture MediaStreamTrack is
   * not directly reachable via `mediaStreamTrack` (e.g. the voice-isolation
   * WebAudio pipeline, where the published track is a destination track and
   * the real microphone MediaStreamTrack lives inside an AudioContext
   * graph). When present, closes that source and releases the hardware
   * device. Idempotent. See `audio/voiceIsolation.ts`.
   */
  __avStopSource?: () => void;
};

/**
 * Narrowed view of TrackPublication exposing optional / library-private
 * properties that are not consistently typed across SDK versions.
 */
export type TrackPublicationLike = TrackPublication & {
  track?: TrackLike | null;
  source?: Track.Source | string;
  kind?: Track.Kind | string;
  isSubscribed?: boolean;
  subscribed?: boolean;
  muted?: boolean;
  isMuted?: boolean;
  setSubscribed?: (subscribed: boolean) => void;
  setVideoQuality?: (quality: unknown) => void;
  setPreferredVideoQuality?: (quality: unknown) => void;
};

/**
 * Read the source of a publication or its track, returning undefined when
 * neither is set. Tolerates malformed inputs.
 */
export function readPubSource(pub: unknown): Track.Source | string | undefined {
  if (!pub || typeof pub !== 'object') return undefined;
  const p = pub as TrackPublicationLike;
  return p.source ?? p.track?.source;
}

/**
 * Read the kind ('audio' / 'video') of a publication or its track.
 */
export function readPubKind(pub: unknown): Track.Kind | string | undefined {
  if (!pub || typeof pub !== 'object') return undefined;
  const p = pub as TrackPublicationLike;
  return p.kind ?? p.track?.kind;
}

/**
 * Loose participant shape used when iterating room participants generically
 * (without distinguishing local vs remote at the call site).
 */
export interface ParticipantLike {
  sid: string;
  identity: string;
  name?: string;
  isLocal?: boolean;
  trackPublications?: Map<string, TrackPublication>;
}

/**
 * Snapshot all track publications of a participant as an array, returning an
 * empty array if the map is missing/empty.
 */
export function listPublications(participant: unknown): TrackPublicationLike[] {
  if (!participant || typeof participant !== 'object') return [];
  const p = participant as { trackPublications?: { values?: () => Iterable<TrackPublicationLike> } };
  const values = p.trackPublications?.values?.();
  if (!values) return [];
  try {
    return Array.from(values);
  } catch {
    return [];
  }
}
