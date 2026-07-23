// Lightweight wrapper to build a WebAudio graph and return a processed MediaStreamTrack
// The actual RNNoise processing is encapsulated in an AudioWorklet processor file.

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
): { onInputEnded: () => void; stopSource: () => void } {
  let contextClosed = false;
  const closeContext = () => {
    if (contextClosed) return;
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
  return { onInputEnded, stopSource };
}

/**
 * Wires the denoise/limiter graph: source -> highpass -> rnnoise(gate) ->
 * limiter -> destination. Returns the destination node whose stream carries
 * the processed track.
 */
function buildDenoiseGraph(
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
): MediaStreamAudioDestinationNode {
  const highpass = audioContext.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 100; // rumble/low HVAC entfernen
  highpass.Q.value = 0.707;

  const rnnoise = new window.AudioWorkletNode(audioContext, 'rnnoise-processor');
  try {
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

  source.connect(highpass);
  highpass.connect(rnnoise);
  rnnoise.connect(limiter);
  limiter.connect(destination);

  return destination;
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

export async function wrapTrackWithVoiceIsolation(inputTrack: MediaStreamTrack): Promise<VoiceIsolationResult> {
  if (typeof window.AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet not supported');
  }

  const audioContext = new (window.AudioContext || window.webkitAudioContext!)();
  const { onInputEnded, stopSource } = createTeardown(inputTrack, audioContext);
  try {
    inputTrack.addEventListener('ended', onInputEnded);
  } catch {}

  const mediaStream = new MediaStream([inputTrack]);
  const source = audioContext.createMediaStreamSource(mediaStream);

  // Load worklet module (bundled locally)
  const url = new URL('./worklets/rnnoise-processor.js', import.meta.url).toString();
  await audioContext.audioWorklet.addModule(url);

  const destination = buildDenoiseGraph(audioContext, source);
  const processed = destination.stream.getAudioTracks()[0];
  applySpeechContentHint(processed);

  return { processed, stopSource };
}
