import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TrackManager } from './TrackManager';
import { useAvSettingsStore } from '../../state/avSettings';

// Each build returns a fresh mock track with working mute/unmute so the tests
// can distinguish an instant soft-(un)mute from a full unpublish/republish.
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
      const track: any = {
        kind: 'audio',
        mediaStreamTrack: mst,
        stopOnMute: false,
        setEnabled: vi.fn((v: boolean) => {
          mst.enabled = v;
        }),
        mute: vi.fn(() => {
          mst.enabled = false;
        }),
        unmute: vi.fn(() => {
          mst.enabled = true;
        }),
        stop: vi.fn(() => {
          mst.readyState = 'ended';
        }),
      };
      return track;
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

function makeManager(room: any) {
  return new TrackManager({
    getRoom: () => room,
    isSignalOpen: () => true,
    onTrackPublished: vi.fn(),
    onAllTracksUnpublished: vi.fn(),
    ensureConnected: vi.fn(async () => {}),
  });
}

const RELEASE_MS = 4_000;

describe('TrackManager hybrid mute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useAvSettingsStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mute soft-mutes instantly and keeps the publication (no immediate unpublish)', async () => {
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    const track = room.localParticipant.trackPublications.get('mic')?.track;
    expect(track).toBeTruthy();

    await tm.setMicrophoneEnabled(false);

    // Soft-muted: mute() was called, publication (and its SID) still present.
    expect(track.mute).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.trackPublications.has('mic')).toBe(true);
  });

  it('releases the capture hardware after the grace period when stopMicOnMute is on', async () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', true);
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    const track = room.localParticipant.trackPublications.get('mic')?.track;
    await tm.setMicrophoneEnabled(false);

    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RELEASE_MS);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
    expect(room.localParticipant.trackPublications.has('mic')).toBe(false);
  });

  it('an unmute within the grace window cancels the release and soft-unmutes the same track', async () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', true);
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    const track = room.localParticipant.trackPublications.get('mic')?.track;
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);

    await tm.setMicrophoneEnabled(false);
    await vi.advanceTimersByTimeAsync(RELEASE_MS / 2);

    await tm.setMicrophoneEnabled(true);
    // Instant soft-unmute: same track reused, no second publish, no unpublish.
    expect(track.unmute).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);

    // The pending release must not fire after the unmute.
    await vi.advanceTimersByTimeAsync(RELEASE_MS);
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.trackPublications.get('mic')?.track).toBe(track);
  });

  it('with stopMicOnMute off, the capture is never released while muted', async () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    await tm.setMicrophoneEnabled(false);

    await vi.advanceTimersByTimeAsync(RELEASE_MS * 3);

    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
    expect(room.localParticipant.trackPublications.has('mic')).toBe(true);
  });

  it('unmuting after the hardware was released performs a full republish', async () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', true);
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    const firstTrack = room.localParticipant.trackPublications.get('mic')?.track;
    await tm.setMicrophoneEnabled(false);
    await vi.advanceTimersByTimeAsync(RELEASE_MS);
    expect(room.localParticipant.trackPublications.has('mic')).toBe(false);

    await tm.setMicrophoneEnabled(true);

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(2);
    const secondTrack = room.localParticipant.trackPublications.get('mic')?.track;
    expect(secondTrack).toBeTruthy();
    expect(secondTrack).not.toBe(firstTrack);
  });

  it('live-enabling stopMicOnMute while already muted schedules a release', async () => {
    useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
    const room = makeRoom();
    const tm = makeManager(room);

    await tm.setMicrophoneEnabled(true);
    const track = room.localParticipant.trackPublications.get('mic')?.track;
    await tm.setMicrophoneEnabled(false);

    // Flip the privacy policy on while muted → a release must now be scheduled.
    tm.applyStopMicOnMute(true);
    await vi.advanceTimersByTimeAsync(RELEASE_MS);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
  });
});
