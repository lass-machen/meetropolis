import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TrackManager } from './TrackManager';

function makeRoom() {
  return {
    localParticipant: {
      trackPublications: new Map<string, any>(),
      publishTrack: vi.fn(),
      unpublishTrack: vi.fn(),
    },
  } as any;
}

describe('TrackManager (signal closed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks mic pending and triggers ensureConnected when signal is closed', async () => {
    const room = makeRoom();
    const ensureConnected = vi.fn(async () => {});

    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => false,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected,
    });

    await tm.setMicrophoneEnabled(true);

    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(tm.state.microphone.pending).toBe(true);
  });

  it('marks cam pending and triggers ensureConnected when signal is closed', async () => {
    const room = makeRoom();
    const ensureConnected = vi.fn(async () => {});

    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => false,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected,
    });

    await tm.setCameraEnabled(true);

    expect(ensureConnected).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
    expect(tm.state.camera.pending).toBe(true);
  });
});
