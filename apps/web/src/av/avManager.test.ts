import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AVManager } from './avManager';
import { useAvSettingsStore } from '../state/avSettings';
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
          setTrackSubscriptionPermissions: vi.fn(),
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

    // Soft-mute: track publication is preserved, no unpublishTrack call.
    await mgr.setMicrophoneEnabled(false);
    expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
  });

  it('setMicrophoneEnabled(true) does not republish when mic is already active', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Already-live published mic track
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

    // Simulate an existing camera publication
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

    // Mark already-active screen-share publications
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

    // Simulate an old, ended mic track
    const endedTrack: any = { kind: 'audio', mediaStreamTrack: { readyState: 'ended', enabled: false }, stop: vi.fn() };
    room.localParticipant.trackPublications.set('mic', { track: endedTrack, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(true);

    // Expectation: the old track has been removed and a new one published
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(endedTrack);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('Mute disables track locally via soft-mute (no unpublish)', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Publish first so that TrackManager._state.microphone.track is set.
    await mgr.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();

    await mgr.setMicrophoneEnabled(false);
    // Soft-mute: track remains published, only RTP-mute (or mediaStreamTrack.enabled=false).
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
    // Enable mic before connect to trigger the pending flag
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

  describe('DND audio ducking suppression', () => {
    const originalAudioSession = (navigator as any).audioSession;

    beforeEach(async () => {
      (navigator as any).audioSession = { type: 'auto' };
      const { resetAudioDucking } = await import('./audio/audioSessionDucking');
      resetAudioDucking();
    });

    afterEach(() => {
      if (originalAudioSession === undefined) {
        delete (navigator as any).audioSession;
      } else {
        (navigator as any).audioSession = originalAudioSession;
      }
    });

    it('setDoNotDisturb(true) releases ducking, setDoNotDisturb(false) restores it', async () => {
      const mgr = makeManager() as any;

      await mgr.setDoNotDisturb(true);
      expect((navigator as any).audioSession.type).toBe('playback');

      await mgr.setDoNotDisturb(false);
      expect((navigator as any).audioSession.type).toBe('auto');
    });

    it('dispose releases the DND ducking suppression', async () => {
      const mgr = makeManager() as any;

      await mgr.setDoNotDisturb(true);
      expect((navigator as any).audioSession.type).toBe('playback');

      mgr.dispose();
      expect((navigator as any).audioSession.type).toBe('auto');
    });

    it('keeps ducking released after DND exit when the desktop preference disables it', async () => {
      const { setAudioDuckingPreference } = await import('./audio/audioSessionDucking');
      const mgr = makeManager() as any;

      setAudioDuckingPreference(false);
      await mgr.setDoNotDisturb(true);
      await mgr.setDoNotDisturb(false);
      expect((navigator as any).audioSession.type).toBe('playback');
    });
  });

  describe('avSettings live-apply (FIX 2a + republish)', () => {
    afterEach(() => {
      useAvSettingsStore.getState().reset();
      vi.useRealTimers();
    });

    it('debounces rapid capture-affecting changes into a single republishMicrophone call', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);

      // Three rapid changes within the debounce window (default 600ms).
      useAvSettingsStore.getState().setSetting('echoCancellation', false);
      useAvSettingsStore.getState().setSetting('noiseSuppression', false);
      useAvSettingsStore.getState().setSetting('autoGainControl', false);

      expect(republishSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(700);

      expect(republishSpy).toHaveBeenCalledTimes(1);
    });

    it('does not republish for settings outside the capture signature (opusBitrateKbps, highpassFilter, compressor, dtx/fec)', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);

      useAvSettingsStore.getState().setSetting('opusBitrateKbps', 40);
      useAvSettingsStore.getState().setSetting('highpassFilter', false);
      useAvSettingsStore.getState().setSetting('compressor', true);
      useAvSettingsStore.getState().setSetting('useDtx', false);
      useAvSettingsStore.getState().setSetting('useFec', false);
      useAvSettingsStore.getState().setSetting('clientVoiceIsolation', false);

      await vi.advanceTimersByTimeAsync(700);

      expect(republishSpy).not.toHaveBeenCalled();
    });

    it('republishes when a preset switch changes a signature-relevant field (echoCancellation/autoGainControl)', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);

      // 'studio' flips echoCancellation/autoGainControl relative to the
      // 'standard' default — this is a real constraint change and must
      // republish, even though it arrives via applyPreset() rather than a
      // direct setSetting() call.
      useAvSettingsStore.getState().applyPreset('studio');

      await vi.advanceTimersByTimeAsync(700);

      expect(republishSpy).toHaveBeenCalledTimes(1);
    });

    it('does not republish when the signature is unchanged (setSetting to the same value)', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);
      const current = useAvSettingsStore.getState().settings.echoCancellation;

      useAvSettingsStore.getState().setSetting('echoCancellation', current);

      await vi.advanceTimersByTimeAsync(700);

      expect(republishSpy).not.toHaveBeenCalled();
    });

    it('mirrors stopMicOnMute onto TrackManager immediately, without a debounced republish', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const applySpy = vi.spyOn(mgr.trackManager, 'applyStopMicOnMute');
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);

      useAvSettingsStore.getState().setSetting('stopMicOnMute', false);

      expect(applySpy).toHaveBeenCalledWith(false);

      await vi.advanceTimersByTimeAsync(700);

      expect(republishSpy).not.toHaveBeenCalled();
    });

    it('stops applying avSettings changes after dispose()', async () => {
      vi.useFakeTimers();
      const mgr = makeManager() as any;
      const applySpy = vi.spyOn(mgr.trackManager, 'applyStopMicOnMute');
      const republishSpy = vi.spyOn(mgr.publishingManager, 'republishMicrophone').mockResolvedValue(undefined);

      mgr.dispose();

      useAvSettingsStore.getState().setSetting('stopMicOnMute', false);
      useAvSettingsStore.getState().setSetting('echoCancellation', false);
      await vi.advanceTimersByTimeAsync(700);

      expect(applySpy).not.toHaveBeenCalled();
      expect(republishSpy).not.toHaveBeenCalled();
    });
  });
});

describe('AVManager - H4 audio-zone privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies a deny-all subscription-permission baseline before publishing any track', async () => {
    const { joinLivekitRoom } = await import('../lib/livekit');
    const mgr = makeManager();

    await mgr.switchTo('world');

    const fakeRoom: any = await (joinLivekitRoom as any).mock.results[0].value;
    expect(fakeRoom.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, []);
  });

  it('applyZonePermissions narrows the deny-all baseline to the pushed allow-list', async () => {
    const { joinLivekitRoom } = await import('../lib/livekit');
    const mgr = makeManager();
    await mgr.switchTo('world');
    const fakeRoom: any = await (joinLivekitRoom as any).mock.results[0].value;
    (fakeRoom.localParticipant.setTrackSubscriptionPermissions as ReturnType<typeof vi.fn>).mockClear();

    mgr.applyZonePermissions({ islandId: 'map-1:zone:kitchen', allow: ['bob', 'carol'] });

    expect(fakeRoom.localParticipant.setTrackSubscriptionPermissions).toHaveBeenCalledWith(false, [
      { participantIdentity: 'bob', allowAll: true },
      { participantIdentity: 'carol', allowAll: true },
    ]);
  });

  it('applyZonePermissions is a no-op when not connected to any room', () => {
    const mgr = makeManager();
    expect(() => mgr.applyZonePermissions({ islandId: 'map-1:open', allow: [] })).not.toThrow();
  });
});
