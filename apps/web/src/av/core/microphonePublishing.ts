import type { LocalAudioTrack, LocalTrack, Room } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import { useAvSettingsStore } from '../../state/avSettings';
import { readTimeoutMs } from '../../lib/runtimeConfig';
import type { LocalTrackState } from './types';
import {
  listPublications,
  readPubKind,
  readPubSource,
  type TrackLike,
  type TrackPublicationLike,
} from '../../types/livekit';

async function withPublishTimeout<T>(op: Promise<T>, timeoutMs: number): Promise<T> {
  const TIMEOUT_SENTINEL = Symbol('mic_publish_timeout');
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  try {
    const result = await Promise.race([op, timeoutPromise]);
    if (result === TIMEOUT_SENTINEL) {
      throw new Error('mic_publish_timeout');
    }
    return result;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function getLocalTrackPublications(room: Room): TrackPublicationLike[] {
  try {
    return listPublications(room.localParticipant);
  } catch {
    return [];
  }
}

type PublishMicrophoneParams = {
  room: Room;
  state: LocalTrackState;
  watchTrackEnded: (track: LocalAudioTrack, onEnded: () => void) => void;
  onTrackPublished: () => void;
  onTrackEndedByBrowser: () => void;
};

function findLiveMicrophonePublication(room: Room): LocalAudioTrack | null {
  try {
    const pubs = getLocalTrackPublications(room);
    const livePub = pubs.find((pub) => {
      const src = readPubSource(pub);
      const kind = readPubKind(pub);
      const t = pub.track;
      const mst = t?.mediaStreamTrack;
      const readyState = mst?.readyState;
      const isLive = readyState === undefined || readyState === 'live';
      return kind === 'audio' && src === 'microphone' && isLive;
    });
    return (livePub?.track as unknown as LocalAudioTrack) ?? null;
  } catch {
    return null;
  }
}

function isTrackLive(track: unknown): boolean {
  if (!track || typeof track !== 'object') return false;
  const mst = (track as TrackLike).mediaStreamTrack;
  return mst?.readyState === 'live';
}

async function unpublishNonLiveMicrophoneTracks(room: Room): Promise<void> {
  try {
    const pubs = getLocalTrackPublications(room);
    for (const pub of pubs) {
      const src = readPubSource(pub);
      const kind = readPubKind(pub);
      const t = pub.track;
      if (!t) continue;
      if (kind !== 'audio' || src !== 'microphone') continue;
      const mst = t.mediaStreamTrack;
      if (mst?.readyState === 'live') continue;

      try {
        if (typeof t.setEnabled === 'function') {
          t.setEnabled(false);
        } else if (mst) {
          mst.enabled = false;
        }
      } catch {}

      try {
        await room.localParticipant.unpublishTrack(t as unknown as LocalTrack);
      } catch {}
      try {
        t.stop?.();
      } catch {}
    }
  } catch {}
}

async function buildAndPublishMicrophoneTrack(room: Room, state: LocalTrackState): Promise<LocalAudioTrack> {
  const settings = useAvSettingsStore.getState().settings;
  const { buildAudioPipeline } = await import('../audio/buildAudioPipeline');

  const pipelineArgs: { deviceId?: string; settings: typeof settings } = { settings };
  if (state.preferredDeviceId) pipelineArgs.deviceId = state.preferredDeviceId;
  const track = (await buildAudioPipeline(pipelineArgs)) as LocalAudioTrack;

  // Set content hint for speech
  try {
    const mst = (track as TrackLike).mediaStreamTrack;
    if (mst && 'contentHint' in mst) {
      mst.contentHint = 'speech';
    }
  } catch {}

  await room.localParticipant.publishTrack(
    track as unknown as LocalTrack,
    { source: 'microphone' } as unknown as Parameters<Room['localParticipant']['publishTrack']>[1],
  );
  return track;
}

async function publishFallbackMicrophoneTrack(room: Room, state: LocalTrackState): Promise<LocalAudioTrack> {
  const { createLocalAudioTrack } = await import('livekit-client');
  const audioOpts: {
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    deviceId?: string;
  } = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
  if (state.preferredDeviceId) {
    audioOpts.deviceId = state.preferredDeviceId;
  }
  const fallbackTrack = await createLocalAudioTrack(audioOpts);
  await room.localParticipant.publishTrack(
    fallbackTrack as unknown as LocalTrack,
    { source: 'microphone' } as unknown as Parameters<Room['localParticipant']['publishTrack']>[1],
  );
  return fallbackTrack;
}

export async function publishMicrophone({
  room,
  state,
  watchTrackEnded,
  onTrackPublished,
  onTrackEndedByBrowser,
}: PublishMicrophoneParams): Promise<void> {
  const existing = findLiveMicrophonePublication(room);
  if (existing) {
    state.track = existing;
    state.published = true;
    AVLogger.debug('track.mic.already_published');
    return;
  }

  if (state.published && state.track && isTrackLive(state.track)) {
    AVLogger.debug('track.mic.already_published');
    return;
  }

  const publishTimeoutMs = readTimeoutMs('VITE_MIC_PUBLISH_TIMEOUT_MS', 10_000);

  try {
    await unpublishNonLiveMicrophoneTracks(room);
    if (state.track) await unpublishMicrophone({ room, state, checkAllTracksUnpublished: () => {} });

    const track = await withPublishTimeout(buildAndPublishMicrophoneTrack(room, state), publishTimeoutMs);
    state.track = track;
    state.published = true;

    // Watch for track ended (browser can stop tracks)
    watchTrackEnded(track, onTrackEndedByBrowser);

    AVLogger.info('track.mic.published', {
      deviceId: state.preferredDeviceId,
    });

    onTrackPublished();
  } catch (error) {
    AVLogger.error('track.mic.publish_failed', { error: String(error) });

    // On timeout: rethrow immediately so upstream UI can react.
    // Skip the fallback path: it would just stack another 10s wait on a stuck signal.
    if ((error as Error)?.message === 'mic_publish_timeout') {
      throw error;
    }

    // Try to recover with permissions
    const hasPermission = await ensureAudioPermissions();
    if (hasPermission) {
      // Retry once
      try {
        const fallbackTrack = await withPublishTimeout(publishFallbackMicrophoneTrack(room, state), publishTimeoutMs);
        state.track = fallbackTrack;
        state.published = true;

        AVLogger.info('track.mic.published_fallback');
        onTrackPublished();
      } catch (retryError) {
        AVLogger.error('track.mic.publish_retry_failed', { error: String(retryError) });
        throw retryError;
      }
    } else {
      throw error;
    }
  }
}

type UnpublishMicrophoneParams = {
  room: Room;
  state: LocalTrackState;
  checkAllTracksUnpublished: () => void;
};

export async function unpublishMicrophone({
  room,
  state,
  checkAllTracksUnpublished,
}: UnpublishMicrophoneParams): Promise<void> {
  if (!state.track) {
    // Best-effort: also unpublish any lingering mic publications (state can desync on reconnect)
    try {
      const pubs = getLocalTrackPublications(room);
      for (const pub of pubs) {
        const src = readPubSource(pub);
        const kind = readPubKind(pub);
        const t = pub.track;
        if (!t) continue;
        if (kind === 'audio' && src === 'microphone') {
          try {
            const mst = t.mediaStreamTrack;
            if (typeof t.setEnabled === 'function') {
              t.setEnabled(false);
            } else if (mst) {
              mst.enabled = false;
            }
          } catch {}
          await room.localParticipant.unpublishTrack(t as unknown as LocalTrack);
          try {
            t.stop?.();
          } catch {}
        }
      }
    } catch {}
    state.published = false;
    checkAllTracksUnpublished();
    return;
  }

  try {
    // Disable track immediately for snappy UI
    try {
      const t = state.track as unknown as TrackLike;
      if (typeof t.setEnabled === 'function') {
        t.setEnabled(false);
      } else if (t.mediaStreamTrack) {
        t.mediaStreamTrack.enabled = false;
      }
    } catch {}

    await room.localParticipant.unpublishTrack(state.track as unknown as LocalTrack);
    (state.track as unknown as TrackLike).stop?.();
  } catch (error) {
    AVLogger.warn('track.mic.unpublish_error', { error: String(error) });
  }

  state.track = null;
  state.published = false;

  AVLogger.info('track.mic.unpublished');

  checkAllTracksUnpublished();
}

export async function ensureAudioPermissions(): Promise<boolean> {
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

// Sends an RTP-Mute-Frame via LiveKit without SDP renegotiation.
// Latency in the millisecond range instead of seconds (vs. unpublish/republish).
export async function softMuteMicrophone(track: LocalAudioTrack): Promise<void> {
  try {
    const t = track as unknown as TrackLike;
    if (typeof t.mute === 'function') {
      await t.mute();
    }
    const mst = t.mediaStreamTrack;
    if (mst) mst.enabled = false;
    AVLogger.info('track.mic.soft_muted');
  } catch (error) {
    AVLogger.warn('track.mic.soft_mute_error', { error: String(error) });
    throw error;
  }
}

// Unmute the microphone. Returns false when the underlying MediaStreamTrack
// is no longer live; the caller then falls back to a full republish path.
export async function softUnmuteMicrophone(track: LocalAudioTrack): Promise<boolean> {
  const t = track as unknown as TrackLike;
  const mst = t.mediaStreamTrack;
  if (mst && mst.readyState !== 'live') {
    AVLogger.info('track.mic.soft_unmute_skipped', { reason: 'track_not_live' });
    return false;
  }
  try {
    if (typeof t.unmute === 'function') {
      await t.unmute();
    }
    if (mst) mst.enabled = true;
    AVLogger.info('track.mic.soft_unmuted');
    return true;
  } catch (error) {
    AVLogger.warn('track.mic.soft_unmute_error', { error: String(error) });
    return false;
  }
}
