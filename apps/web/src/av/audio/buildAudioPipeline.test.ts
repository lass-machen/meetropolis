import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('livekit-client', () => {
  const createLocalAudioTrack = vi.fn((constraints: any) => {
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
  wrapTrackWithVoiceIsolation: vi.fn((_t: MediaStreamTrack) => {
    // default success; individual tests can override via mock
    return { processed: {} as any as MediaStreamTrack, stopSource: vi.fn() };
  }),
}));

import { createLocalAudioTrack } from 'livekit-client';
import { wrapTrackWithVoiceIsolation } from './voiceIsolation';
import { buildAudioPipeline } from './buildAudioPipeline';

describe('buildAudioPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (wrapTrackWithVoiceIsolation as any).mockReset();
    (wrapTrackWithVoiceIsolation as any).mockImplementation((_t: MediaStreamTrack) => {
      return { processed: {} as any as MediaStreamTrack, stopSource: vi.fn() };
    });
    // Reset navigator stubs
    (global as any).navigator = undefined;
  });

  it('on Apple with NS support uses native NS path and does not wrap', async () => {
    (wrapTrackWithVoiceIsolation as any).mockResolvedValueOnce({ processed: {}, stopSource: vi.fn() });

    (global as any).navigator = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      mediaDevices: {
        getSupportedConstraints: () => ({ noiseSuppression: true }),
      },
    };

    const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });
    // The initial capture constraints should request NS=true.
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({ noiseSuppression: true });
    // No worklet-based replacement is expected on the Apple branch.
    expect(track.replaceTrack).not.toHaveBeenCalled();
    expect(wrapTrackWithVoiceIsolation as any).not.toHaveBeenCalled();
  });

  it('tries voice isolation first (NS off) and replaces track on success', async () => {
    (wrapTrackWithVoiceIsolation as any).mockResolvedValueOnce({ processed: {}, stopSource: vi.fn() });

    (global as any).navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
      mediaDevices: { getSupportedConstraints: () => ({ noiseSuppression: true }) },
    };
    const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(track.replaceTrack).toHaveBeenCalledTimes(1);
  });

  it('attaches the __avStopSource teardown handle when voice isolation succeeds', async () => {
    // The published track after replaceTrack() is a WebAudio destination
    // track; stopOnMute cannot reach the real capture MediaStreamTrack
    // anymore. __avStopSource is the escape hatch unpublishMicrophone()
    // uses to close it explicitly (FIX 2a / B3).
    const stopSource = vi.fn();
    (wrapTrackWithVoiceIsolation as any).mockResolvedValueOnce({ processed: {}, stopSource });

    const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });

    expect(track.__avStopSource).toBe(stopSource);
  });

  it('does not attach __avStopSource when voice isolation is not used (native NS path)', async () => {
    (global as any).navigator = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      mediaDevices: { getSupportedConstraints: () => ({ noiseSuppression: true }) },
    };
    const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });

    expect(track.__avStopSource).toBeUndefined();
  });

  it('disables browser NS and wraps with voice isolation when enabled', async () => {
    (wrapTrackWithVoiceIsolation as any).mockResolvedValueOnce({ processed: {}, stopSource: vi.fn() });

    const settings: any = {
      clientVoiceIsolation: true,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(track.replaceTrack).toHaveBeenCalledTimes(1);
  });

  it('falls back to browser NS if voice isolation load fails', async () => {
    (wrapTrackWithVoiceIsolation as any).mockRejectedValueOnce(new Error('load-failed'));

    const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });
    // First attempt with NS off
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({ noiseSuppression: false });
    // Fallback attempt with NS on
    expect((createLocalAudioTrack as any).mock.calls.length).toBe(2);
    expect((createLocalAudioTrack as any).mock.calls[1][0]).toMatchObject({ noiseSuppression: true });
    expect(track.replaceTrack).not.toHaveBeenCalled();
  });
});
