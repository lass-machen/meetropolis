import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../AVLogger', () => ({ AVLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));

import { AVLogger } from '../AVLogger';
import {
  VOICE_ISOLATION_INIT_TIMEOUT_MS,
  VOICE_ISOLATION_TIMEOUT,
  createVoiceIsolationProcessor,
  wrapTrackWithVoiceIsolation,
} from './voiceIsolation';

describe('voiceIsolation (worklet chain)', () => {
  const realWindowAudioWorkletNode = (global as any).window?.AudioWorkletNode;
  const realWindowAudioContext = (global as any).window?.AudioContext;
  const realWindowWebkitAudioContext = (global as any).window?.webkitAudioContext;

  // Populated by FakeAudioContext's constructor in beforeEach; lets tests
  // assert on the single AudioContext instance created per
  // wrapTrackWithVoiceIsolation() call.
  let createdContexts: { close: ReturnType<typeof vi.fn> }[] = [];
  let fakeWorklet: { addModule: ReturnType<typeof vi.fn> };
  let fakeDestinationTrack: any;
  // Graph nodes created by the fakes, in creation order.
  let gateNodes: any[] = [];
  let highpassNodes: any[] = [];
  let limiterNodes: any[] = [];

  beforeEach(() => {
    createdContexts = [];
    gateNodes = [];
    highpassNodes = [];
    limiterNodes = [];
    vi.mocked(AVLogger.warn).mockClear();
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
      this.disconnect = vi.fn();
      this.listeners = new Map<string, { handler: (event: Event) => void; options: unknown }>();
      this.addEventListener = vi.fn((type: string, handler: (event: Event) => void, options?: unknown) => {
        this.listeners.set(type, { handler, options });
      });
      gateNodes.push(this);
    } as any;

    fakeWorklet = { addModule: vi.fn(async () => {}) };
    fakeDestinationTrack = { kind: 'audio', contentHint: '', stop: vi.fn() };
    const fakeDestination = {
      stream: {
        getAudioTracks: () => [fakeDestinationTrack],
      },
    } as any;

    class FakeAudioContext {
      currentTime = 0;
      audioWorklet = fakeWorklet;
      createMediaStreamSource = vi.fn((_ms: MediaStream) => ({ connect: vi.fn() }) as any);
      createBiquadFilter = vi.fn(() => {
        const node = {
          type: 'highpass',
          frequency: { value: 0 },
          Q: { value: 0 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        };
        highpassNodes.push(node);
        return node as any;
      });
      createDynamicsCompressor = vi.fn(() => {
        const node = {
          threshold: { value: 0 },
          knee: { value: 0 },
          ratio: { value: 0 },
          attack: { value: 0 },
          release: { value: 0 },
          connect: vi.fn(),
        };
        limiterNodes.push(node);
        return node as any;
      });
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
    vi.useRealTimers();
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

  it('rejects with the timeout marker when addModule does not settle within the init timeout', async () => {
    vi.useFakeTimers();
    fakeWorklet.addModule.mockReturnValueOnce(new Promise<void>(() => undefined));
    const fakeInputTrack: any = {
      kind: 'audio',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };
    const pending = wrapTrackWithVoiceIsolation(fakeInputTrack);
    const outcome = pending.then(
      () => 'resolved',
      (error: Error) => error.message,
    );

    await vi.advanceTimersByTimeAsync(VOICE_ISOLATION_INIT_TIMEOUT_MS);

    expect(await outcome).toBe(VOICE_ISOLATION_TIMEOUT);
    // The half-built graph is released, but the raw capture stays alive so
    // the caller can fall back to it without a second getUserMedia.
    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
    expect(fakeInputTrack.stop).not.toHaveBeenCalled();
    expect(fakeInputTrack.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
  });

  it('uses a 3 s init timeout by default', () => {
    expect(VOICE_ISOLATION_INIT_TIMEOUT_MS).toBe(3_000);
  });

  it('releases the AudioContext when addModule rejects', async () => {
    fakeWorklet.addModule.mockRejectedValueOnce(new Error('load-failed'));
    const fakeInputTrack: any = {
      kind: 'audio',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    };

    await expect(wrapTrackWithVoiceIsolation(fakeInputTrack)).rejects.toThrow('load-failed');

    expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
    expect(fakeInputTrack.stop).not.toHaveBeenCalled();
  });

  const lastCallOrder = (fn: ReturnType<typeof vi.fn>): number =>
    fn.mock.invocationCallOrder[fn.mock.invocationCallOrder.length - 1] ?? Number.NaN;

  describe('processorerror fallback', () => {
    const makeInputTrack = (): any => ({
      kind: 'audio',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      stop: vi.fn(),
    });

    it('listens once for processorerror and leaves the gate in the path until it fires', async () => {
      await wrapTrackWithVoiceIsolation(makeInputTrack());

      const [gate] = gateNodes;
      const [highpass] = highpassNodes;
      expect(gate.listeners.get('processorerror')?.options).toEqual({ once: true });
      expect(highpass.connect).toHaveBeenCalledTimes(1);
      expect(highpass.connect).toHaveBeenCalledWith(gate);
      expect(AVLogger.warn).not.toHaveBeenCalled();
    });

    it('routes the signal around a crashed gate and logs the fallback', async () => {
      const { processed } = await wrapTrackWithVoiceIsolation(makeInputTrack());
      const [gate] = gateNodes;
      const [highpass] = highpassNodes;
      const [limiter] = limiterNodes;

      gate.listeners.get('processorerror').handler(Object.assign(new Event('processorerror'), { message: 'boom' }));

      // Highpass feeds the limiter directly; the published track is unchanged.
      expect(highpass.connect).toHaveBeenLastCalledWith(limiter);
      expect(highpass.disconnect).toHaveBeenCalledWith(gate);
      // The bypass is connected before the gate is detached, so the signal
      // path is never interrupted.
      expect(lastCallOrder(highpass.connect)).toBeLessThan(lastCallOrder(highpass.disconnect));
      expect(gate.disconnect).toHaveBeenCalledTimes(1);
      expect(processed.stop).not.toHaveBeenCalled();
      expect(AVLogger.warn).toHaveBeenCalledWith('track.mic.voice_isolation_fallback', {
        reason: 'processor_error',
        detached: true,
        message: 'boom',
      });
    });

    it('keeps the bypass when detaching the gate fails and reports it', async () => {
      await wrapTrackWithVoiceIsolation(makeInputTrack());
      const [gate] = gateNodes;
      const [highpass] = highpassNodes;
      const [limiter] = limiterNodes;
      highpass.disconnect.mockImplementation(() => {
        throw new Error('InvalidAccessError');
      });

      gate.listeners.get('processorerror').handler(new Event('processorerror'));

      expect(highpass.connect).toHaveBeenLastCalledWith(limiter);
      expect(lastCallOrder(highpass.connect)).toBeLessThan(lastCallOrder(highpass.disconnect));
      expect(AVLogger.warn).toHaveBeenCalledWith('track.mic.voice_isolation_fallback', {
        reason: 'processor_error',
        detached: false,
        message: undefined,
      });
    });
  });

  describe('createVoiceIsolationProcessor', () => {
    const makeRawTrack = () => {
      const endedHandlers: Array<() => void> = [];
      const track: any = {
        kind: 'audio',
        addEventListener: vi.fn((event: string, handler: () => void) => {
          if (event === 'ended') endedHandlers.push(handler);
        }),
        removeEventListener: vi.fn(),
        stop: vi.fn(),
      };
      return { track, endedHandlers };
    };

    it('init builds the graph on the raw track and exposes the processed track', async () => {
      const processor = createVoiceIsolationProcessor();
      const { track } = makeRawTrack();

      await processor.init({ kind: 'audio' as any, track, audioContext: processor.audioContext });

      expect(processor.processedTrack).toBe(fakeDestinationTrack);
      expect(processor.sourceTrack).toBe(track);
      expect(createdContexts).toHaveLength(1);
      expect(createdContexts[0].close).not.toHaveBeenCalled();
    });

    it('restart rebuilds on the new raw track in the same AudioContext and leaves the old raw track alone', async () => {
      const processor = createVoiceIsolationProcessor();
      const first = makeRawTrack();
      const second = makeRawTrack();
      await processor.init({ kind: 'audio' as any, track: first.track, audioContext: processor.audioContext });

      await processor.restart({ kind: 'audio' as any, track: second.track, audioContext: processor.audioContext });

      expect(processor.sourceTrack).toBe(second.track);
      expect(createdContexts).toHaveLength(1);
      expect(createdContexts[0].close).not.toHaveBeenCalled();
      expect(first.track.stop).not.toHaveBeenCalled();
      expect(first.track.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    it('destroy stops the processed track and closes its AudioContext once, leaving the raw track to LiveKit', async () => {
      const processor = createVoiceIsolationProcessor();
      const { track } = makeRawTrack();
      await processor.init({ kind: 'audio' as any, track, audioContext: processor.audioContext });

      await processor.destroy();
      await processor.destroy();

      expect(fakeDestinationTrack.stop).toHaveBeenCalledTimes(1);
      expect(createdContexts[0].close).toHaveBeenCalledTimes(1);
      expect(track.stop).not.toHaveBeenCalled();
      expect(processor.processedTrack).toBeUndefined();
    });

    it('init rejects with the timeout marker and leaves no processed track', async () => {
      vi.useFakeTimers();
      fakeWorklet.addModule.mockReturnValueOnce(new Promise<void>(() => undefined));
      const processor = createVoiceIsolationProcessor();
      const { track } = makeRawTrack();
      const outcome = processor.init({ kind: 'audio' as any, track, audioContext: processor.audioContext }).then(
        () => 'resolved',
        (error: Error) => error.message,
      );

      await vi.advanceTimersByTimeAsync(VOICE_ISOLATION_INIT_TIMEOUT_MS);

      expect(await outcome).toBe(VOICE_ISOLATION_TIMEOUT);
      expect(processor.processedTrack).toBeUndefined();
      expect(track.stop).not.toHaveBeenCalled();
    });

    it('stops the processed track when the raw capture ends, so liveness checks see the end', async () => {
      const processor = createVoiceIsolationProcessor();
      const { track, endedHandlers } = makeRawTrack();
      await processor.init({ kind: 'audio' as any, track, audioContext: processor.audioContext });

      endedHandlers.forEach((handler) => handler());

      expect(fakeDestinationTrack.stop).toHaveBeenCalled();
    });
  });
});
