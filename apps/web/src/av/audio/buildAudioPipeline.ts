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
  // Apple priorisieren: native NS/EC/AGC nutzen, wenn verfügbar
  const isApple = (() => {
    try { const ua = (navigator as any)?.userAgent || ''; return /Macintosh|Mac OS X|iPhone|iPad/i.test(ua); } catch { return false; }
  })();
  const supportsNs = (() => {
    try { const c = (navigator as any)?.mediaDevices?.getSupportedConstraints?.(); return !!(c && c.noiseSuppression); } catch { return false; }
  })();
  if (isApple && supportsNs) {
    const nativeTrack = await createLocalAudioTrack({
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
  // Voice Isolation immer versuchen: erst ohne Browser-NS capturen und per Worklet verarbeiten.
  // Bei Fehler/fehlender Unterstützung: Fallback auf Browser-NS/EC/AGC.
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
    try { (first as any)?.stop?.(); } catch {}
    const fallback = await createLocalAudioTrack({
      deviceId,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: true,
      autoGainControl: settings.autoGainControl,
      channelCount: settings.channelCount,
    } as any);
    return fallback;
  }
}


