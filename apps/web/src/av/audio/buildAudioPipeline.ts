import type { AvSettings } from '../../state/avSettings';

type BuildParams = {
  deviceId?: string | '';
  settings: AvSettings;
};

// (unused legacy helper removed)

// (legacy cleanup helper removed)

// (legacy DSP helper removed)

export async function buildAudioPipeline(params: BuildParams): Promise<any> {
  const { deviceId, settings } = params;
  // Verwende das LiveKit-SDK zur Trackerzeugung mit expliziten Constraints,
  // um maximale Kompatibilität (Opus/Encoding/Clocks) sicherzustellen.
  const { createLocalAudioTrack } = await import('livekit-client');
  // Voice Isolation: baue eine WebAudio-Chain und ersetze die Track-Quelle,
  // um doppelte Noise Suppression zu vermeiden.
  if ((settings as any).clientVoiceIsolation) {
    // 1. Capture ohne Browser-NS (AEC/AGC bleiben an)
    const first = await createLocalAudioTrack({
      deviceId,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: false,
      autoGainControl: settings.autoGainControl,
      channelCount: settings.channelCount,
    } as any);
    try {
      const { wrapTrackWithVoiceIsolation } = await import('./voiceIsolation');
      const mst: any = (first as any)?.mediaStreamTrack;
      const processed: MediaStreamTrack = await wrapTrackWithVoiceIsolation(mst);
      try { await (first as any)?.replaceTrack?.(processed); } catch {}
      return first;
    } catch (_e) {
      // 2. Fallback: ursprünglichen Track stoppen und mit Browser-NS neu erzeugen
      try { (first as any)?.stop?.(); } catch {}
      const fallback = await createLocalAudioTrack({
        deviceId,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        channelCount: settings.channelCount,
      } as any);
      return fallback;
    }
  }
  // Standardpfad: Browser-NS/EC/AGC verwenden
  const track = await createLocalAudioTrack({
    deviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
  } as any);
  return track;
}


