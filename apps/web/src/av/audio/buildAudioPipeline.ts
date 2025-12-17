import type { AvSettings } from '../../state/avSettings';
import { wrapTrackWithVoiceIsolation } from './voiceIsolation';

type BuildParams = {
  deviceId?: string | '';
  settings: AvSettings;
};

let livekitModulePromise: Promise<any> | null = null;

async function getLivekitModule(): Promise<any> {
  if (!livekitModulePromise) {
    livekitModulePromise = import('livekit-client').catch(() => ({}));
  }
  return livekitModulePromise;
}

export async function buildAudioPipeline(params: BuildParams): Promise<any> {
  const { deviceId, settings } = params;
  const wantsNoiseSuppression = !!settings.noiseSuppression;

  const isApple = (() => {
    try {
      const ua = (navigator as any)?.userAgent || '';
      return /Macintosh|Mac OS X|iPhone|iPad/i.test(ua);
    } catch {
      return false;
    }
  })();

  const supportsNoiseSuppression = (() => {
    try {
      const c = (navigator as any)?.mediaDevices?.getSupportedConstraints?.();
      return !!(c && c.noiseSuppression);
    } catch {
      return false;
    }
  })();

  const createAudio = async (constraints: any) => {
    const mod: any = await getLivekitModule();
    let createLocalAudioTrack: any;
    try { createLocalAudioTrack = mod?.createLocalAudioTrack; } catch { createLocalAudioTrack = undefined; }
    if (typeof createLocalAudioTrack === 'function') {
      return await createLocalAudioTrack(constraints);
    }

    let createLocalTracks: any;
    try { createLocalTracks = mod?.createLocalTracks; } catch { createLocalTracks = undefined; }
    if (typeof createLocalTracks === 'function') {
      const tracks: any[] = await createLocalTracks({ audio: constraints });
      return tracks.find((t: any) => (t?.kind === 'audio') || (t?.mediaStreamTrack?.kind === 'audio')) || tracks[0];
    }
    throw new Error('No LiveKit audio creation API available');
  };

  // Apple priorisieren: native NS/EC/AGC nutzen, wenn verfügbar
  if (wantsNoiseSuppression && isApple && supportsNoiseSuppression) {
    const nativeTrack = await createAudio({
      deviceId,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: true,
      autoGainControl: settings.autoGainControl,
      channelCount: settings.channelCount,
    } as any);
    try {
      const mst: any = (nativeTrack as any)?.mediaStreamTrack;
      if (mst && 'contentHint' in mst) { try { mst.contentHint = 'speech'; } catch {} }
    } catch {}
    return nativeTrack;
  }

  // Standard: erst ohne Browser-NS capturen und optional via Worklet verarbeiten.
  const first = await createAudio({
    deviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: false,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
  } as any);

  if (!wantsNoiseSuppression) return first;

  try {
    const mst: any = (first as any)?.mediaStreamTrack;
    const processed: MediaStreamTrack = await wrapTrackWithVoiceIsolation(mst);
    try { await (first as any)?.replaceTrack?.(processed); } catch {}
    return first;
  } catch {
    try { (first as any)?.stop?.(); } catch {}
    return await createAudio({
      deviceId,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: true,
      autoGainControl: settings.autoGainControl,
      channelCount: settings.channelCount,
    } as any);
  }
}
