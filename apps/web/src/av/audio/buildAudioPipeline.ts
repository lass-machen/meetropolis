import type { LocalAudioTrack } from 'livekit-client';
import type { AvSettings } from '../../state/avSettings';
import { AVLogger } from '../AVLogger';
import { VOICE_ISOLATION_TIMEOUT, createVoiceIsolationProcessor } from './voiceIsolation';
import type { TrackLike } from '../../types/livekit';

type BuildParams = {
  deviceId?: string;
  settings: AvSettings;
};

interface LivekitAudioModule {
  createLocalAudioTrack?: (constraints: AudioConstraintsLike) => Promise<LocalAudioTrack>;
  createLocalTracks?: (opts: { audio: AudioConstraintsLike }) => Promise<TrackLike[]>;
}

interface AudioConstraintsLike {
  deviceId?: string | undefined;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  channelCount?: number;
}

let livekitModulePromise: Promise<LivekitAudioModule> | null = null;

async function getLivekitModule(): Promise<LivekitAudioModule> {
  if (!livekitModulePromise) {
    livekitModulePromise = import('livekit-client').then(
      (m): LivekitAudioModule => m as unknown as LivekitAudioModule,
      (): LivekitAudioModule => ({}),
    );
  }
  return livekitModulePromise;
}

function detectIsApple(): boolean {
  try {
    const ua = navigator?.userAgent || '';
    return /Macintosh|Mac OS X|iPhone|iPad/i.test(ua);
  } catch {
    return false;
  }
}

function detectSupportsNoiseSuppression(): boolean {
  try {
    const c = navigator?.mediaDevices?.getSupportedConstraints?.();
    return !!(c && c.noiseSuppression);
  } catch {
    return false;
  }
}

async function createAudioTrack(constraints: AudioConstraintsLike): Promise<LocalAudioTrack | TrackLike> {
  const mod = await getLivekitModule();
  let createLocalAudioTrack: LivekitAudioModule['createLocalAudioTrack'];
  try {
    createLocalAudioTrack = mod.createLocalAudioTrack;
  } catch {
    createLocalAudioTrack = undefined;
  }
  if (typeof createLocalAudioTrack === 'function') {
    return await createLocalAudioTrack(constraints);
  }

  let createLocalTracks: LivekitAudioModule['createLocalTracks'];
  try {
    createLocalTracks = mod.createLocalTracks;
  } catch {
    createLocalTracks = undefined;
  }
  if (typeof createLocalTracks === 'function') {
    const tracks = await createLocalTracks({ audio: constraints });
    const found = tracks.find((t) => {
      const kindStr = String(t?.kind ?? '');
      const mstKindStr = String(t?.mediaStreamTrack?.kind ?? '');
      return kindStr === 'audio' || mstKindStr === 'audio';
    });
    return found || tracks[0];
  }
  throw new Error('No LiveKit audio creation API available');
}

function buildAudioConstraints(
  deviceId: string | undefined,
  settings: AvSettings,
  noiseSuppression: boolean,
): AudioConstraintsLike {
  return {
    deviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
  };
}

async function applyVoiceIsolation(
  first: TrackLike,
  deviceId: string | undefined,
  settings: AvSettings,
): Promise<TrackLike | LocalAudioTrack> {
  const processor = createVoiceIsolationProcessor();
  try {
    if (typeof first.setProcessor !== 'function') throw new Error('processor API unavailable');
    // LocalAudioTrack.setProcessor() requires an AudioContext on the track;
    // before publish none is set, so hand over the processor-owned one.
    first.setAudioContext?.(processor.audioContext);
    await first.setProcessor(processor);
    return first;
  } catch (error) {
    try {
      await processor.destroy();
    } catch {}
    if ((error as Error)?.message === VOICE_ISOLATION_TIMEOUT) {
      // The worklet did not come up in time. Publish the raw capture (no
      // voice isolation) instead of stacking another getUserMedia on the
      // publish budget.
      AVLogger.warn('track.mic.voice_isolation_fallback', { reason: 'timeout' });
      return first;
    }
    AVLogger.warn('track.mic.voice_isolation_fallback', { reason: 'error' });
    try {
      first?.stop?.();
    } catch {}
    return await createAudioTrack(buildAudioConstraints(deviceId, settings, true));
  }
}

export async function buildAudioPipeline(params: BuildParams): Promise<TrackLike | LocalAudioTrack> {
  const { deviceId, settings } = params;
  const wantsNoiseSuppression = !!settings.noiseSuppression;
  const isApple = detectIsApple();
  const supportsNoiseSuppression = detectSupportsNoiseSuppression();

  // Prefer Apple platforms: use native NS/EC/AGC when available.
  if (wantsNoiseSuppression && isApple && supportsNoiseSuppression) {
    const nativeTrack = await createAudioTrack(buildAudioConstraints(deviceId, settings, true));
    try {
      const mst = (nativeTrack as TrackLike)?.mediaStreamTrack;
      if (mst && 'contentHint' in mst) {
        try {
          mst.contentHint = 'speech';
        } catch {}
      }
    } catch {}
    return nativeTrack;
  }

  // Default: capture without browser NS first, then optionally process via worklet.
  const first = (await createAudioTrack(buildAudioConstraints(deviceId, settings, false))) as TrackLike;

  if (!wantsNoiseSuppression) return first;

  return applyVoiceIsolation(first, deviceId, settings);
}
