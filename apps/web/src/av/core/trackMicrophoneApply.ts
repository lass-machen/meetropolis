import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import type { LocalTrackState } from './types';
import { AVLogger } from '../AVLogger';
import { useAvSettingsStore } from '../../state/avSettings';
import type { TrackLike } from '../../types/livekit';
import {
  publishMicrophone,
  unpublishMicrophone,
  ensureAudioPermissions,
  softMuteMicrophone,
  softUnmuteMicrophone,
} from './microphonePublishing';

export type MicApplyShared = {
  state: LocalTrackState;
  room: Room | null;
  actualPublished: boolean;
  isSignalOpen: () => boolean;
  ensureConnected: () => Promise<void>;
  onTrackPublished: () => void;
  checkAllTracksUnpublished: () => void;
  watchTrackEnded: (track: LocalAudioTrack | LocalVideoTrack, onEnded: () => void) => void;
  tryUnlockAudio: () => Promise<void>;
  setMicPublishing: (value: boolean) => void;
  markMicPublishedNow: () => void;
  scheduleMicHardwareRelease: () => void;
  cancelMicHardwareRelease: () => void;
  onTrackEndedByBrowser: () => void;
};

/** Early-exit when desired already matches the live/published state. */
export function syncMicrophoneAlreadyInState(state: LocalTrackState, enabled: boolean, actual: boolean): boolean {
  if (actual === enabled && !state.pending) {
    // `published` reflects "publication exists", not "is audible".
    // For a present (possibly muted) track, `published` stays true.
    const mst = (state.track as TrackLike | null)?.mediaStreamTrack;
    const trackIsLive = !!state.track && (!mst || mst.readyState === 'live');
    state.published = trackIsLive || actual;
    AVLogger.debug('track.mic.already_in_state', { enabled });
    return true;
  }
  return false;
}

export async function pendingMicrophoneWithoutRoom(args: MicApplyShared, enabled: boolean): Promise<void> {
  const state = args.state;
  state.pending = enabled;
  if (enabled) {
    AVLogger.info('track.mic.pending', { reason: 'no_room' });
    await ensureAudioPermissions();
    try {
      await args.ensureConnected();
    } catch {}
  }
}

export async function pendingMicrophoneSignalClosed(args: MicApplyShared): Promise<void> {
  args.state.pending = true;
  AVLogger.info('track.mic.pending', { reason: 'signal_closed' });
  try {
    await args.ensureConnected();
  } catch {}
}

export async function enableMicrophoneTrack(args: MicApplyShared, room: Room): Promise<void> {
  const state = args.state;
  const existingTrack = state.track as LocalAudioTrack | null;
  const mst = (existingTrack as TrackLike | null)?.mediaStreamTrack;
  const trackIsLive = !!existingTrack && (!mst || mst.readyState === 'live');

  if (trackIsLive && existingTrack) {
    const ok = await softUnmuteMicrophone(existingTrack);
    if (ok) {
      state.published = true;
      args.markMicPublishedNow();
      args.onTrackPublished();
      return;
    }
    // Fallback: the track is unusable; perform a full republish.
    AVLogger.info('track.mic.soft_unmute_fallback_publish');
  }
  // Mark the publish in flight so the UI can hold the button "on" and show a
  // connecting hint for the (potentially multi-second) republish window.
  // withPublishTimeout inside publishMicrophone bounds this, so the flag
  // cannot stick; finally clears it on success, failure and timeout alike.
  args.setMicPublishing(true);
  try {
    await publishMicrophone({
      room,
      state,
      watchTrackEnded: (track, onEnded) => args.watchTrackEnded(track, onEnded),
      onTrackPublished: () => {
        // Mark the moment the current track went live; the ended-breaker uses
        // this to tell a healthy track (long survival) from a tight flap.
        args.markMicPublishedNow();
        args.onTrackPublished();
      },
      onTrackEndedByBrowser: () => args.onTrackEndedByBrowser(),
    });
  } finally {
    args.setMicPublishing(false);
  }
}

export async function disableMicrophoneTrack(args: MicApplyShared, room: Room): Promise<void> {
  const state = args.state;
  const existingTrack = state.track as LocalAudioTrack | null;
  const mst = (existingTrack as TrackLike | null)?.mediaStreamTrack;
  const trackIsLive = !!existingTrack && (!mst || mst.readyState === 'live');
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
      args.scheduleMicHardwareRelease();
    }
    return;
  }
  // No live track to soft-mute (already ended/absent): make sure nothing
  // lingers. This also closes the hardware mic across all pipeline variants,
  // including the voice-isolation WebAudio graph (see unpublishMicrophone).
  args.cancelMicHardwareRelease();
  await unpublishMicrophone({
    room,
    state,
    checkAllTracksUnpublished: args.checkAllTracksUnpublished,
  });
}
