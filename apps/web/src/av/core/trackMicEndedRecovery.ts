import type { LocalTrackState } from './types';
import { AVLogger } from '../AVLogger';
import {
  MIC_ENDED_MAX_ATTEMPTS,
  MIC_HEALTHY_SURVIVAL_MS,
  MIC_REPUBLISH_BASE_MS,
  MIC_REPUBLISH_MAX_MS,
} from './trackManagerConstants';
import type { MicRepublishTimerSlot } from './trackMicTimers';

export type HandleMicEndedByBrowserArgs = {
  state: LocalTrackState;
  disposed: boolean;
  micLastPublishAt: number;
  micEndedAttempts: { value: number };
  republish: MicRepublishTimerSlot;
  checkAllTracksUnpublished: () => void;
  dropPreferredMicIfGone: () => Promise<void>;
  enqueueMic: (task: () => Promise<void>) => Promise<void>;
  applyMicrophoneDesired: () => Promise<void>;
  isDisposed: () => boolean;
  isMicDesired: () => boolean;
};

/**
 * The browser ended the local microphone track (device removed/disconnected,
 * Bluetooth profile flap, OS interruption). Recover with exponential backoff
 * and a circuit-breaker so a device that keeps dying does not churn the track
 * every 200ms. If the preferred input vanished, fall back to the system
 * default. See knowledge/AV_MUTE_DEVICE_HARDENING.md.
 */
export function handleMicEndedByBrowser(args: HandleMicEndedByBrowserArgs): void {
  const state = args.state;
  state.published = false;
  state.track = null;

  if (args.disposed || !state.desired) {
    AVLogger.warn('track.mic.ended_by_browser', { recover: false });
    return;
  }

  const now = Date.now();
  // If the (just-ended) track had been live long enough, it was genuinely
  // working: forgive the accumulated attempts before counting this end.
  const survivedMs = args.micLastPublishAt > 0 ? now - args.micLastPublishAt : 0;
  if (survivedMs >= MIC_HEALTHY_SURVIVAL_MS) {
    args.micEndedAttempts.value = 0;
  }
  args.micEndedAttempts.value += 1;
  AVLogger.warn('track.mic.ended_by_browser', {
    attempt: args.micEndedAttempts.value,
    survivedMs,
  });

  if (args.micEndedAttempts.value > MIC_ENDED_MAX_ATTEMPTS) {
    // Circuit open: the input keeps dying fast. Stop auto-republishing — a
    // manual mic re-toggle (resetMicEndedBreaker) or a device-change nudge
    // (notifyDeviceChange, one rate-limited retry) is required to recover.
    AVLogger.error('track.mic.ended_circuit_open', { attempts: args.micEndedAttempts.value });
    // The mic is now genuinely gone; let the state machine settle if it was
    // the only local track (mirrors the unpublished path).
    args.checkAllTracksUnpublished();
    return;
  }

  const delay = Math.min(MIC_REPUBLISH_BASE_MS * 2 ** (args.micEndedAttempts.value - 1), MIC_REPUBLISH_MAX_MS);
  if (args.republish.timer) clearTimeout(args.republish.timer);
  args.republish.timer = setTimeout(() => {
    args.republish.timer = null;
    void (async () => {
      if (args.isDisposed() || !args.isMicDesired()) return;
      // Drop a preferred device that no longer exists so the republish uses
      // the current system default instead of retrying a gone device.
      await args.dropPreferredMicIfGone();
      await args.enqueueMic(async () => {
        if (args.isDisposed()) return;
        await args.applyMicrophoneDesired();
      });
    })().catch(() => {});
  }, delay);
}
