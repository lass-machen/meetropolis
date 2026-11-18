import type { Room, LocalAudioTrack, LocalVideoTrack } from 'livekit-client';
import type { LocalTrackState } from './types';
import { AVLogger } from '../AVLogger';
import { readCaptureTrack } from '../audio/captureTrack';

/** Clear the preferred mic device if it is no longer enumerated. */
export async function dropPreferredMicIfGone(state: LocalTrackState): Promise<void> {
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

export function watchTrackEnded(
  track: LocalAudioTrack | LocalVideoTrack,
  onEnded: () => void,
  cleanups: Map<string, () => void>,
): void {
  // Watch the raw capture: with voice isolation the published track is a
  // WebAudio destination that does not end when the device goes away.
  const mst = readCaptureTrack(track);
  if (!mst) return;

  const handler = () => {
    onEnded();
    cleanups.delete(mst.id);
  };

  mst.addEventListener('ended', handler, { once: true });
  cleanups.set(mst.id, () => {
    mst.removeEventListener('ended', handler);
  });
}

export type AudioUnlockThrottle = {
  lastResumeAt: number;
  resumeCount: number;
};

export async function tryUnlockAudio(room: Room | null, throttle: AudioUnlockThrottle): Promise<void> {
  if (!room) return;

  const now = Date.now();

  // Throttle AudioContext.resume() calls
  // Safari has issues with too many resume() calls
  if (now - throttle.lastResumeAt < 1000) {
    return;
  }

  throttle.resumeCount++;
  throttle.lastResumeAt = now;

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
      resumeCount: throttle.resumeCount,
    });
  } catch (error) {
    // NotAllowedError is expected if no user gesture
    if ((error as { name?: string })?.name !== 'NotAllowedError') {
      AVLogger.warn('audio.unlock.error', { error: String(error) });
    }
  }
}
