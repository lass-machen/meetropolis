import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AVManager } from './avManager';

// Mock livekit-client dynamic imports used inside AVManager
vi.mock('livekit-client', () => {
  return {
    // For mic/cam enabling
    createLocalTracks: vi.fn(async (opts?: any) => {
      const tracks: any[] = [];
      if (opts?.audio) tracks.push({ kind: 'audio' });
      if (opts?.video) tracks.push({ kind: 'video' });
      return tracks;
    }),
    // For screenshare
    createLocalScreenTracks: vi.fn(async () => [{ kind: 'video' }, { kind: 'audio' }]),
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

  it('startScreenshare publiziert Screen-Tracks', async () => {
    const mgr = makeManager() as any;
    const room = makeFakeRoom();
    mgr.current = room;

    await mgr.startScreenshare();
    expect(room.localParticipant.publishTrack).toHaveBeenCalled();
  });
});


