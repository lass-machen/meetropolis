import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import type { LocalTrackState } from './types';
import { AVLogger } from '../AVLogger';
import { publishCamera, unpublishCamera, ensureVideoPermissions } from './cameraPublishing';

export type ApplyCameraDesiredArgs = {
  state: LocalTrackState;
  room: Room | null;
  actualPublished: boolean;
  isSignalOpen: () => boolean;
  ensureConnected: () => Promise<void>;
  onTrackPublished: () => void;
  checkAllTracksUnpublished: () => void;
  watchTrackEnded: (track: LocalAudioTrack | LocalVideoTrack, onEnded: () => void) => void;
  setCamPublishing: (value: boolean) => void;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
};

export async function applyCameraDesired(args: ApplyCameraDesiredArgs): Promise<void> {
  const state = args.state;
  const enabled = state.desired;
  const room = args.room;
  const actual = room ? args.actualPublished : state.published;

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
        await args.ensureConnected();
      } catch {}
    }
    return;
  }

  if (enabled && !args.isSignalOpen()) {
    state.pending = true;
    AVLogger.info('track.cam.pending', { reason: 'signal_closed' });
    try {
      await args.ensureConnected();
    } catch {}
    return;
  }

  state.pending = false;

  if (enabled) {
    // In flight during getUserMedia + publish, so the UI holds the camera
    // button at the intent instead of flickering off mid-publish.
    args.setCamPublishing(true);
    try {
      await publishCamera({
        room,
        state,
        watchTrackEnded: (track, onEnded) => args.watchTrackEnded(track, onEnded),
        onTrackPublished: () => args.onTrackPublished(),
        onTrackEndedByBrowser: () => {
          AVLogger.warn('track.cam.ended_by_browser');
          state.published = false;
          state.track = null;
          if (state.desired) {
            setTimeout(() => {
              void args.setCameraEnabled(true).catch(() => {});
            }, 200);
          }
        },
      });
    } finally {
      args.setCamPublishing(false);
    }
  } else {
    await unpublishCamera({
      room,
      state,
      checkAllTracksUnpublished: args.checkAllTracksUnpublished,
    });
  }
}
