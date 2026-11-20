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

import type { LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import type { TrackManagerState, Disposable } from './types';
import { AVLogger } from '../AVLogger';
import { unpublishMicrophone } from './microphonePublishing';
import { unpublishCamera } from './cameraPublishing';
import type { TrackLike } from '../../types/livekit';
import { INITIAL_TRACK_STATE, MIC_DEVICE_NUDGE_MIN_MS, type TrackManagerDeps } from './trackManagerConstants';
import { enqueueTrackOp } from './trackOpQueue';
import { queryLocalCameraEnabled, queryLocalMicrophoneEnabled } from './trackPublicationQuery';
import {
  dropPreferredMicIfGone as dropPreferredMicIfGoneHelper,
  tryUnlockAudio as tryUnlockAudioHelper,
  watchTrackEnded as watchTrackEndedHelper,
  type AudioUnlockThrottle,
} from './trackRecovery';
import {
  cancelMicHardwareRelease as cancelMicHardwareReleaseHelper,
  resetMicEndedBreaker as resetMicEndedBreakerHelper,
  scheduleMicHardwareRelease as scheduleMicHardwareReleaseHelper,
  type MicReleaseTimerSlot,
  type MicRepublishTimerSlot,
} from './trackMicTimers';
import { handleMicEndedByBrowser as handleMicEndedByBrowserHelper } from './trackMicEndedRecovery';
import { applyCameraDesired as applyCameraDesiredHelper } from './trackCameraApply';
import {
  disableMicrophoneTrack,
  enableMicrophoneTrack,
  pendingMicrophoneSignalClosed,
  pendingMicrophoneWithoutRoom,
  syncMicrophoneAlreadyInState,
  type MicApplyShared,
} from './trackMicrophoneApply';

export type { TrackManagerDeps } from './trackManagerConstants';

export class TrackManager implements Disposable {
  private _state: TrackManagerState = {
    microphone: { ...INITIAL_TRACK_STATE },
    camera: { ...INITIAL_TRACK_STATE },
  };

  private _disposed = false;
  private _audioUnlock: AudioUnlockThrottle = { lastResumeAt: 0, resumeCount: 0 };
  private _trackEndedCleanups: Map<string, () => void> = new Map();

  // Circuit-breaker state for the "mic ended by browser" auto-republish.
  private _micEndedAttempts = 0;
  private _micLastPublishAt = 0;
  private _lastDeviceNudgeAt = 0;
  private _micRepublish: MicRepublishTimerSlot = { timer: null };
  // Grace timer for the hybrid mute's delayed hardware release (stopMicOnMute).
  private _micRelease: MicReleaseTimerSlot = { timer: null };
  // True only while a real (re)publish is in flight — the getUserMedia + SDP
  // window where intent already flipped on but the track is not live yet. Lets
  // the UI hold the button at the intent (and show a "connecting" hint for the
  // mic) instead of flickering off, precisely and without a time heuristic.
  private _micPublishing = false;
  private _camPublishing = false;

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
      return queryLocalMicrophoneEnabled(room);
    } catch {
      return this._state.microphone.published;
    }
  }

  get isCameraEnabled(): boolean {
    const room = this.deps.getRoom();
    if (!room) return this._state.camera.published;
    try {
      return queryLocalCameraEnabled(room);
    } catch {
      return this._state.camera.published;
    }
  }

  get hasPendingTracks(): boolean {
    return this._state.microphone.pending || this._state.camera.pending;
  }

  // In flight = a real publish is running (not a soft-unmute, which is instant).
  get isMicrophonePublishing(): boolean {
    return this._micPublishing;
  }

  get isCameraPublishing(): boolean {
    return this._camPublishing;
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this._disposed) return;

    const state = this._state.microphone;
    state.desired = enabled;
    // A deliberate enable gives the ended-recovery breaker a fresh start (the
    // auto-republish path deliberately does NOT reset it, so a flapping device
    // still trips the breaker). It also cancels a pending hardware release so an
    // unmute within the grace window keeps the capture alive for an instant
    // soft-unmute instead of racing a teardown.
    if (enabled) {
      this.resetMicEndedBreaker();
      this.cancelMicHardwareRelease();
    }
    return this.enqueueMic(async () => {
      if (this._disposed) return;
      await this.applyMicrophoneDesired();
    });
  }

  /**
   * A media input/output device was added or removed. Give a wanted-but-not-live
   * microphone one rate-limited recovery attempt — a freshly plugged-in device is
   * a legitimate reason to retry even after the ended-breaker opened. Does NOT
   * reset the breaker (a flapping device can spam `devicechange`); a track that
   * dies again immediately keeps the circuit closed via handleMicEndedByBrowser.
   */
  notifyDeviceChange(): void {
    if (this._disposed) return;
    const state = this._state.microphone;
    if (!state.desired) return;

    const now = Date.now();
    if (now - this._lastDeviceNudgeAt < MIC_DEVICE_NUDGE_MIN_MS) return;

    const mst = (state.track as TrackLike | null)?.mediaStreamTrack;
    const live = !!state.track && (!mst || mst.readyState === 'live');
    if (live) return; // a live mic is left alone; explicit selection handles switches

    this._lastDeviceNudgeAt = now;
    AVLogger.info('track.mic.device_change_nudge');
    void this.enqueueMic(async () => {
      if (this._disposed || !this._state.microphone.desired || this._state.microphone.published) return;
      await this.dropPreferredMicIfGone();
      await this.applyMicrophoneDesired();
    }).catch(() => {});
  }

  /**
   * Tear down and rebuild the published microphone track using the current
   * avSettings (capture constraints changed while the mic is live).
   * No-op when the mic is not desired, not currently audible (muted/absent),
   * or the signal is not open — in those cases there is nothing to
   * republish, and applyMicrophoneDesired()/reconnect handles it later.
   */
  async republishMicrophone(): Promise<void> {
    if (this._disposed) return;
    return this.enqueueMic(async () => {
      if (this._disposed) return;
      const state = this._state.microphone;
      const room = this.deps.getRoom();
      if (!room) return;
      if (!state.desired) return;
      if (!this.isMicrophoneEnabled) return;
      if (!this.deps.isSignalOpen()) return;

      AVLogger.info('track.mic.republish');
      await unpublishMicrophone({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
      await this.applyMicrophoneDesired();
    });
  }

  /**
   * Mirror the stopMicOnMute preference onto the currently published track,
   * without a republish/renegotiation. Only affects SDK-managed tracks
   * (`stopOnMute` is ignored by LiveKit for user-provided tracks, e.g. the
   * voice-isolation pipeline); the hard-close mute branch in
   * applyMicrophoneDesired() is what actually enforces the setting there.
   */
  applyStopMicOnMute(enabled: boolean): void {
    const state = this._state.microphone;
    const t = state.track as TrackLike | null;
    // The SDK must never auto-stop the capture on mute() — the hybrid soft-mute
    // owns that lifecycle. Pin the runtime flag to false regardless of the
    // setting; `enabled` only drives our own delayed-release policy below.
    if (t) {
      try {
        t.stopOnMute = false;
      } catch {}
    }

    // Live-toggling the setting while already soft-muted: honour it immediately
    // instead of waiting for the next mute. A live track means "still muted but
    // present" only when the mic is not desired.
    const mst = t?.mediaStreamTrack;
    const trackIsLive = !!t && (!mst || mst.readyState === 'live');
    if (!state.desired && trackIsLive) {
      // Guard against restarting the countdown: subscribeToAvSettings calls this
      // on every store change, so an unrelated setting toggled while muted must
      // not reset a release that is already pending.
      if (enabled) {
        if (!this._micRelease.timer) this.scheduleMicHardwareRelease();
      } else {
        this.cancelMicHardwareRelease();
      }
    }
  }

  async useMicrophoneDevice(deviceId: string): Promise<void> {
    const state = this._state.microphone;
    state.preferredDeviceId = deviceId;

    if (!state.desired) return;

    await this.enqueueMic(async () => {
      const room = this.deps.getRoom();
      if (!room) return;

      // Prefer switchActiveDevice: it replaces the underlying track
      // seamlessly without changing the track SID, so remote clients keep audio.
      try {
        await room.switchActiveDevice('audioinput', deviceId);
        AVLogger.info('track.mic.switch_device_seamless', { deviceId });
        return;
      } catch (err) {
        AVLogger.warn('track.mic.switch_device_fallback', { deviceId, error: String(err) });
      }

      // Fallback: unpublish + republish (causes brief audio interruption)
      await unpublishMicrophone({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
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
      if (!room) return;

      try {
        await room.switchActiveDevice('videoinput', deviceId);
        AVLogger.info('track.cam.switch_device_seamless', { deviceId });
        return;
      } catch (err) {
        AVLogger.warn('track.cam.switch_device_fallback', { deviceId, error: String(err) });
      }

      await unpublishCamera({ room, state, checkAllTracksUnpublished: () => this.checkAllTracksUnpublished() });
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
    if (saved.mic && !this.isMicrophoneEnabled) {
      await this.setMicrophoneEnabled(true);
    }
    if (saved.cam && !this.isCameraEnabled) {
      await this.setCameraEnabled(true);
    }
  }

  /**
   * Stop all local tracks (e.g., when leaving room)
   */
  async stopAllTracks(): Promise<void> {
    this._state.microphone.desired = false;
    this._state.microphone.pending = false;
    this._state.camera.desired = false;
    this._state.camera.pending = false;
    // No dangling hardware-release timer across leave()/room-switch. Harmless if
    // it fired (it re-checks desired/track), but cancelling keeps teardown clean.
    this.cancelMicHardwareRelease();

    await Promise.all([
      this.enqueueMic(async () => {
        const room = this.deps.getRoom();
        if (room)
          await unpublishMicrophone({
            room,
            state: this._state.microphone,
            checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
          });
      }),
      this.enqueueCam(async () => {
        const room = this.deps.getRoom();
        if (room)
          await unpublishCamera({
            room,
            state: this._state.camera,
            checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
          });
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

    this.resetMicEndedBreaker();
    this.cancelMicHardwareRelease();

    // Don't await here, just fire and forget
    this.stopAllTracks().catch(() => {});

    this._state = {
      microphone: { ...INITIAL_TRACK_STATE },
      camera: { ...INITIAL_TRACK_STATE },
    };
  }

  private enqueueMic(task: () => Promise<void>): Promise<void> {
    this._micOp = enqueueTrackOp(this._micOp, task);
    return this._micOp;
  }

  private enqueueCam(task: () => Promise<void>): Promise<void> {
    this._camOp = enqueueTrackOp(this._camOp, task);
    return this._camOp;
  }

  private micApplyShared(): MicApplyShared {
    return {
      state: this._state.microphone,
      room: this.deps.getRoom(),
      actualPublished: this.isMicrophoneEnabled,
      isSignalOpen: () => this.deps.isSignalOpen(),
      ensureConnected: () => this.deps.ensureConnected(),
      onTrackPublished: () => this.deps.onTrackPublished(),
      checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
      watchTrackEnded: (track, onEnded) => this.watchTrackEnded(track, 'microphone', onEnded),
      tryUnlockAudio: () => this.tryUnlockAudio(),
      setMicPublishing: (value) => {
        this._micPublishing = value;
      },
      markMicPublishedNow: () => {
        this._micLastPublishAt = Date.now();
      },
      scheduleMicHardwareRelease: () => this.scheduleMicHardwareRelease(),
      cancelMicHardwareRelease: () => this.cancelMicHardwareRelease(),
      onTrackEndedByBrowser: () => this.handleMicEndedByBrowser(),
    };
  }

  private async applyMicrophoneDesired(): Promise<void> {
    const args = this.micApplyShared();
    const state = args.state;
    const enabled = state.desired;
    const room = args.room;
    const actual = room ? args.actualPublished : state.published;

    if (syncMicrophoneAlreadyInState(state, enabled, actual)) return;

    AVLogger.debug('track.mic.set', { enabled, currentlyPublished: state.published });

    if (enabled) {
      await args.tryUnlockAudio();
    }

    if (!room) {
      await pendingMicrophoneWithoutRoom(args, enabled);
      return;
    }

    // If signaling is stale/closed, reconnect first; publishing into a dead signal is unreliable.
    if (enabled && !args.isSignalOpen()) {
      await pendingMicrophoneSignalClosed(args);
      return;
    }

    state.pending = false;

    // Soft-mute path: track publication is preserved; we only toggle the
    // RTP-Mute-Frame. Saves 2-4 seconds of SDP renegotiation per toggle.
    if (enabled) {
      await this.enableMicrophoneDesired(args, room);
    } else {
      await this.disableMicrophoneDesired(args, room);
    }
  }

  private async enableMicrophoneDesired(
    args: MicApplyShared,
    room: NonNullable<MicApplyShared['room']>,
  ): Promise<void> {
    await enableMicrophoneTrack(args, room);
  }

  private async disableMicrophoneDesired(
    args: MicApplyShared,
    room: NonNullable<MicApplyShared['room']>,
  ): Promise<void> {
    await disableMicrophoneTrack(args, room);
  }

  private async applyCameraDesired(): Promise<void> {
    await applyCameraDesiredHelper({
      state: this._state.camera,
      room: this.deps.getRoom(),
      actualPublished: this.isCameraEnabled,
      isSignalOpen: () => this.deps.isSignalOpen(),
      ensureConnected: () => this.deps.ensureConnected(),
      onTrackPublished: () => this.deps.onTrackPublished(),
      checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
      watchTrackEnded: (track, onEnded) => this.watchTrackEnded(track, 'camera', onEnded),
      setCamPublishing: (value) => {
        this._camPublishing = value;
      },
      setCameraEnabled: (enabled) => this.setCameraEnabled(enabled),
    });
  }

  private checkAllTracksUnpublished(): void {
    if (!this._state.microphone.published && !this._state.camera.published) {
      this.deps.onAllTracksUnpublished();
    }
  }

  private resetMicEndedBreaker(): void {
    const attempts = { value: this._micEndedAttempts };
    resetMicEndedBreakerHelper(attempts, this._micRepublish);
    this._micEndedAttempts = attempts.value;
  }

  private cancelMicHardwareRelease(): void {
    cancelMicHardwareReleaseHelper(this._micRelease);
  }

  private scheduleMicHardwareRelease(): void {
    scheduleMicHardwareReleaseHelper({
      release: this._micRelease,
      disposed: () => this._disposed,
      getMicState: () => this._state.microphone,
      getRoom: () => this.deps.getRoom(),
      enqueueMic: (task) => this.enqueueMic(task),
      checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
    });
  }

  private handleMicEndedByBrowser(): void {
    const attempts = { value: this._micEndedAttempts };
    handleMicEndedByBrowserHelper({
      state: this._state.microphone,
      disposed: this._disposed,
      micLastPublishAt: this._micLastPublishAt,
      micEndedAttempts: attempts,
      republish: this._micRepublish,
      checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
      dropPreferredMicIfGone: () => this.dropPreferredMicIfGone(),
      enqueueMic: (task) => this.enqueueMic(task),
      applyMicrophoneDesired: () => this.applyMicrophoneDesired(),
      isDisposed: () => this._disposed,
      isMicDesired: () => this._state.microphone.desired,
    });
    this._micEndedAttempts = attempts.value;
  }

  private async dropPreferredMicIfGone(): Promise<void> {
    await dropPreferredMicIfGoneHelper(this._state.microphone);
  }

  private watchTrackEnded(
    track: LocalAudioTrack | LocalVideoTrack,
    _source: 'microphone' | 'camera',
    onEnded: () => void,
  ): void {
    watchTrackEndedHelper(track, onEnded, this._trackEndedCleanups);
  }

  private async tryUnlockAudio(): Promise<void> {
    await tryUnlockAudioHelper(this.deps.getRoom(), this._audioUnlock);
  }
}
