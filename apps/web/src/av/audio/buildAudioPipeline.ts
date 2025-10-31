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
  const track = await createLocalAudioTrack({
    deviceId,
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
    // sampleRate wird vom Browser/SDK bestmöglich gewählt; manche Browser ignorieren die Vorgabe
  } as any);
  return track;
}


