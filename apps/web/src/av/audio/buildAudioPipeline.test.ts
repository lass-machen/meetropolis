import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('livekit-client', () => {
  const createLocalAudioTrack = vi.fn(async (constraints: any) => {
    const track: any = {
      mediaStreamTrack: { kind: 'audio' },
      _constraints: constraints,
      replaceTrack: vi.fn(async (_t: MediaStreamTrack) => {}),
      stop: vi.fn(() => {}),
    };
    return track;
  });
  return { createLocalAudioTrack };
});

vi.mock('./voiceIsolation', () => ({
  wrapTrackWithVoiceIsolation: vi.fn(async (_t: MediaStreamTrack) => {
    // default success; individual tests can override via mock
    return {} as any as MediaStreamTrack;
  }),
}));

import { createLocalAudioTrack } from 'livekit-client';
import { wrapTrackWithVoiceIsolation } from './voiceIsolation';
import { buildAudioPipeline } from './buildAudioPipeline';

describe('buildAudioPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses browser NS/EC/AGC when voice isolation is off', async () => {
    const settings: any = {
      clientVoiceIsolation: false,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    const track = await buildAudioPipeline({ deviceId: 'default', settings } as any);
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(track).toBeTruthy();
  });

  it('disables browser NS and wraps with voice isolation when enabled', async () => {
    (wrapTrackWithVoiceIsolation as any).mockResolvedValueOnce({} as MediaStreamTrack);

    const settings: any = {
      clientVoiceIsolation: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings } as any);
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(track.replaceTrack).toHaveBeenCalledTimes(1);
  });

  it('falls back to browser NS if voice isolation load fails', async () => {
    (wrapTrackWithVoiceIsolation as any).mockRejectedValueOnce(new Error('load-failed'));

    const settings: any = {
      clientVoiceIsolation: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings } as any);
    // First attempt with NS off
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({ noiseSuppression: false });
    // Second attempt fallback with NS on
    expect((createLocalAudioTrack as any).mock.calls[1][0]).toMatchObject({ noiseSuppression: true });
    expect(track.replaceTrack).not.toHaveBeenCalled();
  });
});


