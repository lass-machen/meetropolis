import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TrackManager } from './TrackManager';

// Each call returns a distinct mock track so tests can tell the pre- and
// post-republish track instances apart.
vi.mock('../audio/buildAudioPipeline', () => {
  let counter = 0;
  return {
    buildAudioPipeline: vi.fn(() => {
      counter += 1;
      const mst: any = {
        id: `mst-${counter}`,
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

describe('TrackManager.republishMicrophone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unpublishes the current track and publishes a fresh one when the mic is live, desired, and signal is open', async () => {
    const room = makeRoom();
    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await tm.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    const firstTrack = room.localParticipant.trackPublications.get('mic')?.track;

    await tm.republishMicrophone();

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(firstTrack);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    const secondTrack = room.localParticipant.trackPublications.get('mic')?.track;
    expect(secondTrack).toBeTruthy();
    expect(secondTrack).not.toBe(firstTrack);
  });

  it('is a no-op when the mic was never enabled', async () => {
    const room = makeRoom();
    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await tm.republishMicrophone();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('is a no-op when the mic is not desired (muted via the public API)', async () => {
    const room = makeRoom();
    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await tm.setMicrophoneEnabled(true);
    await tm.setMicrophoneEnabled(false);
    vi.clearAllMocks();

    await tm.republishMicrophone();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('is a no-op when the mic is desired but not currently enabled (e.g. track dropped by the browser)', async () => {
    const room = makeRoom();
    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    }) as any;

    await tm.setMicrophoneEnabled(true);
    vi.clearAllMocks();

    // Simulate the ended-by-browser handler: the publication is gone but
    // the user still wants the mic on (state.desired stays true).
    room.localParticipant.trackPublications.clear();
    tm._state.microphone.desired = true;

    await tm.republishMicrophone();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('is a no-op when the signal is not open', async () => {
    const room = makeRoom();
    let signalOpen = true;
    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => signalOpen,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await tm.setMicrophoneEnabled(true);
    vi.clearAllMocks();
    signalOpen = false;

    await tm.republishMicrophone();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no room', async () => {
    const tm = new TrackManager({
      getRoom: () => null,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await expect(tm.republishMicrophone()).resolves.toBeUndefined();
  });
});
