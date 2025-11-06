import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { wrapTrackWithVoiceIsolation } from './voiceIsolation';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {}
  }
}

describe('voiceIsolation (worklet chain)', () => {
  const realWindowAudioWorkletNode = (global as any).window?.AudioWorkletNode;
  const realWindowAudioContext = (global as any).window?.AudioContext;
  const realWindowWebkitAudioContext = (global as any).window?.webkitAudioContext;

  beforeEach(() => {
    // Stub AudioWorkletNode presence
    (global as any).window = (global as any).window || {};
    (global as any).window.AudioWorkletNode = function FakeNode(this: any, _ctx: any, _name: string) {
      this.parameters = new Map<string, { setValueAtTime: (v: number, t: number) => void }>();
      this.parameters.set('threshold', { setValueAtTime: (_v: number) => {} });
      this.parameters.set('ratio', { setValueAtTime: (_v: number) => {} });
      this.parameters.set('attackMs', { setValueAtTime: (_v: number) => {} });
      this.parameters.set('releaseMs', { setValueAtTime: (_v: number) => {} });
      this.parameters.set('makeupGainDb', { setValueAtTime: (_v: number) => {} });
      this.connect = vi.fn();
    } as any;

    const fakeWorklet = { addModule: vi.fn(async () => {}) } as any;
    const fakeDestinationTrack: any = { kind: 'audio', contentHint: '' };
    const fakeDestination = {
      stream: {
        getAudioTracks: () => [fakeDestinationTrack],
      },
    } as any;

    class FakeAudioContext {
      currentTime = 0;
      audioWorklet = fakeWorklet;
      createMediaStreamSource = vi.fn((_ms: MediaStream) => ({ connect: vi.fn() } as any));
      createBiquadFilter = vi.fn(() => ({
        type: 'highpass',
        frequency: { value: 0 },
        Q: { value: 0 },
        connect: vi.fn(),
      } as any));
      createDynamicsCompressor = vi.fn(() => ({
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 0 },
        attack: { value: 0 },
        release: { value: 0 },
        connect: vi.fn(),
      } as any));
      createMediaStreamDestination = vi.fn(() => fakeDestination);
      close = vi.fn(async () => {});
    }

    (global as any).window.AudioContext = FakeAudioContext as any;
    (global as any).window.webkitAudioContext = undefined;

    // Minimaler MediaStream-Stub für den Konstruktor-Aufruf im Wrapper
    class FakeMediaStream {
      tracks: any[];
      constructor(tracks?: any[]) {
        this.tracks = tracks || [];
      }
      getAudioTracks() {
        return this.tracks;
      }
      addTrack(_t: any) {}
    }
    (global as any).MediaStream = FakeMediaStream as any;
  });

  afterEach(() => {
    (global as any).window.AudioWorkletNode = realWindowAudioWorkletNode;
    (global as any).window.AudioContext = realWindowAudioContext;
    (global as any).window.webkitAudioContext = realWindowWebkitAudioContext;
  });

  it('returns processed track and sets contentHint to speech when supported', async () => {
    const fakeInputTrack: any = { kind: 'audio', addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const outTrack = await wrapTrackWithVoiceIsolation(fakeInputTrack as any);

    expect(outTrack).toBeTruthy();
    // contentHint optional – wenn verfügbar sollte es gesetzt sein
    if ('contentHint' in (outTrack as any)) {
      expect((outTrack as any).contentHint).toBe('speech');
    }
  });
});


