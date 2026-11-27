// Lightweight wrapper to build a WebAudio graph and return a processed MediaStreamTrack
// The actual RNNoise processing is encapsulated in an AudioWorklet processor file.

import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import { VOICE_ISOLATION_PROCESSOR_NAME } from './captureTrack';

/**
 * Upper bound for loading the worklet module. A local ~4 KB module loads in
 * well under 100 ms; 3 s leaves ample margin while keeping most of the 10 s
 * microphone publish budget for getUserMedia and the publish itself.
 */
export const VOICE_ISOLATION_INIT_TIMEOUT_MS = 3_000;

/** Error message used when the worklet init exceeds its time bound. */
export const VOICE_ISOLATION_TIMEOUT = 'voice_isolation_timeout';

export interface VoiceIsolationResult {
  processed: MediaStreamTrack;
  /**
   * Stops the raw capture MediaStreamTrack and closes the AudioContext.
   * The published track (`processed`) is a WebAudio destination track, not
   * the hardware capture track itself; stopping only `processed` would
   * leave the microphone open. Idempotent: safe to call multiple times,
   * including after the input track already ended on its own (e.g. device
   * unplugged), and safe to call even if the graph was never fully wired.
   */
  stopSource: () => void;
  /** Releases the graph but leaves the input track running. */
  release: () => void;
}

/**
 * Builds the idempotent teardown pair for a wrapped track: `onInputEnded`
 * (wired to the input track's native 'ended' event) and `stopSource` (the
 * explicit teardown handle returned to callers). Both funnel through the
 * same `closeContext` guard so the AudioContext is only ever closed once,
 * regardless of which path triggers first.
 */
function createTeardown(
  inputTrack: MediaStreamTrack,
  audioContext: AudioContext,
  ownsContext: boolean,
): { onInputEnded: () => void; stopSource: () => void; release: () => void } {
  let contextClosed = false;
  const closeContext = () => {
    // A context passed in by the caller is closed by its owner.
    if (contextClosed || !ownsContext) return;
    contextClosed = true;
    try {
      void audioContext.close();
    } catch {}
  };
  const onInputEnded = () => {
    closeContext();
    try {
      inputTrack.removeEventListener('ended', onInputEnded);
    } catch {}
  };
  const stopSource = () => {
    // Calling stop() on an already-ended track is a documented no-op, so
    // this is safe even if onInputEnded already fired.
    try {
      inputTrack.stop();
    } catch {}
    try {
      inputTrack.removeEventListener('ended', onInputEnded);
    } catch {}
    closeContext();
  };
  // Releases the graph but leaves the input track running, so a caller can
  // still fall back to the raw capture.
  const release = () => {
    try {
      inputTrack.removeEventListener('ended', onInputEnded);
    } catch {}
    closeContext();
  };
  return { onInputEnded, stopSource, release };
}

interface DenoiseGraph {
  /** Destination node whose stream carries the processed track. */
  destination: MediaStreamAudioDestinationNode;
  /**
   * Disconnects every node and stops the gate worklet. Needed when the
   * AudioContext outlives the graph (shared processor context): closing the
   * context would otherwise be the only thing that stops the old chain.
   */
  dispose: () => void;
}

/** Message the gate worklet answers by returning `false` from `process()`. */
const GATE_DISPOSE_MESSAGE = { type: 'dispose' } as const;

/** Cutoff of the rumble highpass, in the gate worklet and in its fallback. */
const HIGHPASS_HZ = 100;
/** Q of the rumble highpass, in dB as BiquadFilterNode interprets it for 'highpass'. */
const HIGHPASS_Q = 0.707;

/**
 * Wires the denoise/limiter graph: source -> rnnoise(highpass + gate) ->
 * limiter -> destination. The highpass runs inside the worklet, behind its
 * non-finite sample guard: a native BiquadFilterNode in front of the gate
 * would keep a single NaN or Infinity from the source in its recursive state
 * and output NaN for good, muting the microphone.
 */
function buildDenoiseGraph(audioContext: AudioContext, source: MediaStreamAudioSourceNode): DenoiseGraph {
  const rnnoise = new window.AudioWorkletNode(audioContext, 'rnnoise-processor');
  try {
    rnnoise.parameters.get('highpassHz')?.setValueAtTime(HIGHPASS_HZ, audioContext.currentTime);
    rnnoise.parameters.get('highpassQ')?.setValueAtTime(HIGHPASS_Q, audioContext.currentTime);
    rnnoise.parameters.get('threshold')?.setValueAtTime(-56, audioContext.currentTime);
    rnnoise.parameters.get('ratio')?.setValueAtTime(0.25, audioContext.currentTime);
    rnnoise.parameters.get('attackMs')?.setValueAtTime(10, audioContext.currentTime);
    rnnoise.parameters.get('releaseMs')?.setValueAtTime(100, audioContext.currentTime);
    rnnoise.parameters.get('makeupGainDb')?.setValueAtTime(0, audioContext.currentTime);
  } catch {}

  const limiter = audioContext.createDynamicsCompressor();
  // Soft limiter: preserves voice while preventing clipping.
  limiter.threshold.value = -3;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.05;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(rnnoise);
  rnnoise.connect(limiter);
  limiter.connect(destination);
  const bypass = bypassGateOnProcessorError(audioContext, rnnoise, source, limiter);

  return { destination, dispose: createGraphDisposer(rnnoise, bypass, [source, limiter]) };
}

/** Idempotent teardown for one denoise graph; see {@link DenoiseGraph.dispose}. */
function createGraphDisposer(gate: AudioWorkletNode, bypass: GateBypass, nodes: AudioNode[]): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    // A late processorerror of the old gate must not build a fallback for a
    // graph that is already gone.
    gate.removeEventListener('processorerror', bypass.onProcessorError);
    // disconnect() without arguments drops all outgoing connections and
    // never throws, including the bypass edge source -> fallback highpass.
    for (const node of nodes) node.disconnect();
    bypass.fallbackHighpass()?.disconnect();
    gate.disconnect();
    // process() keeps returning true while the node lives, so a disconnected
    // gate would keep running until the context closes; tell it to stop.
    gate.port.postMessage(GATE_DISPOSE_MESSAGE);
  };
}

// Chromium dispatches an ErrorEvent carrying the thrown message; the spec
// only guarantees a plain Event.
function processorErrorMessage(event: Event): string | undefined {
  const message = (event as Partial<ErrorEvent>).message;
  return typeof message === 'string' ? message : undefined;
}

function createRumbleHighpass(audioContext: AudioContext): BiquadFilterNode {
  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = HIGHPASS_HZ;
  highpass.Q.value = HIGHPASS_Q;
  return highpass;
}

interface GateBypass {
  /** The once-listener on the gate's `processorerror`. */
  onProcessorError: (event: Event) => void;
  /** The fallback highpass, once a processor error created it. */
  fallbackHighpass: () => BiquadFilterNode | undefined;
}

/**
 * A worklet that throws (in its constructor or in `process()`) fires
 * `processorerror` once and outputs silence for the rest of its life, while
 * the published destination track stays live: the microphone goes silently
 * mute. Route around the gate instead: source -> fallback highpass ->
 * limiter -> destination. The fallback is a new native BiquadFilterNode with
 * a fresh filter state and the worklet's highpass settings, so the published
 * track keeps carrying the highpassed, limited raw signal. Both remaining
 * nodes are native and cannot fail this way; the published track and the
 * LiveKit publication stay untouched.
 */
function bypassGateOnProcessorError(
  audioContext: AudioContext,
  gate: AudioWorkletNode,
  source: AudioNode,
  limiter: AudioNode,
): GateBypass {
  let fallbackHighpass: BiquadFilterNode | undefined;
  const onProcessorError = (event: Event) => {
    // Restore the signal path first; a dead worklet only contributes silence
    // to the sum until it is disconnected below.
    const highpass = createRumbleHighpass(audioContext);
    fallbackHighpass = highpass;
    source.connect(highpass);
    highpass.connect(limiter);
    let detached = true;
    try {
      source.disconnect(gate);
      gate.disconnect();
    } catch {
      // Only throws if the gate was already detached; the bypass is live either way.
      detached = false;
    }
    AVLogger.warn('track.mic.voice_isolation_fallback', {
      reason: 'processor_error',
      detached,
      error: processorErrorMessage(event),
    });
  };
  gate.addEventListener('processorerror', onProcessorError, { once: true });
  return { onProcessorError, fallbackHighpass: () => fallbackHighpass };
}

// `contentHint` is part of the MediaStreamTrack WebRTC spec but is still
// flagged as experimental in lib.dom; a typed view of the writable field
// keeps the feature-detect intact without an `any` escape hatch.
function applySpeechContentHint(track: MediaStreamTrack): void {
  try {
    if ('contentHint' in track) {
      (track as MediaStreamTrack & { contentHint: string }).contentHint = 'speech';
    }
  } catch {}
}

/**
 * Loads the gate worklet module (bundled locally) and rejects with
 * {@link VOICE_ISOLATION_TIMEOUT} if it does not settle within
 * `initTimeoutMs`. Cleaning up the half-built graph is left to the caller.
 */
async function loadGateModule(audioContext: AudioContext, initTimeoutMs: number): Promise<void> {
  const url = new URL('./worklets/rnnoise-processor.js', import.meta.url).toString();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      audioContext.audioWorklet.addModule(url),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(VOICE_ISOLATION_TIMEOUT)), initTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function wrapTrackWithVoiceIsolation(
  inputTrack: MediaStreamTrack,
  options: { initTimeoutMs?: number; audioContext?: AudioContext } = {},
): Promise<VoiceIsolationResult> {
  const initTimeoutMs = options.initTimeoutMs ?? VOICE_ISOLATION_INIT_TIMEOUT_MS;
  if (typeof window.AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet not supported');
  }

  const ownsContext = !options.audioContext;
  const audioContext = options.audioContext ?? createAudioContext();
  const { onInputEnded, stopSource, release } = createTeardown(inputTrack, audioContext, ownsContext);
  try {
    inputTrack.addEventListener('ended', onInputEnded);
  } catch {}

  const mediaStream = new MediaStream([inputTrack]);
  const source = audioContext.createMediaStreamSource(mediaStream);

  try {
    await loadGateModule(audioContext, initTimeoutMs);
  } catch (error) {
    release();
    throw error;
  }

  const graph = buildDenoiseGraph(audioContext, source);
  const processed = graph.destination.stream.getAudioTracks()[0];
  applySpeechContentHint(processed);

  return {
    processed,
    stopSource: () => {
      graph.dispose();
      stopSource();
    },
    release: () => {
      graph.dispose();
      release();
    },
  };
}

function createAudioContext(): AudioContext {
  return new (window.AudioContext || window.webkitAudioContext!)();
}

// processedTrack is a getter that reads undefined until init succeeds, which
// the optional SDK field cannot express under exactOptionalPropertyTypes.
export type VoiceIsolationProcessor = Omit<
  TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>,
  'processedTrack'
> & {
  readonly processedTrack: MediaStreamTrack | undefined;
  /** AudioContext owned by this processor; set it on the track before setProcessor(). */
  readonly audioContext: AudioContext;
  /** Raw capture track the current graph reads from. */
  readonly sourceTrack: MediaStreamTrack | undefined;
};

/**
 * Voice isolation as a LiveKit track processor. LiveKit publishes
 * `processedTrack` instead of the raw capture, re-runs `restart` with the new
 * raw track on device switches, and calls `destroy` on stop. The raw track
 * stays owned by LiveKit; this processor never stops it. One AudioContext
 * lives for the whole processor lifetime and is closed in `destroy`.
 */
export function createVoiceIsolationProcessor(
  initTimeoutMs: number = VOICE_ISOLATION_INIT_TIMEOUT_MS,
): VoiceIsolationProcessor {
  let audioContext: AudioContext | null = null;
  let graph: {
    processed: MediaStreamTrack;
    release: () => void;
    source: MediaStreamTrack;
    onEnded: () => void;
  } | null = null;

  const ensureContext = (): AudioContext => {
    audioContext ??= createAudioContext();
    return audioContext;
  };

  const teardownGraph = () => {
    const current = graph;
    graph = null;
    if (!current) return;
    try {
      current.source.removeEventListener('ended', current.onEnded);
    } catch {}
    current.release();
    try {
      current.processed.stop();
    } catch {}
  };

  const build = async (track: MediaStreamTrack) => {
    teardownGraph();
    const result = await wrapTrackWithVoiceIsolation(track, { initTimeoutMs, audioContext: ensureContext() });
    // When the device goes away the destination track would stay live; end it
    // too so liveness checks on the published track see the loss.
    const onEnded = () => {
      try {
        result.processed.stop();
      } catch {}
    };
    try {
      track.addEventListener('ended', onEnded);
    } catch {}
    graph = { processed: result.processed, release: result.release, source: track, onEnded };
  };

  return {
    name: VOICE_ISOLATION_PROCESSOR_NAME,
    get audioContext() {
      return ensureContext();
    },
    get processedTrack() {
      return graph?.processed;
    },
    get sourceTrack() {
      return graph?.source;
    },
    init: async (opts) => build(opts.track),
    restart: async (opts) => build(opts.track),
    destroy: async () => {
      teardownGraph();
      const context = audioContext;
      audioContext = null;
      if (context) {
        try {
          await context.close();
        } catch {}
      }
    },
  };
}
