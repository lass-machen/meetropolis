import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TrackManager } from './TrackManager';
import { useAvSettingsStore } from '../../state/avSettings';

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
    // These tests exercise the soft-mute path explicitly (capture stays
    // open, only an RTP-mute-frame is sent). With stopMicOnMute defaulting
    // to true (FIX 2a), mute now hard-closes by default; opt back into
    // soft-mute for this suite. The default-on hard-close path has its own
    // coverage in TrackManager.republish.test.ts.
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
  });

  afterEach(() => {
    useAvSettingsStore.getState().reset();
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

    // Soft-mute: only one publish, NO unpublish (track publication is preserved).
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
