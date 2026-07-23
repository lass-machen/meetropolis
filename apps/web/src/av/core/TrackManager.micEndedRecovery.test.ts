import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TrackManager } from './TrackManager';

// Each publish yields a distinct mock track whose mediaStreamTrack captures its
// 'ended' listener so tests can simulate the browser ending the track.
let latestMic: { mst: any } | null = null;

vi.mock('../audio/buildAudioPipeline', () => {
  let counter = 0;
  return {
    buildAudioPipeline: vi.fn(() => {
      counter += 1;
      const listeners: Record<string, Array<() => void>> = {};
      const mst: any = {
        id: `mst-${counter}`,
        kind: 'audio',
        enabled: true,
        readyState: 'live',
        addEventListener: (type: string, cb: () => void) => {
          (listeners[type] ||= []).push(cb);
        },
        removeEventListener: vi.fn(),
        // Simulate the browser ending the track: readyState flips to 'ended'
        // (so it no longer counts as a live publication) and 'ended' fires.
        fireEnded: () => {
          mst.readyState = 'ended';
          (listeners['ended'] || []).forEach((cb) => cb());
        },
      };
      latestMic = { mst };
      return {
        kind: 'audio',
        mediaStreamTrack: mst,
        setEnabled: vi.fn((v: boolean) => {
          mst.enabled = v;
        }),
        stop: vi.fn(),
      };
    }),
  };
});

function makeRoom() {
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn((t: any, opts?: any) => {
      localParticipant.trackPublications.set('mic', {
        track: t,
        kind: 'audio',
        source: opts?.source ?? 'microphone',
        muted: false,
      });
    }),
    unpublishTrack: vi.fn((t: any) => {
      for (const [k, pub] of localParticipant.trackPublications.entries()) {
        if (pub?.track === t) localParticipant.trackPublications.delete(k);
      }
    }),
  };
  return { localParticipant } as any;
}

function makeTM(room: any) {
  return new TrackManager({
    getRoom: () => room,
    isSignalOpen: () => true,
    onTrackPublished: vi.fn(),
    onAllTracksUnpublished: vi.fn(),
    ensureConnected: vi.fn(async () => {}),
  }) as any;
}

describe('TrackManager mic ended-by-browser recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestMic = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    try {
      delete (globalThis.navigator as any).mediaDevices;
    } catch {}
  });

  it('republishes the mic after the browser ends the track', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);

    await tm.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);

    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(300); // > 200ms base backoff

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit after 5 rapid ends and stops republishing', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);

    await tm.setMicrophoneEnabled(true); // publish #1
    for (let i = 0; i < 5; i++) {
      latestMic!.mst.fireEnded();
      await vi.advanceTimersByTimeAsync(6000); // > max 5s backoff → republish fires
    }
    // 5 ends → 5 republishes → 6 publishes total.
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(6);

    // 6th end trips the breaker: no further republish.
    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(6000);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(6);
  });

  it('a manual re-enable resets the breaker so recovery resumes', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);

    await tm.setMicrophoneEnabled(true);
    for (let i = 0; i < 6; i++) {
      latestMic!.mst.fireEnded();
      await vi.advanceTimersByTimeAsync(6000);
    }
    const afterOpen = room.localParticipant.publishTrack.mock.calls.length; // 6, circuit open

    // Deliberate re-enable clears the breaker and republishes.
    await tm.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(afterOpen + 1);

    // A fresh end now recovers again (breaker was reset).
    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(300);
    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(afterOpen + 2);
  });

  it('drops a preferred mic device that no longer exists before republishing', async () => {
    vi.useFakeTimers();
    const enumerateDevices = vi.fn(() => Promise.resolve([{ kind: 'audioinput', deviceId: 'builtin-mic' }]));
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { enumerateDevices },
      configurable: true,
      writable: true,
    });

    const room = makeRoom();
    const tm = makeTM(room);
    await tm.setMicrophoneEnabled(true);
    tm._state.microphone.preferredDeviceId = 'gone-airpods';

    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(300);

    expect(enumerateDevices).toHaveBeenCalled();
    expect(tm._state.microphone.preferredDeviceId).toBeUndefined();
  });

  it('keeps the preferred device when enumerateDevices reports no ids (permission blip)', async () => {
    vi.useFakeTimers();
    // audioinput present but blank deviceId => permission not granted.
    const enumerateDevices = vi.fn(() => Promise.resolve([{ kind: 'audioinput', deviceId: '' }]));
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      value: { enumerateDevices },
      configurable: true,
      writable: true,
    });

    const room = makeRoom();
    const tm = makeTM(room);
    await tm.setMicrophoneEnabled(true);
    tm._state.microphone.preferredDeviceId = 'my-mic';

    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(300);

    expect(enumerateDevices).toHaveBeenCalled();
    expect(tm._state.microphone.preferredDeviceId).toBe('my-mic'); // not falsely dropped
  });

  it('forgives accumulated attempts once a republished track survives the healthy window', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);
    await tm.setMicrophoneEnabled(true);

    for (let i = 0; i < 3; i++) {
      latestMic!.mst.fireEnded();
      await vi.advanceTimersByTimeAsync(6000);
    }
    expect(tm._micEndedAttempts).toBe(3);

    // Let the current track stay live past the 10s healthy window, then end it.
    await vi.advanceTimersByTimeAsync(11000);
    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(300);

    // The long survival reset the counter before this end was counted → 1.
    expect(tm._micEndedAttempts).toBe(1);
  });

  it('recovers a dead mic via a rate-limited device-change nudge even with the circuit open', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);
    await tm.setMicrophoneEnabled(true);

    // Open the circuit (6 rapid ends → no more auto-republish).
    for (let i = 0; i < 6; i++) {
      latestMic!.mst.fireEnded();
      await vi.advanceTimersByTimeAsync(6000);
    }
    const afterOpen = room.localParticipant.publishTrack.mock.calls.length; // 6

    // A device change nudges exactly one recovery attempt.
    tm.notifyDeviceChange();
    await vi.advanceTimersByTimeAsync(50);
    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(afterOpen + 1);

    // An immediate second nudge is rate-limited → no-op.
    tm.notifyDeviceChange();
    await vi.advanceTimersByTimeAsync(50);
    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(afterOpen + 1);
  });

  it('the device-change nudge does NOT reset the breaker (circuit stays open)', async () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const tm = makeTM(room);
    await tm.setMicrophoneEnabled(true);

    for (let i = 0; i < 6; i++) {
      latestMic!.mst.fireEnded();
      await vi.advanceTimersByTimeAsync(6000);
    }
    expect(tm._micEndedAttempts).toBeGreaterThan(5); // circuit open

    // Nudge recovers exactly one track.
    tm.notifyDeviceChange();
    await vi.advanceTimersByTimeAsync(50);
    const afterNudge = room.localParticipant.publishTrack.mock.calls.length;

    // If that nudge-recovered track dies quickly, the breaker was NOT reset, so
    // there is no auto-republish and the circuit remains open.
    latestMic!.mst.fireEnded();
    await vi.advanceTimersByTimeAsync(6000);
    expect(tm._micEndedAttempts).toBeGreaterThan(5);
    expect(room.localParticipant.publishTrack.mock.calls.length).toBe(afterNudge);
  });
});
