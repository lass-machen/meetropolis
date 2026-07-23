import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TrackManager } from './TrackManager';
import { useAvSettingsStore } from '../../state/avSettings';

vi.mock('../audio/buildAudioPipeline', () => ({
  buildAudioPipeline: vi.fn(() => {
    const mst: any = {
      id: 'mst',
      kind: 'audio',
      enabled: true,
      readyState: 'live',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    return {
      kind: 'audio',
      mediaStreamTrack: mst,
      setEnabled: vi.fn((v: boolean) => {
        mst.enabled = v;
      }),
      stop: vi.fn(),
    };
  }),
}));

type Deferred = { p: Promise<void>; resolve: () => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { p, resolve, reject };
}

// A room whose publishTrack stays pending until the test resolves/rejects it,
// so the in-flight publishing flag can be observed mid-publish.
function makeRoomWithDeferredPublish(pub: Deferred) {
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn((t: any, opts?: any) => {
      localParticipant.trackPublications.set('mic', {
        track: t,
        kind: 'audio',
        source: opts?.source ?? 'microphone',
        muted: false,
      });
      return pub.p;
    }),
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

describe('TrackManager publishing flag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAvSettingsStore.getState().reset();
  });

  it('is false when idle', () => {
    const tm = makeManager(makeRoomWithDeferredPublish(deferred()));
    expect(tm.isMicrophonePublishing).toBe(false);
  });

  it('is true only while a real publish is in flight and clears on success', async () => {
    const pub = deferred();
    const tm = makeManager(makeRoomWithDeferredPublish(pub));

    const done = tm.setMicrophoneEnabled(true);
    await flushMicrotasks();
    expect(tm.isMicrophonePublishing).toBe(true);

    pub.resolve();
    await done;
    expect(tm.isMicrophonePublishing).toBe(false);
  });

  it('clears the flag when the publish fails (finally on the failure path)', async () => {
    const pub = deferred();
    const tm = makeManager(makeRoomWithDeferredPublish(pub));

    const done = tm.setMicrophoneEnabled(true).catch(() => {});
    await flushMicrotasks();
    expect(tm.isMicrophonePublishing).toBe(true);

    pub.reject(new Error('publish failed'));
    await done;
    await flushMicrotasks();
    expect(tm.isMicrophonePublishing).toBe(false);
  });
});
