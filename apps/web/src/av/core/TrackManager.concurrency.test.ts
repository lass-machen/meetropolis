import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TrackManager } from './TrackManager';

vi.mock('../audio/buildAudioPipeline', () => {
  return {
    buildAudioPipeline: vi.fn(() => {
      const mst: any = {
        id: 'mst-1',
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
    publishTrack: vi.fn(),
    unpublishTrack: vi.fn(),
  };
  return { localParticipant } as any;
}

describe('TrackManager (concurrency)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies mute even if publish is slow (no lost toggles, soft-mute path)', async () => {
    const room = makeRoom();
    const publishGate: { resolve: null | (() => void) } = { resolve: null };
    room.localParticipant.publishTrack.mockImplementation(async (t: any, opts?: any) => {
      room.localParticipant.trackPublications.set('mic', {
        track: t,
        kind: 'audio',
        source: opts?.source ?? 'microphone',
        muted: false,
      });
      await new Promise<void>((r) => {
        publishGate.resolve = () => r();
      });
    });
    room.localParticipant.unpublishTrack.mockImplementation((t: any) => {
      for (const [k, pub] of room.localParticipant.trackPublications.entries()) {
        if (pub?.track === t) room.localParticipant.trackPublications.delete(k);
      }
    });

    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    const pEnable = tm.setMicrophoneEnabled(true);
    for (let i = 0; i < 50 && !publishGate.resolve; i++) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(publishGate.resolve).not.toBeNull();
    const pMute = tm.setMicrophoneEnabled(false);

    if (publishGate.resolve) publishGate.resolve();
    await Promise.all([pEnable, pMute]);

    // Soft-Mute: nur ein Publish, KEIN Unpublish (Track-Publication bleibt erhalten).
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(0);
    expect(room.localParticipant.trackPublications.size).toBe(1);
    expect(tm.isMicrophoneEnabled).toBe(false);
  });

  it('rapid mute/unmute uses soft-mute (no republish)', async () => {
    const room = makeRoom();
    room.localParticipant.publishTrack.mockImplementation((t: any, opts?: any) => {
      room.localParticipant.trackPublications.set('mic', {
        track: t,
        kind: 'audio',
        source: opts?.source ?? 'microphone',
        muted: false,
      });
    });
    room.localParticipant.unpublishTrack.mockImplementation((t: any) => {
      for (const [k, pub] of room.localParticipant.trackPublications.entries()) {
        if (pub?.track === t) room.localParticipant.trackPublications.delete(k);
      }
    });

    const tm = new TrackManager({
      getRoom: () => room,
      isSignalOpen: () => true,
      onTrackPublished: vi.fn(),
      onAllTracksUnpublished: vi.fn(),
      ensureConnected: vi.fn(async () => {}),
    });

    await tm.setMicrophoneEnabled(true);
    expect(tm.isMicrophoneEnabled).toBe(true);

    await tm.setMicrophoneEnabled(false);
    expect(tm.isMicrophoneEnabled).toBe(false);

    await tm.setMicrophoneEnabled(true);
    expect(tm.isMicrophoneEnabled).toBe(true);

    await tm.setMicrophoneEnabled(false);
    expect(tm.isMicrophoneEnabled).toBe(false);

    // Three toggles after the initial publish: the track publication was NOT
    // torn down, so there is only a single publishTrack/unpublishTrack pair.
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledTimes(0);
    expect(room.localParticipant.trackPublications.size).toBe(1);
  });
});
