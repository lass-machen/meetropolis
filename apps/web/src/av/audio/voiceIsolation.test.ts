import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { wrapTrackWithVoiceIsolation } from './voiceIsolation';

describe('voiceIsolation (worklet chain)', () => {
  const realWindowAudioWorkletNode = (global as any).window?.AudioWorkletNode;
  const realWindowAudioContext = (global as any).window?.AudioContext;
  const realWindowWebkitAudioContext = (global as any).window?.webkitAudioContext;

  // Populated by FakeAudioContext's constructor in beforeEach; lets tests
  // assert on the single AudioContext instance created per
  // wrapTrackWithVoiceIsolation() call.
  let createdContexts: { close: ReturnType<typeof vi.fn> }[] = [];

  beforeEach(() => {
    createdContexts = [];
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
      createMediaStreamSource = vi.fn((_ms: MediaStream) => ({ connect: vi.fn() }) as any);
      createBiquadFilter = vi.fn(
        () =>
          ({
            type: 'highpass',
            frequency: { value: 0 },
            Q: { value: 0 },
            connect: vi.fn(),
          }) as any,
      );
      createDynamicsCompressor = vi.fn(
        () =>
          ({
            threshold: { value: 0 },
            knee: { value: 0 },
            ratio: { value: 0 },
            attack: { value: 0 },
            release: { value: 0 },
            connect: vi.fn(),
          }) as any,
      );
      createMediaStreamDestination = vi.fn(() => fakeDestination);
      close = vi.fn(async () => {});
      constructor() {
        createdContexts.push(this);
      }
    }

    (global as any).window.AudioContext = FakeAudioContext as any;
    (global as any).window.webkitAudioContext = undefined;

    // Minimal MediaStream stub for the constructor call inside the wrapper.
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
    const { processed } = await wrapTrackWithVoiceIsolation(fakeInputTrack);

    expect(processed).toBeTruthy();
    // contentHint is optional: when present, it should be set to 'speech'.
    if ('contentHint' in (processed as any)) {
      expect((processed as any).contentHint).toBe('speech');
    }
  });

  it('stopSource stops the input track and removes the ended listener', async () => {
    const fakeInputTrack: any = {
      kind: 'audio',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const { stopSource } = await wrapTrackWithVoiceIsolation(fakeInputTrack);

    stopSource();

    expect(fakeInputTrack.stop).toHaveBeenCalledTimes(1);
    expect(fakeInputTrack.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
  });

  it('stopSource is idempotent: the AudioContext is only closed once across repeated calls', async () => {
    const fakeInputTrack: any = {
      kind: 'audio',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const { stopSource } = await wrapTrackWithVoiceIsolation(fakeInputTrack);

    stopSource();
    expect(() => stopSource()).not.toThrow();
    stopSource();

    expect(createdContexts).toHaveLength(1);
    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
  });

  it('closes the AudioContext when the input track ends externally (device unplugged)', async () => {
    let endedHandler: (() => void) | undefined;
    const fakeInputTrack: any = {
      kind: 'audio',
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'ended') endedHandler = handler;
      }),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const { stopSource } = await wrapTrackWithVoiceIsolation(fakeInputTrack);

    expect(endedHandler).toBeTypeOf('function');
    // Simulate the browser firing 'ended' (not triggered by inputTrack.stop()).
    endedHandler?.();

    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
    // stopSource() must remain safe to call afterwards and must not close
    // the (already-closed) context a second time.
    stopSource();
    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
  });
});
