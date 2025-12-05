import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';

// ============================================================================
// Connection States
// ============================================================================

export type AVConnectionState =
  | 'idle'         // Initial, no room
  | 'connecting'   // Connection in progress
  | 'connected'    // Room connected, no local tracks
  | 'active'       // Connected with at least one local track
  | 'reconnecting' // Connection lost, retry in progress
  | 'error'        // Permanent error
  | 'closed';      // Intentionally disconnected

export type AVConnectionEvent =
  | { type: 'CONNECT'; roomName: string }
  | { type: 'CONNECTED'; room: Room }
  | { type: 'TRACK_PUBLISHED' }
  | { type: 'ALL_TRACKS_UNPUBLISHED' }
  | { type: 'SIGNAL_LOST' }
  | { type: 'RETRY' }
  | { type: 'MAX_RETRIES' }
  | { type: 'DISCONNECT' }
  | { type: 'RESET' }
  | { type: 'ERROR'; error: Error };

// ============================================================================
// Track States
// ============================================================================

export type TrackKind = 'audio' | 'video';
export type TrackSource = 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio';

export interface LocalTrackState {
  /** User's desired state (what they want) */
  desired: boolean;
  /** Actual published state */
  published: boolean;
  /** Track is pending (waiting for connection) */
  pending: boolean;
  /** The actual track instance */
  track: LocalAudioTrack | LocalVideoTrack | null;
  /** Preferred device ID */
  preferredDeviceId: string | undefined;
}

export interface TrackManagerState {
  microphone: LocalTrackState;
  camera: LocalTrackState;
}

// ============================================================================
// Subscription States
// ============================================================================

export interface SubscriptionState {
  identity: string;
  audio: boolean;
  video: boolean;
}

export interface SubscriptionManagerState {
  subscriptions: Map<string, SubscriptionState>;
  desiredParticipants: string[];
  activeSpeakers: string[];
}

// ============================================================================
// DND State
// ============================================================================

export interface DNDState {
  enabled: boolean;
  /** Mic state before DND was enabled */
  micBeforeDND: boolean;
  /** Cam state before DND was enabled */
  camBeforeDND: boolean;
}

// ============================================================================
// Signal Monitor
// ============================================================================

export interface SignalHealth {
  isOpen: boolean;
  lastPingAt: number;
  lastPongAt: number;
  missedPings: number;
  latencyMs: number | null;
}

// ============================================================================
// AVManager Configuration
// ============================================================================

export interface AVManagerConfig {
  baseUrl: string;
  identity: string;
  displayName: string;
  useVideo: boolean;

  // Timeouts
  connectionTimeoutMs?: number;
  signalPingIntervalMs?: number;
  signalPingTimeoutMs?: number;

  // Reconnect
  maxReconnectAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;

  // Subscriptions
  maxVideoSubscriptions?: number;
  bubbleAttenuationDb?: number;
  videoRetentionMs?: number;
}

export const DEFAULT_CONFIG: Required<Omit<AVManagerConfig, 'baseUrl' | 'identity' | 'displayName' | 'useVideo'>> = {
  connectionTimeoutMs: 10000,
  signalPingIntervalMs: 5000,
  signalPingTimeoutMs: 3000,
  maxReconnectAttempts: 10,
  reconnectBaseDelayMs: 1000,
  reconnectMaxDelayMs: 30000,
  maxVideoSubscriptions: 6,
  bubbleAttenuationDb: -12,
  videoRetentionMs: 8000,
};

// ============================================================================
// Devices
// ============================================================================

export interface AVDevice {
  deviceId: string;
  label: string;
}

export interface AVDevices {
  microphones: AVDevice[];
  cameras: AVDevice[];
}

// ============================================================================
// Events
// ============================================================================

export type AVEventType =
  | 'state:changed'
  | 'track:local:published'
  | 'track:local:unpublished'
  | 'track:remote:subscribed'
  | 'track:remote:unsubscribed'
  | 'participant:connected'
  | 'participant:disconnected'
  | 'speakers:changed'
  | 'dnd:changed'
  | 'signal:health'
  | 'error';

export interface AVEvent<T = unknown> {
  type: AVEventType;
  timestamp: number;
  data: T;
}

export type AVEventHandler<T = unknown> = (event: AVEvent<T>) => void;

// ============================================================================
// Utility Types
// ============================================================================

export type Unsubscribe = () => void;

export interface Disposable {
  dispose(): void;
}
