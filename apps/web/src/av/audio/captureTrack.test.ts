import { describe, it, expect } from 'vitest';

import { VOICE_ISOLATION_PROCESSOR_NAME, readCaptureTrack } from './captureTrack';

describe('readCaptureTrack', () => {
  it('returns the raw capture track when the voice isolation processor is attached', () => {
    const raw = { id: 'raw' } as unknown as MediaStreamTrack;
    const processed = { id: 'processed' } as unknown as MediaStreamTrack;
    const track = {
      mediaStreamTrack: processed,
      getProcessor: () => ({ name: VOICE_ISOLATION_PROCESSOR_NAME, sourceTrack: raw }),
    };

    expect(readCaptureTrack(track)).toBe(raw);
  });

  it('returns mediaStreamTrack when no processor is attached', () => {
    const plain = { id: 'plain' } as unknown as MediaStreamTrack;
    const track = { mediaStreamTrack: plain, getProcessor: () => undefined };

    expect(readCaptureTrack(track)).toBe(plain);
  });

  it('returns mediaStreamTrack for a foreign processor', () => {
    const plain = { id: 'plain' } as unknown as MediaStreamTrack;
    const track = { mediaStreamTrack: plain, getProcessor: () => ({ name: 'other', sourceTrack: undefined }) };

    expect(readCaptureTrack(track)).toBe(plain);
  });
});
