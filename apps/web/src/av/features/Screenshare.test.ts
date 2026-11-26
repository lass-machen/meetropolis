import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LocalTrack } from 'livekit-client';
import { Screenshare, type ScreenshareDeps } from './Screenshare';
import { createLocalScreenTracks } from 'livekit-client';

vi.mock('livekit-client', () => ({
  createLocalScreenTracks: vi.fn(),
}));

const screenTracksMock = vi.mocked(createLocalScreenTracks);

type FakeMst = EventTarget & { readyState: string };

interface FakeScreenTrack {
  fakeMst: FakeMst;
  track: LocalTrack;
}

function makeFakeScreenTrack(): FakeScreenTrack {
  const fakeMst = new EventTarget() as FakeMst;
  fakeMst.readyState = 'live';
  const track = {
    kind: 'video',
    mediaStreamTrack: fakeMst,
    stop: vi.fn(),
  } as unknown as LocalTrack;
  return { fakeMst, track };
}

interface CreatedTrack {
  mediaStreamTrack: FakeMst;
  stop: ReturnType<typeof vi.fn>;
}

let createdTracks: CreatedTrack[] = [];

function lastCreated(): CreatedTrack {
  const track = createdTracks[createdTracks.length - 1];
  if (!track) throw new Error('no screen track created');
  return track;
}

function makeDeps() {
  const localParticipant = {
    trackPublications: new Map<string, unknown>(),
    publishTrack: vi.fn(async () => {}),
    unpublishTrack: vi.fn(async () => {}),
  };
  const room = { localParticipant } as never;
  const deps: ScreenshareDeps = {
    getRoom: () => room,
    isSignalOpen: () => true,
    ensureConnected: async () => {},
    waitForConnected: () => Promise.resolve(true),
  };
  return { deps, localParticipant };
}

let visibilityState = 'visible';

function setVisibility(state: string): void {
  visibilityState = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('Screenshare background-stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    createdTracks = [];
    screenTracksMock.mockImplementation(() => {
      const made = makeFakeScreenTrack();
      createdTracks.push(made.track as unknown as CreatedTrack);
      return Promise.resolve([made.track]);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hidden-ended-visible does not capture again without explicit start', async () => {
    const { deps } = makeDeps();
    const screen = new Screenshare(deps);

    expect(await screen.start()).toBe(true);
    expect(screenTracksMock).toHaveBeenCalledTimes(1);
    const track = lastCreated();

    setVisibility('hidden');
    track.mediaStreamTrack.dispatchEvent(new Event('ended'));

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);

    expect(screenTracksMock).toHaveBeenCalledTimes(1);
    expect(screen.isSharing).toBe(false);
    screen.dispose();
  });

  it('visible ended stops the share', async () => {
    const { deps } = makeDeps();
    const screen = new Screenshare(deps);

    expect(await screen.start()).toBe(true);
    const track = lastCreated();

    track.mediaStreamTrack.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.isSharing).toBe(false);
    expect(screen.desiredSharing).toBe(false);
    expect(track.stop).toHaveBeenCalled();
    screen.dispose();
  });

  it('explicit start works again after ended', async () => {
    const { deps } = makeDeps();
    const screen = new Screenshare(deps);

    expect(await screen.start()).toBe(true);
    const track = lastCreated();
    track.mediaStreamTrack.dispatchEvent(new Event('ended'));
    await vi.advanceTimersByTimeAsync(0);

    expect(await screen.start()).toBe(true);
    expect(screenTracksMock).toHaveBeenCalledTimes(2);
    expect(screen.isSharing).toBe(true);
    screen.dispose();
  });

  it('does not recapture after stop or dispose', async () => {
    const { deps, localParticipant } = makeDeps();
    const screen = new Screenshare(deps);

    expect(await screen.start()).toBe(true);
    const track = lastCreated();

    await screen.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(screen.isSharing).toBe(false);

    setVisibility('hidden');
    track.mediaStreamTrack.dispatchEvent(new Event('ended'));
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(5000);
    expect(screenTracksMock).toHaveBeenCalledTimes(1);

    expect(await screen.start()).toBe(true);
    screen.dispose();
    setVisibility('hidden');
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(5000);
    expect(screenTracksMock).toHaveBeenCalledTimes(2);
    expect(localParticipant.unpublishTrack).toHaveBeenCalled();
  });
});
