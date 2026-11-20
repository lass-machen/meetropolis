// Resolves the raw capture MediaStreamTrack of a local audio track. With the
// voice isolation processor attached, `mediaStreamTrack` is the processed
// WebAudio destination track, which stays live after the device is gone;
// end-of-capture detection must watch the raw track instead.

/** Processor name shared with audio/voiceIsolation.ts. */
export const VOICE_ISOLATION_PROCESSOR_NAME = 'voice-isolation';

type CaptureTrackSource = {
  mediaStreamTrack?: MediaStreamTrack;
  getProcessor?: () => unknown;
};

export function readCaptureTrack(track: CaptureTrackSource): MediaStreamTrack | undefined {
  try {
    const processor = track.getProcessor?.() as { name?: string; sourceTrack?: MediaStreamTrack } | undefined;
    if (processor?.name === VOICE_ISOLATION_PROCESSOR_NAME && processor.sourceTrack) {
      return processor.sourceTrack;
    }
  } catch {}
  return track.mediaStreamTrack;
}
