import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AVManager } from './avManager';
import type { LocalTrack } from 'livekit-client';

interface MockTrack {
  kind: 'audio' | 'video';
}

interface CreateLocalTracksOptions {
  audio?: boolean;
  video?: boolean;
}

// Mock livekit-client dynamic imports used inside AVManager
vi.mock('livekit-client', () => {
  return {
    // For mic/cam enabling
    createLocalTracks: vi.fn((opts?: CreateLocalTracksOptions): LocalTrack[] => {
      const tracks: MockTrack[] = [];
      if (opts?.audio) tracks.push({ kind: 'audio' });
      if (opts?.video) tracks.push({ kind: 'video' });
      return tracks as LocalTrack[];
    }),
    // For screenshare
    createLocalScreenTracks: vi.fn((): LocalTrack[] => [{ kind: 'video' }, { kind: 'audio' }] as LocalTrack[]),
  };
});

// Mock joinLivekitRoom to return a minimal fake room
vi.mock('../lib/livekit', () => {
  return {
    joinLivekitRoom: vi.fn(() => {
      type Handler = (...args: unknown[]) => unknown;
      const handlers: Record<string, Handler[]> = {};
      const room: any = {
        localParticipant: {
          trackPublications: new Map<string, any>(),
          publishTrack: vi.fn(async () => {
            /* noop */
          }),
          unpublishTrack: vi.fn(async (_t: any) => {
            /* noop */
          }),
        },
        remoteParticipants: new Map<string, any>(),
        disconnect: vi.fn(async () => {}),
        on: (ev: string, cb: Handler) => {
          (handlers[ev] ||= []).push(cb);
        },
        off: (ev: string, cb: Handler) => {
          handlers[ev] = (handlers[ev] || []).filter((f) => f !== cb);
        },
        __emit: (ev: string, ...args: any[]) => {
          (handlers[ev] || []).forEach((f) => f(...args));
        },
      };
      return room;
    }),
  };
});

function makeManager(): AVManager {
  return new AVManager({ baseUrl: 'http://localhost:2568', identity: 'me', displayName: 'Me', useVideo: true });
}

function makeFakeRoom() {
  const published: any[] = [];
  const unpublished: any[] = [];
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn((t: any) => {
      published.push(t);
    }),
    unpublishTrack: vi.fn((t: any) => {
      unpublished.push(t);
    }),
  };
  const remoteParticipants = new Map<string, any>();
  return { localParticipant, remoteParticipants, __published: published, __unpublished: unpublished } as any;
}

describe('AVManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setParticipantVolume calls setVolume on RemoteAudioTracks and clamps values to [0,1]', () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    const sid = 'P1';
    const setVolume = vi.fn();
    room.remoteParticipants.set(sid, {
      trackPublications: new Map([['audio', { track: { setVolume } }]]),
    });
    mgr.current = room;

    // Below 0 is clamped.
    mgr.setParticipantVolume(sid, -1);
    // Above 1 is clamped.
    mgr.setParticipantVolume(sid, 5);
    // In-range value.
    mgr.setParticipantVolume(sid, 0.5);

    expect(setVolume).toHaveBeenCalledTimes(3);
    expect(setVolume).toHaveBeenNthCalledWith(1, 0);
    expect(setVolume).toHaveBeenNthCalledWith(2, 1);
    expect(setVolume).toHaveBeenNthCalledWith(3, 0.5);
  });

  it('setMicrophoneEnabled(true) publishes audio track; false soft-mutes without unpublish', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Initially off (no audio tracks)
    await mgr.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();

    // Soft-Mute: Track-Publication bleibt erhalten, kein unpublishTrack-Aufruf.
    await mgr.setMicrophoneEnabled(false);
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('setMicrophoneEnabled(true) does not republish when mic is already active', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Bereits live publizierter Mic-Track
    const liveMic: any = { kind: 'audio', mediaStreamTrack: { readyState: 'live', enabled: true } };
    room.localParticipant.trackPublications.set('mic', { track: liveMic, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(true);

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('setCameraEnabled(true) publishes video track, false unpublishes', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    await mgr.setCameraEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();

    // Simuliere vorhandene Kamera-Publikation
    room.localParticipant.trackPublications.set('cam', { track: { kind: 'video' }, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalled();
  });

  it('setCameraEnabled(true) does not republish when camera is already active', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const liveCam: any = { kind: 'video', mediaStreamTrack: { readyState: 'live', enabled: true } };
    room.localParticipant.trackPublications.set('cam', { track: liveCam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(true);

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('startScreenshare publishes screen tracks', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    await mgr.startScreenshare();
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('startScreenshare is idempotent when screensharing is already active', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Markiere bereits aktive Screen-Share-Pubs
    room.localParticipant.trackPublications.set('shareV', {
      track: { kind: 'video' },
      source: 'screen_share',
      kind: 'video',
    });
    room.localParticipant.trackPublications.set('shareA', {
      track: { kind: 'audio' },
      source: 'screen_share_audio',
      kind: 'audio',
    });

    await mgr.startScreenshare();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('stopScreenshare unpublishes existing screen-share tracks', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const v: any = { kind: 'video', stop: vi.fn() };
    const a: any = { kind: 'audio', stop: vi.fn() };
    room.localParticipant.trackPublications.set('shareV', { track: v, source: 'screen_share', kind: 'video' });
    room.localParticipant.trackPublications.set('shareA', { track: a, source: 'screen_share_audio', kind: 'audio' });

    await mgr.stopScreenshare();

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(v);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(a);
  });

  // Note: the 'sets initial remote audio volume' test was removed after the
  // refactor. The wireRoomEvents method no longer exists; events are handled
  // by SubscriptionManager.

  it('re-publishes mic when existing track is ended/disabled', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Simuliere alten, beendeten Mic-Track
    const endedTrack: any = { kind: 'audio', mediaStreamTrack: { readyState: 'ended', enabled: false }, stop: vi.fn() };
    room.localParticipant.trackPublications.set('mic', { track: endedTrack, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(true);

    // Erwartung: alter Track wurde entfernt, neuer publiziert
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(endedTrack);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('Mute disables track locally via soft-mute (no unpublish)', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Erst publishen, damit TrackManager._state.microphone.track gesetzt ist.
    await mgr.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();

    await mgr.setMicrophoneEnabled(false);
    // Soft-Mute: Track bleibt publiziert, nur RTP-Mute (bzw. mediaStreamTrack.enabled=false).
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('re-publishes camera when existing track is ended/disabled', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const endedCam: any = { kind: 'video', mediaStreamTrack: { readyState: 'ended', enabled: false }, stop: vi.fn() };
    room.localParticipant.trackPublications.set('cam', { track: endedCam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(true);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(endedCam);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('camera disable turns off track locally and triggers unpublish', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const cam: any = {
      kind: 'video',
      mediaStreamTrack: { enabled: true },
      setEnabled: vi.fn((v: boolean) => {
        cam.mediaStreamTrack.enabled = v;
      }),
    };
    room.localParticipant.trackPublications.set('cam', { track: cam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(false);

    expect(cam.mediaStreamTrack.enabled).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(cam);
  });

  // Note: Tests for 'closed signal' scenarios removed after refactor
  // The internal signal handling has been moved to ConnectionManager and PublishingManager
  // These implementation details are now covered by integration tests

  it('enables mic after join when previously pending (deterministic join order)', async () => {
    vi.useFakeTimers();
    const { joinLivekitRoom } = await import('../lib/livekit');
    const mgr = makeManager() as any;
    // Mic vor Connect einschalten → pending flag
    await mgr.setMicrophoneEnabled(true);
    // Trigger the join.
    const p = mgr.switchTo('world');
    // Wait for switchTo to resolve.
    await p;
    // The pending activation runs via setTimeout(250).
    vi.advanceTimersByTime(300);
    const fakeRoom: any = await (joinLivekitRoom as any).mock.results[0].value;
    expect(fakeRoom.localParticipant.publishTrack).toHaveBeenCalled();
    vi.useRealTimers();
  });

  // Note: Test for 'Audio-Unlock-Handler' removed after refactor
  // The audioUnlockHandlersAttached flag no longer exists - logic moved to ConnectionManager
});
