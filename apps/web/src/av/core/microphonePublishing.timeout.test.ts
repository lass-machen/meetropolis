import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { publishMicrophone } from './microphonePublishing';
import type { LocalTrackState } from './types';

// Block buildAudioPipeline's publish path so we can assert the timeout fires.
vi.mock('../audio/buildAudioPipeline', () => {
  return {
    buildAudioPipeline: vi.fn(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    ),
  };
});

function makeRoom() {
  const localParticipant = {
    trackPublications: new Map<string, any>(),
    publishTrack: vi.fn(async () => {}),
    unpublishTrack: vi.fn(async () => {}),
  };
  return { localParticipant } as any;
}

function makeState(): LocalTrackState {
  return {
    desired: true,
    published: false,
    pending: false,
    track: null,
    preferredDeviceId: undefined,
  };
}

describe('publishMicrophone timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with publish_timeout when the publish path hangs', async () => {
    vi.useFakeTimers();

    const room = makeRoom();
    const state = makeState();

    const publishPromise = publishMicrophone({
      room,
      state,
      watchTrackEnded: () => {},
      onTrackPublished: () => {},
      onTrackEndedByBrowser: () => {},
    });

    const handled = publishPromise.catch((e) => e);

    // Default VITE_MIC_PUBLISH_TIMEOUT_MS = 10_000
    await vi.advanceTimersByTimeAsync(10_001);

    const err = await handled;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('publish_timeout');

    // Sanity: nothing ever got published successfully
    expect(state.published).toBe(false);
    expect(state.track).toBe(null);
  });
});
