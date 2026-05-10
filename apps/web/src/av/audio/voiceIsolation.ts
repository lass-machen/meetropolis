// Lightweight wrapper to build a WebAudio graph and return a processed MediaStreamTrack
// The actual RNNoise processing is encapsulated in an AudioWorklet processor file.

export async function wrapTrackWithVoiceIsolation(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
  if (typeof window.AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet not supported');
  }

  const audioContext = new (window.AudioContext || window.webkitAudioContext!)();
  const onInputEnded = () => {
    try {
      void audioContext.close();
    } catch {}
    try {
      inputTrack.removeEventListener('ended', onInputEnded);
    } catch {}
  };
  try {
    inputTrack.addEventListener('ended', onInputEnded);
  } catch {}

  const mediaStream = new MediaStream([inputTrack]);
  const source = audioContext.createMediaStreamSource(mediaStream);

  // Load worklet module (bundled locally)
  const url = new URL('./worklets/rnnoise-processor.js', import.meta.url).toString();
  await (audioContext as any).audioWorklet.addModule(url);

  // Graph: source -> highpass -> rnnoise(gate) -> limiter -> destination
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
  // Soft-Limiter, erhält Sprache, verhindert Clipping
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

  const processed = destination.stream.getAudioTracks()[0];
  // Ensure mono speech hint when supported
  try {
    if ('contentHint' in processed) (processed as any).contentHint = 'speech';
  } catch {}
  return processed;
}
