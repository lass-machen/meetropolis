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
    createLocalTracks: vi.fn(async (opts?: CreateLocalTracksOptions): Promise<LocalTrack[]> => {
      const tracks: MockTrack[] = [];
      if (opts?.audio) tracks.push({ kind: 'audio' });
      if (opts?.video) tracks.push({ kind: 'video' });
      return tracks as LocalTrack[];
    }),
    // For screenshare
    createLocalScreenTracks: vi.fn(async (): Promise<LocalTrack[]> => [{ kind: 'video' }, { kind: 'audio' }] as LocalTrack[]),
  };
});

// Mock joinLivekitRoom to return a minimal fake room
vi.mock('../lib/livekit', () => {
  return {
    joinLivekitRoom: vi.fn(async () => {
      const handlers: Record<string, Function[]> = {};
      const room: any = {
        localParticipant: {
          trackPublications: new Map<string, any>(),
          publishTrack: vi.fn(async () => { /* noop */ }),
          unpublishTrack: vi.fn(async (_t: any) => { /* noop */ }),
        },
        remoteParticipants: new Map<string, any>(),
        disconnect: vi.fn(async () => {}),
        on: (ev: string, cb: Function) => { (handlers[ev] ||= []).push(cb); },
        off: (ev: string, cb: Function) => {
          handlers[ev] = (handlers[ev] || []).filter((f) => f !== cb);
        },
        __emit: (ev: string, ...args: any[]) => { (handlers[ev] || []).forEach((f) => f(...args)); },
      };
      return room;
    }),
  } as any;
});

function makeManager(): AVManager {
  return new AVManager({ baseUrl: 'http://localhost:2568', identity: 'me', displayName: 'Me', useVideo: true });
}

function makeFakeRoom() {
  const published: any[] = [];
  const unpublished: any[] = [];
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn(async (t: any) => { published.push(t); }),
    unpublishTrack: vi.fn(async (t: any) => { unpublished.push(t); }),
  };
  const remoteParticipants = new Map<string, any>();
  return { localParticipant, remoteParticipants, __published: published, __unpublished: unpublished } as any;
}

describe('AVManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setParticipantVolume ruft setVolume der RemoteAudioTracks auf und klemmt Werte in [0,1]', () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    const sid = 'P1';
    const setVolume = vi.fn();
    room.remoteParticipants.set(sid, {
      trackPublications: new Map([
        ['audio', { track: { setVolume } }],
      ]),
    });
    mgr.current = room;

    // Unter 0 wird geklemmt
    mgr.setParticipantVolume(sid, -1);
    // Über 1 wird geklemmt
    mgr.setParticipantVolume(sid, 5);
    // Normalwert
    mgr.setParticipantVolume(sid, 0.5);

    expect(setVolume).toHaveBeenCalledTimes(3);
    expect(setVolume).toHaveBeenNthCalledWith(1, 0);
    expect(setVolume).toHaveBeenNthCalledWith(2, 1);
    expect(setVolume).toHaveBeenNthCalledWith(3, 0.5);
  });

  it('setMicrophoneEnabled(true) publiziert Audio-Track, false unpubliziert', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Initially off (no audio tracks)
    await mgr.setMicrophoneEnabled(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();

    // Simuliere vorhandene Mic-Publikation
    room.localParticipant.trackPublications.set('mic', { track: { kind: 'audio' }, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalled();
  });

  it('setMicrophoneEnabled(true) bei bereits aktivem Mic republished nicht erneut', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Bereits live publizierter Mic-Track
    const liveMic: any = { kind: 'audio', mediaStreamTrack: { readyState: 'live', enabled: true } };
    room.localParticipant.trackPublications.set('mic', { track: liveMic, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(true);

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('setCameraEnabled(true) publiziert Video-Track, false unpubliziert', async () => {
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

  it('setCameraEnabled(true) bei bereits aktiver Kamera republished nicht erneut', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const liveCam: any = { kind: 'video', mediaStreamTrack: { readyState: 'live', enabled: true } };
    room.localParticipant.trackPublications.set('cam', { track: liveCam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(true);

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('startScreenshare publiziert Screen-Tracks', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    await mgr.startScreenshare();
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('startScreenshare ist idempotent, wenn bereits Screensharing aktiv ist', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    // Markiere bereits aktive Screen-Share-Pubs
    room.localParticipant.trackPublications.set('shareV', { track: { kind: 'video' }, source: 'screen_share', kind: 'video' });
    room.localParticipant.trackPublications.set('shareA', { track: { kind: 'audio' }, source: 'screen_share_audio', kind: 'audio' });

    await mgr.startScreenshare();

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('stopScreenshare unpubliziert vorhandene Screen-Share-Tracks', async () => {
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

  it('setzt initiale Remote-Audio-Lautstärke auf 0 bei TrackSubscribed (sicherer Start)', async () => {
    const mgr = makeManager() as any;
    // Fake-Raum mit Event-Emitter (string events)
    const handlers: Record<string, Function[]> = {};
    const room: any = {
      localParticipant: { sid: 'local', trackPublications: new Map<string, any>() },
      remoteParticipants: new Map<string, any>(),
      on: (ev: string, cb: Function) => { (handlers[ev] ||= []).push(cb); },
      off: (ev: string, cb: Function) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== cb); },
      __emit: (ev: string, ...args: any[]) => { (handlers[ev] || []).forEach((f) => f(...args)); },
    };
    mgr.current = room;
    // Events verdrahten
    (mgr as any).wireRoomEvents();

    const setVolume = vi.fn();
    const track: any = { kind: 'audio', setVolume };
    const pub: any = { kind: 'audio', track };
    const participant: any = { sid: 'remote1' };

    // Event auslösen
    room.__emit('trackSubscribed', track, pub, participant);

    expect(setVolume).toHaveBeenCalledTimes(1);
    expect(setVolume).toHaveBeenCalledWith(0);
  });

  it('re-publiziert Mic, wenn vorhandener Track beendet/disabled ist', async () => {
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

  it('Mute deaktiviert Track sofort lokal und triggert Unpublish', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const track: any = { kind: 'audio', mediaStreamTrack: { enabled: true }, setEnabled: vi.fn((v: boolean) => { track.mediaStreamTrack.enabled = v; }) };
    room.localParticipant.trackPublications.set('mic', { track, source: 'microphone', kind: 'audio' });

    await mgr.setMicrophoneEnabled(false);

    expect(track.mediaStreamTrack.enabled).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(track);
  });

  it('re-publiziert Kamera, wenn vorhandener Track beendet/disabled ist', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const endedCam: any = { kind: 'video', mediaStreamTrack: { readyState: 'ended', enabled: false }, stop: vi.fn() };
    room.localParticipant.trackPublications.set('cam', { track: endedCam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(true);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(endedCam);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('Kamera-Deaktivierung setzt Track sofort lokal aus und triggert Unpublish', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    const cam: any = { kind: 'video', mediaStreamTrack: { enabled: true }, setEnabled: vi.fn((v: boolean) => { cam.mediaStreamTrack.enabled = v; }) };
    room.localParticipant.trackPublications.set('cam', { track: cam, source: 'camera', kind: 'video' });

    await mgr.setCameraEnabled(false);

    expect(cam.mediaStreamTrack.enabled).toBe(false);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(cam);
  });

  it('Toggles während geschlossenem Signal werden pending gesetzt und Fast-Reconnect getriggert (Mic)', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;
    (mgr as any).currentName = 'world';
    (mgr as any).isSignalOpen = () => false; // Signal geschlossen
    const switchSpy = vi.spyOn(mgr as any, 'switchTo').mockResolvedValue(undefined);

    await mgr.setMicrophoneEnabled(true);

    expect(switchSpy).toHaveBeenCalledWith('world');
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('Toggles während geschlossenem Signal werden pending gesetzt und Fast-Reconnect getriggert (Cam)', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;
    (mgr as any).currentName = 'world';
    (mgr as any).isSignalOpen = () => false; // Signal geschlossen
    const switchSpy = vi.spyOn(mgr as any, 'switchTo').mockResolvedValue(undefined);

    await mgr.setCameraEnabled(true);

    expect(switchSpy).toHaveBeenCalledWith('world');
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('startScreenshare bei geschlossenem Signal löst Fast-Reconnect aus und publiziert nicht sofort', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;
    (mgr as any).currentName = 'world';
    let open = false;
    (mgr as any).isSignalOpen = () => open; // zunächst geschlossen
    const switchSpy = vi.spyOn(mgr as any, 'switchTo').mockImplementation(async () => { open = true; });

    const ok = await mgr.startScreenshare();

    expect(switchSpy).toHaveBeenCalledWith('world');
    expect(ok).toBe(true);
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });

  it('aktiviert Mic nach Join, wenn vorher pending war (Join-Order deterministisch)', async () => {
    vi.useFakeTimers();
    const { joinLivekitRoom } = await import('../lib/livekit');
    const mgr = makeManager() as any;
    // Mic vor Connect einschalten → pending flag
    await mgr.setMicrophoneEnabled(true);
    // Join triggern
    const p = mgr.switchTo('world');
    // Warten bis switchTo Promise resolved
    await p;
    // Pending-Activation läuft via setTimeout(250)
    vi.advanceTimersByTime(300);
    const fakeRoom: any = (await (joinLivekitRoom as any).mock.results[0].value);
    expect(fakeRoom.localParticipant.publishTrack).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('Audio-Unlock-Handler ruft startAudio genau einmal und cleaned danach auf', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom() as any;
    room.canPlaybackAudio = false;
    room.startAudio = vi.fn(async () => { room.canPlaybackAudio = true; });
    mgr.current = room;

    // Handler anhängen
    (mgr as any).attachAudioUnlockHandlers();
    expect((mgr as any).audioUnlockHandlersAttached).toBe(true);

    // Erste Geste triggert startAudio
    window.dispatchEvent(new Event('pointerdown'));
    expect(room.startAudio).toHaveBeenCalledTimes(1);

    // Nach erfolgreichem Unlock sollten Handler entfernt sein
    expect((mgr as any).audioUnlockHandlersAttached).toBe(false);

    // Weitere Gesten haben keinen Effekt mehr
    window.dispatchEvent(new Event('click'));
    expect(room.startAudio).toHaveBeenCalledTimes(1);
  });
});


