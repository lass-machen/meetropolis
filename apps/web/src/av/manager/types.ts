/**
 * Shared types for AVManager modules
 */

import type { Room } from 'livekit-client';
import type { AVConnectionState } from '../core/types';

/**
 * Dependencies injected into managers
 */
export interface AVManagerDependencies {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  isDND?: () => boolean;
  ensureConnected?: () => Promise<void>;
  waitForConnected?: (timeoutMs: number) => Promise<boolean>;
}

/**
 * State machine interface for managers
 */
export interface AVStateMachineInterface {
  room: Room | null;
  state: AVConnectionState;
  isConnected: boolean;
  pageLeaving: boolean;
  setRoom(room: Room | null, roomName: string | null): void;
  dispatch(event: any): void;
  resetReconnect(): void;
  scheduleReconnect(fn: () => Promise<void>): void;
  subscribe(handler: any): () => void;
  dispose(): void;
}

/**
 * Track manager interface for managers
 */
export interface TrackManagerInterface {
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  useMicrophoneDevice(deviceId: string): Promise<void>;
  useCameraDevice(deviceId: string): Promise<void>;
  saveState(): any;
  publishPendingTracks(): Promise<void>;
  stopAllTracks(): Promise<void>;
  dispose(): void;
}

/**
 * Subscription manager interface for managers
 */
export interface SubscriptionManagerInterface {
  start(): void;
  stop(): void;
  forceApply(): void;
  ensureAudioSubscriptions(maxDistance: number): void;
  setActiveSpeakers(speakers: any[]): void;
  setParticipantVolume(identity: string, volume: number): void;
  muteAllRemote(): void;
  restoreAllRemote(): void;
  dispose(): void;
}

/**
 * DND interface for managers
 */
export interface DoNotDisturbInterface {
  enabled: boolean;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): void;
}

/**
 * Screenshare interface for managers
 */
export interface ScreenshareInterface {
  readonly isSharing: boolean;
  readonly desiredSharing: boolean;
  start(): Promise<boolean>;
  stop(options?: { preserveDesired?: boolean }): Promise<void>;
  dispose(): void;
}
