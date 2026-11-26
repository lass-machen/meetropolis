import type { Room } from 'livekit-client';
import type { LocalTrackState } from './types';

export interface TrackManagerDeps {
  getRoom: () => Room | null;
  isSignalOpen: () => boolean;
  onTrackPublished: () => void;
  onAllTracksUnpublished: () => void;
  ensureConnected: () => Promise<void>;
}

export const INITIAL_TRACK_STATE: LocalTrackState = {
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
export const MIC_REPUBLISH_BASE_MS = 200;
export const MIC_REPUBLISH_MAX_MS = 5_000;
// Consecutive rapid ends before we stop auto-republishing (circuit opens).
export const MIC_ENDED_MAX_ATTEMPTS = 5;
// A republished track that stays live at least this long counts as "healthy"
// and forgives the accumulated attempts. Measuring track SURVIVAL (not the gap
// between ends) avoids permanently disabling a device that works for a while
// between drops, while still tripping on a genuinely tight flap.
export const MIC_HEALTHY_SURVIVAL_MS = 10_000;
// Rate-limit for the device-change recovery nudge, so a device that flaps and
// spams `devicechange` cannot drive a fast republish loop through that path.
export const MIC_DEVICE_NUDGE_MIN_MS = 2_000;
// Hybrid mute: a mute always soft-mutes instantly (RTP-mute frame, no
// renegotiation, no clipped speech onset). When stopMicOnMute is on, the
// capture hardware is only released after the mic has stayed muted this long —
// a quick unmute cancels the release and soft-unmutes instantly, while
// sustained mute still frees the device and turns off the OS recording
// indicator for privacy. See knowledge/AV_MUTE_DEVICE_HARDENING.md.
export const MIC_HARDWARE_RELEASE_DEFAULT_MS = 4_000;
