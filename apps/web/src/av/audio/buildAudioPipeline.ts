import type { AvSettings } from '../../state/avSettings';

type BuildParams = {
  deviceId?: string | '';
  settings: AvSettings;
};

function buildAudioConstraints(params: BuildParams): MediaStreamConstraints {
  const { deviceId, settings } = params;
  const base: any = {
    noiseSuppression: settings.noiseSuppression,
    echoCancellation: settings.echoCancellation,
    autoGainControl: settings.autoGainControl,
    channelCount: settings.channelCount,
  };
  // Some browsers support specifying ideal sampleRate/channelCount
  (base as any).sampleRate = { ideal: settings.sampleRate };
  if (deviceId) (base as any).deviceId = deviceId;
  return { audio: base, video: false } as MediaStreamConstraints;
}

async function buildLightDspGraph(stream: MediaStream, enableHpf: boolean, enableCompressor: boolean): Promise<{ track: MediaStreamTrack; cleanup: () => void; ctx: AudioContext; } | null> {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);

    const nodes: AudioNode[] = [source];

    let last: AudioNode = source;
    let hpf: BiquadFilterNode | null = null;
    if (enableHpf) {
      hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.value = 120; // cut rumble
      last.connect(hpf);
      last = hpf;
      nodes.push(hpf);
    }

    let comp: DynamicsCompressorNode | null = null;
    if (enableCompressor) {
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 24;
      comp.ratio.value = 3;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      last.connect(comp);
      last = comp;
      nodes.push(comp);
    }

    // Optional: RNNoise Worklet (if present). Fails gracefully.
    let rnnoiseNode: AudioWorkletNode | null = null;
    try {
      if ((window as any).AudioWorkletNode && ctx.audioWorklet) {
        // Expect worklet at /assets/rnnoise.worklet.js if supplied
        await ctx.audioWorklet.addModule('/assets/rnnoise.worklet.js');
        rnnoiseNode = new AudioWorkletNode(ctx, 'rnnoise-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        last.connect(rnnoiseNode);
        last = rnnoiseNode;
        nodes.push(rnnoiseNode);
      }
    } catch {
      // ignore – not available in local setup by default
    }

    const dest = ctx.createMediaStreamDestination();
    last.connect(dest);
    const track = dest.stream.getAudioTracks()[0];

    const cleanup = () => {
      try { nodes.forEach(n => { try { (n as any).disconnect?.(); } catch {} }); } catch {}
      try { stream.getTracks().forEach(t => { try { t.stop(); } catch {} }); } catch {}
      try { ctx.close(); } catch {}
    };
    return { track, cleanup, ctx };
  } catch {
    return null;
  }
}

export async function buildAudioPipeline(params: BuildParams) {
  const { settings } = params;
  const constraints = buildAudioConstraints(params);

  // Try to capture mic
  let userStream: MediaStream | null = null;
  try {
    userStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // Fallback: let LiveKit capture with its internals
    const { createLocalAudioTrack } = await import('livekit-client');
    return await createLocalAudioTrack({ deviceId: params.deviceId } as any);
  }

  const useClientIsolation = settings.clientVoiceIsolation === true;
  if (useClientIsolation || settings.highpassFilter || settings.compressor) {
    const dsp = await buildLightDspGraph(userStream, settings.highpassFilter, settings.compressor);
    if (dsp && dsp.track) {
      const { createLocalAudioTrack } = await import('livekit-client');
      // create from processed MediaStreamTrack
      const lkTrack = await createLocalAudioTrack(dsp.track as any);
      // Attach cleanup so that stopping the local track cleans resources
      try { (lkTrack as any)._meetropolisCleanup = dsp.cleanup; } catch {}
      return lkTrack;
    }
    // If DSP graph failed, fall back to direct capture
  }

  // Direct path: return track captured by browser
  const { createLocalAudioTrack } = await import('livekit-client');
  const rawTrack = userStream.getAudioTracks()[0];
  return await createLocalAudioTrack(rawTrack as any);
}


