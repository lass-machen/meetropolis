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

function cleanupAudioGraph(nodes: AudioNode[], stream: MediaStream, ctx: AudioContext): void {
  try {
    nodes.forEach(n => {
      try {
        (n as any).disconnect?.();
      } catch {}
    });
  } catch {}
  try {
    stream.getTracks().forEach(t => {
      try {
        t.stop();
      } catch {}
    });
  } catch {}
  try {
    ctx.close();
  } catch {}
}

async function buildLightDspGraph(
  stream: MediaStream,
  enableHpf: boolean,
  enableCompressor: boolean,
  enableRnnoise: boolean
): Promise<{ track: MediaStreamTrack; cleanup: () => void; ctx: AudioContext; } | null> {
  const nodes: AudioNode[] = [];
  let ctx: AudioContext | null = null;

  try {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);
    nodes.push(source);

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

    // Optional: RNNoise Worklet (if present). Enabled only when requested.
    let rnnoiseNode: AudioWorkletNode | null = null;
    if (enableRnnoise) {
      try {
        if ((window as any).AudioWorkletNode && (ctx as any).audioWorklet) {
          await (ctx as any).audioWorklet.addModule('/assets/rnnoise.worklet.js');
          rnnoiseNode = new (window as any).AudioWorkletNode(ctx, 'rnnoise-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
          if (rnnoiseNode) {
            last.connect(rnnoiseNode as any);
            last = rnnoiseNode;
            nodes.push(rnnoiseNode);
          }
        }
      } catch {
        // ignore – not available by default
      }
    }

    const dest = ctx.createMediaStreamDestination();
    last.connect(dest);
    const track = dest.stream.getAudioTracks()[0];

    // Validate that we have a valid track
    if (!track) {
      cleanupAudioGraph(nodes, stream, ctx);
      return null;
    }

    const cleanup = () => {
      cleanupAudioGraph(nodes, stream, ctx!);
    };
    return { track, cleanup, ctx };
  } catch {
    if (ctx) {
      cleanupAudioGraph(nodes, stream, ctx);
    }
    return null;
  }
}

export async function buildAudioPipeline(params: BuildParams): Promise<MediaStreamTrack> {
  const { settings } = params;
  const constraints = buildAudioConstraints(params);

  // Capture mic via browser API (avoid wrapping in SDK to prevent structuredClone issues)
  const userStream = await navigator.mediaDevices.getUserMedia(constraints);

  const useClientIsolation = settings.clientVoiceIsolation === true;
  if (useClientIsolation || settings.highpassFilter || settings.compressor) {
    const dsp = await buildLightDspGraph(userStream, settings.highpassFilter, settings.compressor, useClientIsolation);
    if (dsp && dsp.track) {
      return dsp.track;
    }
    // If DSP graph failed, fall back to direct capture
  }

  // Direct path: return track captured by browser
  const rawTrack = userStream.getAudioTracks()[0];
  if (!rawTrack) {
    // This should not happen if getUserMedia succeeded, but handle gracefully
    throw new Error('No audio track found in media stream');
  }
  return rawTrack;
}


