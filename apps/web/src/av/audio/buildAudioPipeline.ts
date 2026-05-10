import type { AvSettings } from '../../state/avSettings';
import { wrapTrackWithVoiceIsolation } from './voiceIsolation';

type BuildParams = {
  deviceId?: string;
  settings: AvSettings;
};

let livekitModulePromise: Promise<any> | null = null;

async function getLivekitModule(): Promise<any> {
  if (!livekitModulePromise) {
    livekitModulePromise = import('livekit-client').catch(() => ({}));
  }
  return livekitModulePromise;
}

function detectIsApple(): boolean {
  try {
    const ua = (navigator as any)?.userAgent || '';
    return /Macintosh|Mac OS X|iPhone|iPad/i.test(ua);
  } catch {
    return false;
  }
}

function detectSupportsNoiseSuppression(): boolean {
  try {
    const c = (navigator as any)?.mediaDevices?.getSupportedConstraints?.();
    return !!(c && c.noiseSuppression);
  } catch {
    return false;
  }
}

async function createAudioTrack(constraints: any): Promise<any> {
  const mod: any = await getLivekitModule();
  let createLocalAudioTrack: any;
  try {
    createLocalAudioTrack = mod?.createLocalAudioTrack;
  } catch {
    createLocalAudioTrack = undefined;
  }
  if (typeof createLocalAudioTrack === 'function') {
    return await createLocalAudioTrack(constraints);
  }

  let createLocalTracks: any;
  try {
    createLocalTracks = mod?.createLocalTracks;
  } catch {
    createLocalTracks = undefined;
  }
  if (typeof createLocalTracks === 'function') {
    const tracks: any[] = await createLocalTracks({ audio: constraints });
    return tracks.find((t: any) => t?.kind === 'audio' || t?.mediaStreamTrack?.kind === 'audio') || tracks[0];
  }
  throw new Error('No LiveKit audio creation API available');
}

function buildAudioConstraints(deviceId: string | undefined, settings: AvSettings, noiseSuppression: boolean): any {
  return {
    deviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
  };
}

async function applyVoiceIsolationFallback(
  first: any,
  deviceId: string | undefined,
  settings: AvSettings,
): Promise<any> {
  try {
    const mst: any = first?.mediaStreamTrack;
    const processed: MediaStreamTrack = await wrapTrackWithVoiceIsolation(mst);
    try {
      await first?.replaceTrack?.(processed);
    } catch {}
    return first;
  } catch {
    try {
      first?.stop?.();
    } catch {}
    return await createAudioTrack(buildAudioConstraints(deviceId, settings, true));
  }
}

export async function buildAudioPipeline(params: BuildParams): Promise<any> {
  const { deviceId, settings } = params;
  const wantsNoiseSuppression = !!settings.noiseSuppression;
  const isApple = detectIsApple();
  const supportsNoiseSuppression = detectSupportsNoiseSuppression();

  // Apple priorisieren: native NS/EC/AGC nutzen, wenn verfügbar
  if (wantsNoiseSuppression && isApple && supportsNoiseSuppression) {
    const nativeTrack = await createAudioTrack(buildAudioConstraints(deviceId, settings, true));
    try {
      const mst: any = nativeTrack?.mediaStreamTrack;
      if (mst && 'contentHint' in mst) {
        try {
          mst.contentHint = 'speech';
        } catch {}
      }
    } catch {}
    return nativeTrack;
  }

  // Standard: erst ohne Browser-NS capturen und optional via Worklet verarbeiten.
  const first = await createAudioTrack(buildAudioConstraints(deviceId, settings, false));

  if (!wantsNoiseSuppression) return first;

  return applyVoiceIsolationFallback(first, deviceId, settings);
}
