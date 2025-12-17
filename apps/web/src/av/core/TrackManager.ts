/**
 * Local Track Manager
 *
 * Manages local audio/video tracks (microphone, camera).
 * Handles:
 * - Track creation with proper audio pipeline
 * - Track publishing/unpublishing
 * - Device switching
 * - Track lifecycle (ended, muted by browser)
 * - Pending state when connection is not ready
 */

import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import type { LocalTrackState, TrackManagerState, Disposable } from './types';
import { AVLogger } from '../AVLogger';
import { publishMicrophone, unpublishMicrophone, ensureAudioPermissions } from './microphonePublishing';
import { publishCamera, unpublishCamera, ensureVideoPermissions } from './cameraPublishing';

export interface TrackManagerDeps {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  onTrackPublished: () => void;
  onAllTracksUnpublished: () => void;
  ensureConnected: () => Promise<void>;
}

const INITIAL_TRACK_STATE: LocalTrackState = {
  desired: false,
  published: false,
  pending: false,
  track: null,
  preferredDeviceId: undefined,
};

export class TrackManager implements Disposable {
  private _state: TrackManagerState = {
    microphone: { ...INITIAL_TRACK_STATE },
    camera: { ...INITIAL_TRACK_STATE },
  };

  private _disposed = false;
  private _audioContextResumeCount = 0;
  private _lastAudioContextResume = 0;
  private _trackEndedCleanups: Map<string, () => void> = new Map();

  // Serialize track operations to avoid state loss on rapid toggles / slow networks
  private _micOp: Promise<void> = Promise.resolve();
  private _camOp: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TrackManagerDeps) {}

  get state(): TrackManagerState {
    return {
      microphone: { ...this._state.microphone },
      camera: { ...this._state.camera },
    };
  }

  get isMicrophoneEnabled(): boolean {
    const room = this.deps.getRoom();
    if (!room) return this._state.microphone.published;

    try {
      const pubs = Array.from((room.localParticipant?.trackPublications?.values() || []) as any);
      const hasMic = pubs.some((pub: any) => {
        const src = pub?.source ?? pub?.track?.source;
        const kind = pub?.kind ?? pub?.track?.kind;
        const track = pub?.track;
        if (!track) return false;
        const mst = track.mediaStreamTrack;
        const readyState = mst?.readyState;
        const isLive = readyState === undefined || readyState === 'live';
        return kind === 'audio' && (src === 'microphone' || src === 0) && isLive;
      });
      return hasMic;
    } catch {
      return this._state.microphone.published;
    }
  }

  get isCameraEnabled(): boolean {
    const room = this.deps.getRoom();
    if (!room) return this._state.camera.published;

    try {
      const pubs = Array.from((room.localParticipant?.trackPublications?.values() || []) as any);
      const hasCam = pubs.some((pub: any) => {
        const src = pub?.source ?? pub?.track?.source;
        const kind = pub?.kind ?? pub?.track?.kind;
        const track = pub?.track;
        if (!track) return false;
        const mst = track.mediaStreamTrack;
        if (kind !== 'video') return false;
        if (src === 'screen_share') return false;
        const isCam = src === 'camera' || src === 1 || src == null;
        const readyState = mst?.readyState;
        const isLive = readyState === undefined || readyState === 'live';
        return isCam && isLive;
      });
      return hasCam;
    } catch {
      return this._state.camera.published;
    }
  }

  get hasPendingTracks(): boolean {
    return this._state.microphone.pending || this._state.camera.pending;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;

    const state = this._state.microphone;
    state.desired = enabled;
    return this.enqueueMic(async () => {
      if (this._disposed) return;
      await this.applyMicrophoneDesired();
    });
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    const state = this._state.microphone;
    state.preferredDeviceId = deviceId;

    if (!state.desired) return;

    await this.enqueueMic(async () => {
      const room = this.deps.getRoom();
      if (room) {
        await unpublishMicrophone({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
      }
      await this.applyMicrophoneDesired();
    });
  }

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;

    const state = this._state.camera;
    state.desired = enabled;

    return this.enqueueCam(async () => {
      if (this._disposed) return;
      await this.applyCameraDesired();
    });
  }

  async useCameraDevice(deviceId: string): Promise<void> {
    const state = this._state.camera;
    state.preferredDeviceId = deviceId;

    if (!state.desired) return;

    await this.enqueueCam(async () => {
      const room = this.deps.getRoom();
      if (room) {
        await unpublishCamera({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
      }
      await this.applyCameraDesired();
    });
  }

  async publishPendingTracks(): Promise<void> {
    if (this._disposed) return;

    if (this._state.microphone.pending && this._state.microphone.desired) {
      AVLogger.info('track.mic.publish_pending');
      await this.setMicrophoneEnabled(true);
    }
    if (this._state.camera.pending && this._state.camera.desired) {
      AVLogger.info('track.cam.publish_pending');
      await this.setCameraEnabled(true);
    }
  }

  /**
   * Save current state and return it for later restoration
   */
  saveState(): { mic: boolean; cam: boolean } {
    return {
      mic: this._state.microphone.desired,
      cam: this._state.camera.desired,
    };
  }

  /**
   * Restore previously saved state
   */
  async restoreState(saved: { mic: boolean; cam: boolean }): Promise<void> {
    if (saved.mic && !this._state.microphone.published) {
      await this.setMicrophoneEnabled(true);
    }
    if (saved.cam && !this._state.camera.published) {
      await this.setCameraEnabled(true);
    }
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Stop all local tracks (e.g., when leaving room)
   */
  async stopAllTracks(): Promise<void> {
    this._state.microphone.desired = false;
    this._state.microphone.pending = false;
    this._state.camera.desired = false;
    this._state.camera.pending = false;

    await Promise.all([
      this.enqueueMic(async () => {
        const room = this.deps.getRoom();
        if (room) await unpublishMicrophone({ room, state: this._state.microphone, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
      }),
      this.enqueueCam(async () => {
        const room = this.deps.getRoom();
        if (room) await unpublishCamera({ room, state: this._state.camera, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
      }),
    ]);

    // Clean up any remaining tracks
    for (const [_id, cleanup] of this._trackEndedCleanups) {
      try {
        cleanup();
      } catch {}
    }
    this._trackEndedCleanups.clear();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // Don't await here, just fire and forget
    this.stopAllTracks().catch(() => {});

    this._state = {
      microphone: { ...INITIAL_TRACK_STATE },
      camera: { ...INITIAL_TRACK_STATE },
    };
  }

  // ============================================================================
  // Private: Microphone
  // ============================================================================

  private enqueueMic(task: () => Promise<void>): Promise<void> {
    this._micOp = this._micOp.catch(() => {}).then(task);
    return this._micOp;
  }

  private enqueueCam(task: () => Promise<void>): Promise<void> {
    this._camOp = this._camOp.catch(() => {}).then(task);
    return this._camOp;
  }

  private async applyMicrophoneDesired(): Promise<void> {
    const state = this._state.microphone;
    const enabled = state.desired;
    const room = this.deps.getRoom();
    const actual = room ? this.isMicrophoneEnabled : state.published;

    if (actual === enabled && !state.pending) {
      state.published = actual;
      AVLogger.debug('track.mic.already_in_state', { enabled });
      return;
    }

    AVLogger.debug('track.mic.set', { enabled, currentlyPublished: state.published });

    if (enabled) {
      await this.tryUnlockAudio();
    }

    if (!room) {
      state.pending = enabled;
      if (enabled) {
        AVLogger.info('track.mic.pending', { reason: 'no_room' });
        await ensureAudioPermissions();
        try {
          await this.deps.ensureConnected();
        } catch {}
      }
      return;
    }

    // If signaling is stale/closed, reconnect first; publishing into a dead signal is unreliable.
    if (enabled && !this.deps.isSignalOpen()) {
      state.pending = true;
      AVLogger.info('track.mic.pending', { reason: 'signal_closed' });
      try {
        await this.deps.ensureConnected();
      } catch {}
      return;
    }

    state.pending = false;

    if (enabled) {
      await publishMicrophone({
        room,
        state,
        watchTrackEnded: (track, onEnded) => this.watchTrackEnded(track, 'microphone', onEnded),
        onTrackPublished: () => this.deps.onTrackPublished(),
        onTrackEndedByBrowser: () => {
          AVLogger.warn('track.mic.ended_by_browser');
          state.published = false;
          state.track = null;
          if (state.desired) {
            setTimeout(() => this.setMicrophoneEnabled(true).catch(() => {}), 200);
          }
        },
      });
    } else {
      await unpublishMicrophone({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
    }
  }

  // ============================================================================
  // Private: Camera
  // ============================================================================

  private async applyCameraDesired(): Promise<void> {
    const state = this._state.camera;
    const enabled = state.desired;
    const room = this.deps.getRoom();
    const actual = room ? this.isCameraEnabled : state.published;

    if (actual === enabled && !state.pending) {
      state.published = actual;
      AVLogger.debug('track.cam.already_in_state', { enabled });
      return;
    }

    AVLogger.debug('track.cam.set', { enabled, currentlyPublished: state.published });

    if (!room) {
      state.pending = enabled;
      if (enabled) {
        AVLogger.info('track.cam.pending', { reason: 'no_room' });
        await ensureVideoPermissions();
        try {
          await this.deps.ensureConnected();
        } catch {}
      }
      return;
    }

    if (enabled && !this.deps.isSignalOpen()) {
      state.pending = true;
      AVLogger.info('track.cam.pending', { reason: 'signal_closed' });
      try {
        await this.deps.ensureConnected();
      } catch {}
      return;
    }

    state.pending = false;

    if (enabled) {
      await publishCamera({
        room,
        state,
        watchTrackEnded: (track, onEnded) => this.watchTrackEnded(track, 'camera', onEnded),
        onTrackPublished: () => this.deps.onTrackPublished(),
        onTrackEndedByBrowser: () => {
          AVLogger.warn('track.cam.ended_by_browser');
          state.published = false;
          state.track = null;
          if (state.desired) {
            setTimeout(() => this.setCameraEnabled(true).catch(() => {}), 200);
          }
        },
      });
    } else {
      await unpublishCamera({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
    }
  }

  // ============================================================================
  // Private: Helpers
  // ============================================================================

  private checkAllTracksUnpublished(): void {
    if (!this._state.microphone.published && !this._state.camera.published) {
      this.deps.onAllTracksUnpublished();
    }
  }

  private watchTrackEnded(
    track: LocalAudioTrack | LocalVideoTrack,
    _source: 'microphone' | 'camera',
    onEnded: () => void
  ): void {
    const mst = (track as any).mediaStreamTrack;
    if (!mst) return;

    const handler = () => {
      onEnded();
      this._trackEndedCleanups.delete(mst.id);
    };

    mst.addEventListener('ended', handler, { once: true });
    this._trackEndedCleanups.set(mst.id, () => {
      mst.removeEventListener('ended', handler);
    });
  }

  private async tryUnlockAudio(): Promise<void> {
    const room = this.deps.getRoom();
    if (!room) return;

    const now = Date.now();

    // Throttle AudioContext.resume() calls
    // Safari has issues with too many resume() calls
    if (now - this._lastAudioContextResume < 1000) {
      return;
    }

    this._audioContextResumeCount++;
    this._lastAudioContextResume = now;

    try {
      const roomAny = room as any;

      // Try LiveKit's startAudio
      if (typeof roomAny.startAudio === 'function') {
        await roomAny.startAudio();
      }

      // Also try to resume AudioContext directly
      const ctx = roomAny.engine?.client?.audioContext ?? roomAny.engine?.audioContext;
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }

      AVLogger.debug('audio.unlock.success', {
        resumeCount: this._audioContextResumeCount,
      });

    } catch (error) {
      // NotAllowedError is expected if no user gesture
      if ((error as any)?.name !== 'NotAllowedError') {
        AVLogger.warn('audio.unlock.error', { error: String(error) });
      }
    }
  }
}
