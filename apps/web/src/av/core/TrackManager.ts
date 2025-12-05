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
import { useAvSettingsStore } from '../../state/avSettings';

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

  // Locks to prevent concurrent track operations
  private _micLock = false;
  private _camLock = false;

  constructor(private readonly deps: TrackManagerDeps) {}

  // ============================================================================
  // Public Getters
  // ============================================================================

  get state(): TrackManagerState {
    return {
      microphone: { ...this._state.microphone },
      camera: { ...this._state.camera },
    };
  }

  get isMicrophoneEnabled(): boolean {
    // Check both internal state AND actual room state to avoid desync
    if (!this._state.microphone.published) return false;

    // Verify track is actually live in the room
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
        return (kind === 'audio' || src === 'microphone' || src === 0) && mst?.readyState === 'live';
      });
      return hasMic;
    } catch {
      return this._state.microphone.published;
    }
  }

  get isCameraEnabled(): boolean {
    // Check both internal state AND actual room state to avoid desync
    if (!this._state.camera.published) return false;

    // Verify track is actually live in the room
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
        const isCam = src === 'camera' || src === 1 || (kind === 'video' && src !== 'screen_share');
        return isCam && mst?.readyState === 'live';
      });
      return hasCam;
    } catch {
      return this._state.camera.published;
    }
  }

  get hasPendingTracks(): boolean {
    return this._state.microphone.pending || this._state.camera.pending;
  }

  // ============================================================================
  // Microphone
  // ============================================================================

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;

    // Prevent concurrent operations on mic
    if (this._micLock) {
      AVLogger.debug('track.mic.locked', { enabled });
      return;
    }

    const state = this._state.microphone;

    // Skip if already in desired state
    if (state.published === enabled && !state.pending) {
      AVLogger.debug('track.mic.already_in_state', { enabled });
      return;
    }

    this._micLock = true;
    state.desired = enabled;

    try {
      AVLogger.debug('track.mic.set', { enabled, currentlyPublished: state.published });

      // Handle AudioContext unlock with throttling
      if (enabled) {
        await this.tryUnlockAudio();
      }

      const room = this.deps.getRoom();

      // If no room, mark as pending and try to connect
      if (!room) {
        state.pending = enabled;
        if (enabled) {
          AVLogger.info('track.mic.pending', { reason: 'no_room' });
          await this.ensureAudioPermissions();
          try {
            await this.deps.ensureConnected();
          } catch {
            // Will retry when connection is established
          }
        }
        return;
      }

      // If room exists, proceed even if signal check is uncertain
      // The publish operation will fail safely if connection is truly broken
      state.pending = false;

      if (enabled) {
        await this.publishMicrophone(room);
      } else {
        await this.unpublishMicrophone(room);
      }
    } finally {
      this._micLock = false;
    }
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    this._state.microphone.preferredDeviceId = deviceId;

    // If currently published, republish with new device
    if (this._state.microphone.published) {
      const room = this.deps.getRoom();
      if (room) {
        await this.unpublishMicrophone(room);
        await this.publishMicrophone(room);
      }
    }
  }

  // ============================================================================
  // Camera
  // ============================================================================

  async setCameraEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;

    // Prevent concurrent operations on cam
    if (this._camLock) {
      AVLogger.debug('track.cam.locked', { enabled });
      return;
    }

    const state = this._state.camera;

    // Skip if already in desired state
    if (state.published === enabled && !state.pending) {
      AVLogger.debug('track.cam.already_in_state', { enabled });
      return;
    }

    this._camLock = true;
    state.desired = enabled;

    try {
      AVLogger.debug('track.cam.set', { enabled, currentlyPublished: state.published });

      const room = this.deps.getRoom();

      // If no room, mark as pending and try to connect
      if (!room) {
        state.pending = enabled;
        if (enabled) {
          AVLogger.info('track.cam.pending', { reason: 'no_room' });
          await this.ensureVideoPermissions();
          try {
            await this.deps.ensureConnected();
          } catch {
            // Will retry when connection is established
          }
        }
        return;
      }

      // If room exists, proceed even if signal check is uncertain
      // The publish operation will fail safely if connection is truly broken
      state.pending = false;

      if (enabled) {
        await this.publishCamera(room);
      } else {
        await this.unpublishCamera(room);
      }
    } finally {
      this._camLock = false;
    }
  }

  async useCameraDevice(deviceId: string): Promise<void> {
    this._state.camera.preferredDeviceId = deviceId;

    // If currently published, republish with new device
    if (this._state.camera.published) {
      const room = this.deps.getRoom();
      if (room) {
        await this.unpublishCamera(room);
        await this.publishCamera(room);
      }
    }
  }

  // ============================================================================
  // Pending Tracks
  // ============================================================================

  /**
   * Called when connection is established to publish any pending tracks
   */
  async publishPendingTracks(): Promise<void> {
    if (this._disposed) return;

    const room = this.deps.getRoom();
    if (!room) return;

    if (this._state.microphone.pending && this._state.microphone.desired) {
      AVLogger.info('track.mic.publish_pending');
      this._state.microphone.pending = false;
      await this.publishMicrophone(room);
    }

    if (this._state.camera.pending && this._state.camera.desired) {
      AVLogger.info('track.cam.publish_pending');
      this._state.camera.pending = false;
      await this.publishCamera(room);
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
    const room = this.deps.getRoom();

    if (room) {
      await this.unpublishMicrophone(room);
      await this.unpublishCamera(room);
    }

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

  private async publishMicrophone(room: Room): Promise<void> {
    const state = this._state.microphone;

    // Check if already published with a live track
    if (state.published && state.track) {
      const mst = (state.track as any).mediaStreamTrack;
      if (mst?.readyState === 'live') {
        AVLogger.debug('track.mic.already_published');
        return;
      }
      // Track exists but is not live, unpublish first
      await this.unpublishMicrophone(room);
    }

    try {
      const settings = useAvSettingsStore.getState().settings;
      const { buildAudioPipeline } = await import('../audio/buildAudioPipeline');

      const track = await buildAudioPipeline({
        deviceId: state.preferredDeviceId,
        settings,
      } as any);

      // Set content hint for speech
      try {
        const mst = (track as any).mediaStreamTrack;
        if (mst && 'contentHint' in mst) {
          mst.contentHint = 'speech';
        }
      } catch {}

      await room.localParticipant.publishTrack(track, { source: 'microphone' } as any);

      state.track = track as LocalAudioTrack;
      state.published = true;

      // Watch for track ended (browser can stop tracks)
      this.watchTrackEnded(track as LocalAudioTrack, 'microphone', async () => {
        AVLogger.warn('track.mic.ended_by_browser');
        state.published = false;
        state.track = null;
        if (state.desired) {
          // Re-publish after a short delay
          setTimeout(() => this.setMicrophoneEnabled(true).catch(() => {}), 200);
        }
      });

      AVLogger.info('track.mic.published', {
        deviceId: state.preferredDeviceId,
      });

      this.deps.onTrackPublished();

    } catch (error) {
      AVLogger.error('track.mic.publish_failed', { error: String(error) });

      // Try to recover with permissions
      const hasPermission = await this.ensureAudioPermissions();
      if (hasPermission) {
        // Retry once
        try {
          const { createLocalAudioTrack } = await import('livekit-client');
          const audioOpts: any = {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          };
          if (state.preferredDeviceId) {
            audioOpts.deviceId = state.preferredDeviceId;
          }
          const fallbackTrack = await createLocalAudioTrack(audioOpts);

          await room.localParticipant.publishTrack(fallbackTrack as any, { source: 'microphone' } as any);
          state.track = fallbackTrack;
          state.published = true;

          AVLogger.info('track.mic.published_fallback');
          this.deps.onTrackPublished();

        } catch (retryError) {
          AVLogger.error('track.mic.publish_retry_failed', { error: String(retryError) });
          throw retryError;
        }
      } else {
        throw error;
      }
    }
  }

  private async unpublishMicrophone(room: Room): Promise<void> {
    const state = this._state.microphone;

    if (!state.track) {
      state.published = false;
      return;
    }

    try {
      // Disable track immediately for snappy UI
      try {
        const t = state.track as any;
        if (typeof t.setEnabled === 'function') {
          t.setEnabled(false);
        } else if (t.mediaStreamTrack) {
          t.mediaStreamTrack.enabled = false;
        }
      } catch {}

      await room.localParticipant.unpublishTrack(state.track as any);
      state.track.stop();

    } catch (error) {
      AVLogger.warn('track.mic.unpublish_error', { error: String(error) });
    }

    state.track = null;
    state.published = false;

    AVLogger.info('track.mic.unpublished');

    this.checkAllTracksUnpublished();
  }

  // ============================================================================
  // Private: Camera
  // ============================================================================

  private async publishCamera(room: Room): Promise<void> {
    const state = this._state.camera;

    // Check if already published with a live track
    if (state.published && state.track) {
      const mst = (state.track as any).mediaStreamTrack;
      if (mst?.readyState === 'live') {
        AVLogger.debug('track.cam.already_published');
        return;
      }
      await this.unpublishCamera(room);
    }

    try {
      const { createLocalTracks } = await import('livekit-client');

      const constraints: any = {
        video: state.preferredDeviceId
          ? { deviceId: state.preferredDeviceId, facingMode: 'user' }
          : { facingMode: 'user' },
      };

      const tracks = await createLocalTracks(constraints);
      const videoTrack = tracks.find((t: any) => t.kind === 'video') as LocalVideoTrack | undefined;

      if (!videoTrack) {
        throw new Error('No video track created');
      }

      await room.localParticipant.publishTrack(videoTrack);

      state.track = videoTrack;
      state.published = true;

      // Watch for track ended
      this.watchTrackEnded(videoTrack, 'camera', async () => {
        AVLogger.warn('track.cam.ended_by_browser');
        state.published = false;
        state.track = null;
        if (state.desired) {
          setTimeout(() => this.setCameraEnabled(true).catch(() => {}), 200);
        }
      });

      AVLogger.info('track.cam.published', {
        deviceId: state.preferredDeviceId,
      });

      this.deps.onTrackPublished();

    } catch (error) {
      AVLogger.error('track.cam.publish_failed', { error: String(error) });
      throw error;
    }
  }

  private async unpublishCamera(room: Room): Promise<void> {
    const state = this._state.camera;

    if (!state.track) {
      state.published = false;
      return;
    }

    try {
      // Disable track immediately for snappy UI
      try {
        const t = state.track as any;
        if (typeof t.setEnabled === 'function') {
          t.setEnabled(false);
        } else if (t.mediaStreamTrack) {
          t.mediaStreamTrack.enabled = false;
        }
      } catch {}

      await room.localParticipant.unpublishTrack(state.track as any);
      state.track.stop();

    } catch (error) {
      AVLogger.warn('track.cam.unpublish_error', { error: String(error) });
    }

    state.track = null;
    state.published = false;

    AVLogger.info('track.cam.unpublished');

    this.checkAllTracksUnpublished();
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

  private async ensureAudioPermissions(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  }

  private async ensureVideoPermissions(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return true;
    } catch {
      return false;
    }
  }
}
