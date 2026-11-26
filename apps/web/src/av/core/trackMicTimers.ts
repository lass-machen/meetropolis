import type { Room } from 'livekit-client';
import type { LocalTrackState } from './types';
import { AVLogger } from '../AVLogger';
import { readTimeoutMs } from '../../lib/runtimeConfig';
import { unpublishMicrophone } from './microphonePublishing';
import { MIC_HARDWARE_RELEASE_DEFAULT_MS } from './trackManagerConstants';

export type MicRepublishTimerSlot = {
  timer: ReturnType<typeof setTimeout> | null;
};

export type MicReleaseTimerSlot = {
  timer: ReturnType<typeof setTimeout> | null;
};

export function resetMicEndedBreaker(attempts: { value: number }, republish: MicRepublishTimerSlot): void {
  attempts.value = 0;
  if (republish.timer) {
    clearTimeout(republish.timer);
    republish.timer = null;
  }
}

export function cancelMicHardwareRelease(release: MicReleaseTimerSlot): void {
  if (release.timer) {
    clearTimeout(release.timer);
    release.timer = null;
  }
}

export type ScheduleMicHardwareReleaseArgs = {
  release: MicReleaseTimerSlot;
  disposed: () => boolean;
  getMicState: () => LocalTrackState;
  getRoom: () => Room | null;
  enqueueMic: (task: () => Promise<void>) => Promise<void>;
  checkAllTracksUnpublished: () => void;
};

/**
 * Schedule the hybrid mute's delayed hardware release. After the grace delay,
 * if the mic is still muted (desired === false) and a track is present, fully
 * unpublish it to free the capture device and clear the OS recording
 * indicator. The teardown runs through enqueueMic and re-checks `desired`, so
 * an unmute that lands during the delay (which also cancels this timer via
 * cancelMicHardwareRelease) can never race a live track into a teardown.
 */
export function scheduleMicHardwareRelease(args: ScheduleMicHardwareReleaseArgs): void {
  cancelMicHardwareRelease(args.release);
  const delayMs = readTimeoutMs('VITE_MIC_RELEASE_DELAY_MS', MIC_HARDWARE_RELEASE_DEFAULT_MS);
  args.release.timer = setTimeout(() => {
    args.release.timer = null;
    void args
      .enqueueMic(async () => {
        if (args.disposed()) return;
        const state = args.getMicState();
        // Unmuted again during the grace window: keep the live track.
        if (state.desired) return;
        if (!state.track) return;
        const room = args.getRoom();
        if (!room) return;
        AVLogger.info('track.mic.hardware_release');
        await unpublishMicrophone({
          room,
          state,
          checkAllTracksUnpublished: args.checkAllTracksUnpublished,
        });
      })
      .catch(() => {});
  }, delayMs);
}
