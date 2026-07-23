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
import {
  publishMicrophone,
  unpublishMicrophone,
  ensureAudioPermissions,
  softMuteMicrophone,
  softUnmuteMicrophone,
} from './microphonePublishing';
import { publishCamera, unpublishCamera, ensureVideoPermissions } from './cameraPublishing';
import { listPublications, readPubKind, readPubSource, type TrackLike } from '../../types/livekit';
import { readTimeoutMs } from '../../lib/runtimeConfig';
import { setAudioCaptureNeeded } from '../audio/audioSessionDucking';

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

// Recovery tuning for a microphone track that the browser ends (device
// removed/disconnected, Bluetooth HFP/A2DP flap, OS interruption). Without a
// breaker the 200ms auto-republish loops forever and churns the track. See
// knowledge/AV_MUTE_DEVICE_HARDENING.md.
const MIC_REPUBLISH_BASE_MS = 200;
const MIC_REPUBLISH_MAX_MS = 5_000;
// Consecutive rapid ends before we stop auto-republishing (circuit opens).
const MIC_ENDED_MAX_ATTEMPTS = 5;
// A republished track that stays live at least this long counts as "healthy"
// and forgives the accumulated attempts. Measuring track SURVIVAL (not the gap
// between ends) avoids permanently disabling a device that works for a while
// between drops, while still tripping on a genuinely tight flap.
const MIC_HEALTHY_SURVIVAL_MS = 10_000;
// Rate-limit for the device-change recovery nudge, so a device that flaps and
// spams `devicechange` cannot drive a fast republish loop through that path.
const MIC_DEVICE_NUDGE_MIN_MS = 2_000;
// Hybrid mute: a mute always soft-mutes instantly (RTP-mute frame, no
// renegotiation, no clipped speech onset). When stopMicOnMute is on, the
// capture hardware is only released after the mic has stayed muted this long —
// a quick unmute cancels the release and soft-unmutes instantly, while
// sustained mute still frees the device and turns off the OS recording
// indicator for privacy. See knowledge/AV_MUTE_DEVICE_HARDENING.md.
const MIC_HARDWARE_RELEASE_DEFAULT_MS = 4_000;

export class TrackManager implements Disposable {
  private _state: TrackManagerState = {
    microphone: { ...INITIAL_TRACK_STATE },
    camera: { ...INITIAL_TRACK_STATE },
  };

  private _disposed = false;
  private _audioContextResumeCount = 0;
  private _lastAudioContextResume = 0;
  private _trackEndedCleanups: Map<string, () => void> = new Map();

  // Circuit-breaker state for the "mic ended by browser" auto-republish.
  private _micEndedAttempts = 0;
  private _micLastPublishAt = 0;
  private _lastDeviceNudgeAt = 0;
  private _micRepublishTimer: ReturnType<typeof setTimeout> | null = null;
  // Grace timer for the hybrid mute's delayed hardware release (stopMicOnMute).
  private _micReleaseTimer: ReturnType<typeof setTimeout> | null = null;
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
      const pubs = listPublications(room.localParticipant);
      const hasMic = pubs.some((pub) => {
        const src = readPubSource(pub);
        const kind = readPubKind(pub);
        const track = pub.track;
        if (!track) return false;
        if (kind !== 'audio' || src !== 'microphone') return false;
        const mst = track.mediaStreamTrack;
        const readyState = mst?.readyState;
        const isLive = readyState === undefined || readyState === 'live';
        if (!isLive) return false;
        // Soft-mute: publication stays, but pub.muted/track.enabled signals "off".
        const pubMuted = pub.muted === true || pub.isMuted === true;
        if (pubMuted) return false;
        const enabledFlag = track.isEnabled ?? track.enabled ?? mst?.enabled;
        if (enabledFlag === false) return false;
        return true;
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
      const pubs = listPublications(room.localParticipant);
      const hasCam = pubs.some((pub) => {
        const src = readPubSource(pub);
        const kind = readPubKind(pub);
        const track = pub.track;
        if (!track) return false;
        const mst = track.mediaStreamTrack;
        if (kind !== 'video') return false;
        if (src === 'screen_share') return false;
        const isCam = src === 'camera' || src == null;
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
        if (!this._micReleaseTimer) this.scheduleMicHardwareRelease();
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
      // `published` reflects "publication exists", not "is audible".
      // For a present (possibly muted) track, `published` stays true.
      const mst = (state.track as TrackLike | null)?.mediaStreamTrack;
      const trackIsLive = !!state.track && (!mst || mst.readyState === 'live');
      state.published = trackIsLive || actual;
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

    // Soft-mute path: track publication is preserved; we only toggle the
    // RTP-Mute-Frame. Saves 2-4 seconds of SDP renegotiation per toggle.
    const existingTrack = state.track as LocalAudioTrack | null;
    const mst = (existingTrack as TrackLike | null)?.mediaStreamTrack;
    const trackIsLive = !!existingTrack && (!mst || mst.readyState === 'live');

    if (enabled) {
      if (trackIsLive && existingTrack) {
        const ok = await softUnmuteMicrophone(existingTrack);
        if (ok) {
          state.published = true;
          this._micLastPublishAt = Date.now();
          this.deps.onTrackPublished();
          return;
        }
        // Fallback: the track is unusable; perform a full republish.
        AVLogger.info('track.mic.soft_unmute_fallback_publish');
      }
      // Mark the publish in flight so the UI can hold the button "on" and show a
      // connecting hint for the (potentially multi-second) republish window.
      // withPublishTimeout inside publishMicrophone bounds this, so the flag
      // cannot stick; finally clears it on success, failure and timeout alike.
      this._micPublishing = true;
      try {
        await publishMicrophone({
          room,
          state,
          watchTrackEnded: (track, onEnded) => this.watchTrackEnded(track, 'microphone', onEnded),
          onTrackPublished: () => {
            // Mark the moment the current track went live; the ended-breaker uses
            // this to tell a healthy track (long survival) from a tight flap.
            this._micLastPublishAt = Date.now();
            this.deps.onTrackPublished();
          },
          onTrackEndedByBrowser: () => this.handleMicEndedByBrowser(),
        });
      } finally {
        this._micPublishing = false;
      }
    } else {
      const settings = useAvSettingsStore.getState().settings;
      if (trackIsLive && existingTrack) {
        // Hybrid mute: always soft-mute first for a snappy, clip-free toggle.
        // The publication (and its participant-level zone allow-list) stays
        // intact, so re-enabling within the grace window is an instant
        // soft-unmute with no SDP renegotiation.
        await softMuteMicrophone(existingTrack);
        // Publication stays in place; the published flag reflects "track exists".
        state.published = true;
        if (settings.stopMicOnMute) {
          // Privacy policy: free the capture hardware / turn off the OS
          // recording indicator once the mic has stayed muted long enough.
          this.scheduleMicHardwareRelease();
        }
        return;
      }
      // No live track to soft-mute (already ended/absent): make sure nothing
      // lingers. This also closes the hardware mic across all pipeline variants,
      // including the voice-isolation WebAudio graph (see unpublishMicrophone).
      this.cancelMicHardwareRelease();
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
      // In flight during getUserMedia + publish, so the UI holds the camera
      // button at the intent instead of flickering off mid-publish.
      this._camPublishing = true;
      try {
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
              setTimeout(() => {
                void this.setCameraEnabled(true).catch(() => {});
              }, 200);
            }
          },
        });
      } finally {
        this._camPublishing = false;
      }
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

  private resetMicEndedBreaker(): void {
    this._micEndedAttempts = 0;
    if (this._micRepublishTimer) {
      clearTimeout(this._micRepublishTimer);
      this._micRepublishTimer = null;
    }
  }

  private cancelMicHardwareRelease(): void {
    if (this._micReleaseTimer) {
      clearTimeout(this._micReleaseTimer);
      this._micReleaseTimer = null;
    }
  }

  /**
   * Schedule the hybrid mute's delayed hardware release. After the grace delay,
   * if the mic is still muted (desired === false) and a track is present, fully
   * unpublish it to free the capture device and clear the OS recording
   * indicator. The teardown runs through enqueueMic and re-checks `desired`, so
   * an unmute that lands during the delay (which also cancels this timer via
   * cancelMicHardwareRelease) can never race a live track into a teardown.
   */
  private scheduleMicHardwareRelease(): void {
    this.cancelMicHardwareRelease();
    const delayMs = readTimeoutMs('VITE_MIC_RELEASE_DELAY_MS', MIC_HARDWARE_RELEASE_DEFAULT_MS);
    this._micReleaseTimer = setTimeout(() => {
      this._micReleaseTimer = null;
      void this.enqueueMic(async () => {
        if (this._disposed) return;
        const state = this._state.microphone;
        // Unmuted again during the grace window: keep the live track.
        if (state.desired) return;
        if (!state.track) return;
        const room = this.deps.getRoom();
        if (!room) return;
        AVLogger.info('track.mic.hardware_release');
        await unpublishMicrophone({
          room,
          state,
          checkAllTracksUnpublished: () => this.checkAllTracksUnpublished(),
        });
        // The device is gone by intent, so the audio session may drop back to
        // the ducking-free 'playback' category — which is exactly what the
        // "fully close mic on mute" setting is for: recording indicator off and
        // nothing ducking system audio. publishMicrophone re-declares the need
        // before it reopens the device.
        setAudioCaptureNeeded(false);
      }).catch(() => {});
    }, delayMs);
  }

  /**
   * The browser ended the local microphone track (device removed/disconnected,
   * Bluetooth profile flap, OS interruption). Recover with exponential backoff
   * and a circuit-breaker so a device that keeps dying does not churn the track
   * every 200ms. If the preferred input vanished, fall back to the system
   * default. See knowledge/AV_MUTE_DEVICE_HARDENING.md.
   */
  private handleMicEndedByBrowser(): void {
    const state = this._state.microphone;
    state.published = false;
    state.track = null;

    if (this._disposed || !state.desired) {
      AVLogger.warn('track.mic.ended_by_browser', { recover: false });
      return;
    }

    const now = Date.now();
    // If the (just-ended) track had been live long enough, it was genuinely
    // working: forgive the accumulated attempts before counting this end.
    const survivedMs = this._micLastPublishAt > 0 ? now - this._micLastPublishAt : 0;
    if (survivedMs >= MIC_HEALTHY_SURVIVAL_MS) {
      this._micEndedAttempts = 0;
    }
    this._micEndedAttempts += 1;
    AVLogger.warn('track.mic.ended_by_browser', { attempt: this._micEndedAttempts, survivedMs });

    if (this._micEndedAttempts > MIC_ENDED_MAX_ATTEMPTS) {
      // Circuit open: the input keeps dying fast. Stop auto-republishing — a
      // manual mic re-toggle (resetMicEndedBreaker) or a device-change nudge
      // (notifyDeviceChange, one rate-limited retry) is required to recover.
      AVLogger.error('track.mic.ended_circuit_open', { attempts: this._micEndedAttempts });
      // The mic is now genuinely gone; let the state machine settle if it was
      // the only local track (mirrors the unpublished path).
      this.checkAllTracksUnpublished();
      return;
    }

    const delay = Math.min(MIC_REPUBLISH_BASE_MS * 2 ** (this._micEndedAttempts - 1), MIC_REPUBLISH_MAX_MS);
    if (this._micRepublishTimer) clearTimeout(this._micRepublishTimer);
    this._micRepublishTimer = setTimeout(() => {
      this._micRepublishTimer = null;
      void (async () => {
        if (this._disposed || !this._state.microphone.desired) return;
        // Drop a preferred device that no longer exists so the republish uses
        // the current system default instead of retrying a gone device.
        await this.dropPreferredMicIfGone();
        await this.enqueueMic(async () => {
          if (this._disposed) return;
          await this.applyMicrophoneDesired();
        });
      })().catch(() => {});
    }, delay);
  }

  /** Clear the preferred mic device if it is no longer enumerated. */
  private async dropPreferredMicIfGone(): Promise<void> {
    const state = this._state.microphone;
    if (!state.preferredDeviceId) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');
      // Without mic permission, enumerateDevices returns audioinput entries with
      // blank deviceIds. In that state we cannot tell whether the preferred
      // device is really gone, so keep the preference (avoid a false drop, e.g.
      // when the track ended due to a transient permission blip).
      const haveIds = inputs.some((d) => d.deviceId);
      if (!haveIds) return;
      const stillThere = inputs.some((d) => d.deviceId === state.preferredDeviceId);
      if (!stillThere) {
        AVLogger.info('track.mic.preferred_device_gone', { deviceId: state.preferredDeviceId });
        state.preferredDeviceId = undefined;
      }
    } catch {
      // enumerateDevices unavailable/blocked — keep the preference and retry.
    }
  }

  private watchTrackEnded(
    track: LocalAudioTrack | LocalVideoTrack,
    _source: 'microphone' | 'camera',
    onEnded: () => void,
  ): void {
    const mst = (track as TrackLike).mediaStreamTrack;
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
      const roomLike = room as Room & {
        startAudio?: () => Promise<unknown>;
        engine?: { client?: { audioContext?: AudioContext }; audioContext?: AudioContext };
      };

      // Try LiveKit's startAudio
      if (typeof roomLike.startAudio === 'function') {
        await roomLike.startAudio();
      }

      // Also try to resume AudioContext directly
      const ctx = roomLike.engine?.client?.audioContext ?? roomLike.engine?.audioContext;
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }

      AVLogger.debug('audio.unlock.success', {
        resumeCount: this._audioContextResumeCount,
      });
    } catch (error) {
      // NotAllowedError is expected if no user gesture
      if ((error as { name?: string })?.name !== 'NotAllowedError') {
        AVLogger.warn('audio.unlock.error', { error: String(error) });
      }
    }
  }
}
