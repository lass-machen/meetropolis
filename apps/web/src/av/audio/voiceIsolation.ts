// Lightweight wrapper to build a WebAudio graph and return a processed MediaStreamTrack
// The actual RNNoise processing is encapsulated in an AudioWorklet processor file.

export async function wrapTrackWithVoiceIsolation(inputTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
  if (typeof (window as any).AudioWorkletNode === 'undefined') {
    throw new Error('AudioWorklet not supported');
  }

  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const onInputEnded = () => {
    try { audioContext.close(); } catch {}
    try { inputTrack.removeEventListener('ended', onInputEnded); } catch {}
  };
  try { inputTrack.addEventListener('ended', onInputEnded); } catch {}

  const mediaStream = new MediaStream([inputTrack]);
  const source = audioContext.createMediaStreamSource(mediaStream);

  // Load worklet module (bundled locally)
  const url = new URL('./worklets/rnnoise-processor.js', import.meta.url).toString();
  await (audioContext as any).audioWorklet.addModule(url);

  // Build minimal chain: source -> rnnoise -> destination
  const rnnoise = new (window as any).AudioWorkletNode(audioContext, 'rnnoise-processor');
  const destination = audioContext.createMediaStreamDestination();

  source.connect(rnnoise as any);
  (rnnoise as any).connect(destination);

  const processed = destination.stream.getAudioTracks()[0];
  // Ensure mono speech hint when supported
  try { if ('contentHint' in processed) (processed as any).contentHint = 'speech'; } catch {}
  return processed;
}


