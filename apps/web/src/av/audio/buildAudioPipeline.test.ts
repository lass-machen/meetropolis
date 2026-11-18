import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('livekit-client', () => {
  const createLocalAudioTrack = vi.fn((constraints: any) => {
    const track: any = {
      mediaStreamTrack: { kind: 'audio' },
      _constraints: constraints,
      replaceTrack: vi.fn(async (_t: MediaStreamTrack) => {}),
      setAudioContext: vi.fn(),
      setProcessor: vi.fn(async (_p: unknown) => {}),
      stop: vi.fn(() => {}),
    };
    return track;
  });
  return { createLocalAudioTrack };
});

vi.mock('../AVLogger', () => ({
  AVLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const fakeProcessor: any = { name: 'voice-isolation', audioContext: { id: 'ctx' }, destroy: vi.fn(async () => {}) };

vi.mock('./voiceIsolation', () => ({
  VOICE_ISOLATION_TIMEOUT: 'voice_isolation_timeout',
  createVoiceIsolationProcessor: vi.fn(() => fakeProcessor),
}));

import { createLocalAudioTrack } from 'livekit-client';
import { AVLogger } from '../AVLogger';
import { createVoiceIsolationProcessor } from './voiceIsolation';
import { buildAudioPipeline } from './buildAudioPipeline';

const appleNavigator = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  mediaDevices: { getSupportedConstraints: () => ({ noiseSuppression: true }) },
};
const windowsNavigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome',
  mediaDevices: { getSupportedConstraints: () => ({ noiseSuppression: true }) },
};
const settings: any = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

const firstCreatedTrack = (): any => (createLocalAudioTrack as any).mock.results[0].value;

describe('buildAudioPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', undefined);
  });

  it('on Apple with NS support uses the native NS path and attaches no processor', async () => {
    vi.stubGlobal('navigator', appleNavigator);

    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });

    expect((createLocalAudioTrack as any).mock.calls).toHaveLength(1);
    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({ noiseSuppression: true });
    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(createVoiceIsolationProcessor).not.toHaveBeenCalled();
  });

  it('captures with NS off and attaches the voice isolation processor before publish', async () => {
    vi.stubGlobal('navigator', windowsNavigator);

    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });

    expect((createLocalAudioTrack as any).mock.calls[0][0]).toMatchObject({
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    });
    expect(track).toBe(firstCreatedTrack());
    // LocalAudioTrack.setProcessor requires an AudioContext on the track.
    expect(track.setAudioContext).toHaveBeenCalledWith(fakeProcessor.audioContext);
    expect(track.setProcessor).toHaveBeenCalledWith(fakeProcessor);
    // replaceTrack() needs a sender and always failed before publish.
    expect(track.replaceTrack).not.toHaveBeenCalled();
  });

  it('falls back to the raw microphone without filtering when the processor init times out', async () => {
    (createLocalAudioTrack as any).mockImplementationOnce((constraints: any) => ({
      mediaStreamTrack: { kind: 'audio' },
      _constraints: constraints,
      setAudioContext: vi.fn(),
      setProcessor: vi.fn(() => Promise.reject(new Error('voice_isolation_timeout'))),
      stop: vi.fn(),
    }));

    const track: any = await buildAudioPipeline({ deviceId: 'default', settings });

    expect((createLocalAudioTrack as any).mock.calls).toHaveLength(1);
    expect(track.stop).not.toHaveBeenCalled();
    expect(fakeProcessor.destroy).toHaveBeenCalledTimes(1);
    expect(AVLogger.warn).toHaveBeenCalledWith('track.mic.voice_isolation_fallback', { reason: 'timeout' });
  });

  it('falls back to browser NS and logs the error fallback when the processor fails', async () => {
    (createLocalAudioTrack as any).mockImplementationOnce((constraints: any) => ({
      mediaStreamTrack: { kind: 'audio' },
      _constraints: constraints,
      setAudioContext: vi.fn(),
      setProcessor: vi.fn(() => Promise.reject(new Error('load-failed'))),
      stop: vi.fn(),
    }));

    await buildAudioPipeline({ deviceId: 'default', settings });

    const first: any = firstCreatedTrack();
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect((createLocalAudioTrack as any).mock.calls).toHaveLength(2);
    expect((createLocalAudioTrack as any).mock.calls[1][0]).toMatchObject({ noiseSuppression: true });
    expect(fakeProcessor.destroy).toHaveBeenCalledTimes(1);
    expect(AVLogger.warn).toHaveBeenCalledWith('track.mic.voice_isolation_fallback', { reason: 'error' });
  });

  it('skips the processor and returns the raw capture when noise suppression is off', async () => {
    const track: any = await buildAudioPipeline({
      deviceId: 'default',
      settings: { ...settings, noiseSuppression: false },
    });

    expect(track.setProcessor).not.toHaveBeenCalled();
    expect(createVoiceIsolationProcessor).not.toHaveBeenCalled();
  });
});
