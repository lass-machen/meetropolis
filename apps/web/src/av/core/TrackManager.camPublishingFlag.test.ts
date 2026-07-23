import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TrackManager } from './TrackManager';

type Deferred<T> = { p: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

function makeVideoTrack() {
  const mst: any = {
    id: 'vmst',
    kind: 'video',
    enabled: true,
    readyState: 'live',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return { kind: 'video', mediaStreamTrack: mst, stop: vi.fn(), setEnabled: vi.fn() } as any;
}

// The camera path pulls createLocalTracks from livekit-client; hand it a
// deferred so the in-flight publishing flag can be observed mid-publish.
const createTracks = deferred<any[]>();
vi.mock('livekit-client', () => ({
  createLocalTracks: vi.fn(() => createTracks.p),
  createLocalAudioTrack: vi.fn(),
}));

function makeRoom() {
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn(),
    unpublishTrack: vi.fn(),
  };
  return { localParticipant } as any;
}

function makeManager(room: any) {
  return new TrackManager({
    getRoom: () => room,
    isSignalOpen: () => true,
    onTrackPublished: vi.fn(),
    onAllTracksUnpublished: vi.fn(),
    ensureConnected: vi.fn(async () => {}),
  });
}

async function flushMicrotasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe('TrackManager camera publishing flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is true only while the camera publish is in flight and clears on success', async () => {
    const tm = makeManager(makeRoom());
    expect(tm.isCameraPublishing).toBe(false);

    const done = tm.setCameraEnabled(true);
    await flushMicrotasks();
    expect(tm.isCameraPublishing).toBe(true);

    createTracks.resolve([makeVideoTrack()]);
    await done;
    expect(tm.isCameraPublishing).toBe(false);
  });
});
