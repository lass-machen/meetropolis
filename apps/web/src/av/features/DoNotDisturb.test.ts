import { describe, expect, it, vi, afterEach } from 'vitest';
import { DoNotDisturb } from './DoNotDisturb';
import { TrackManager } from '../core/TrackManager';
import { useAvSettingsStore } from '../../state/avSettings';

// TrackManager builds mic tracks through buildAudioPipeline; stub it so the
// DND + hard-close integration tests below don't depend on WebAudio/worklet
// availability in jsdom.
vi.mock('../audio/buildAudioPipeline', () => ({
  buildAudioPipeline: vi.fn(() => {
    const mst: any = {
      id: 'mst-dnd',
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
}));

/**
 * Wait until the internal `enqueue()` chain has drained.
 *
 * `setEnabled()` schedules side-effects on a Promise chain; simply awaiting
 * `setEnabled()` is not enough because the returned promise resolves as soon
 * as `prepareEnable()` / `prepareDisable()` + `enqueue()` finish, NOT when
 * the side-effects themselves have completed.
 *
 * Yielding the microtask queue a few times is enough to flush the
 * `_op.then(task)` chain in the implementation.
 */
async function flushDndQueue(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

describe('DoNotDisturb', () => {
  it('updates enabled state without blocking on track ops', async () => {
    const pending = new Promise<void>(() => {});
    const dnd = new DoNotDisturb({
      setMicrophoneEnabled: vi.fn(async () => pending),
      setCameraEnabled: vi.fn(async () => pending),
      stopScreenshare: vi.fn(async () => pending),
      isMicrophoneEnabled: () => true,
      isCameraEnabled: () => true,
      muteAllRemote: vi.fn(),
      restoreAllRemote: vi.fn(),
    });

    await dnd.setEnabled(true);

    expect(dnd.enabled).toBe(true);
  });

  describe('disable (DND exit)', () => {
    it('calls restoreAllRemote, refreshRemoteAudioElements, and forceResubscribe in the correct order', async () => {
      const order: string[] = [];
      const restoreAllRemote = vi.fn(() => {
        order.push('restoreAllRemote');
      });
      const refreshRemoteAudioElements = vi.fn(() => {
        order.push('refreshRemoteAudioElements');
      });
      const forceResubscribe = vi.fn(() => {
        order.push('forceResubscribe');
      });
      const setMicrophoneEnabled = vi.fn((enabled: boolean): Promise<void> => {
        order.push(`setMicrophoneEnabled:${enabled}`);
        return Promise.resolve();
      });

      const dnd = new DoNotDisturb({
        setMicrophoneEnabled,
        setCameraEnabled: vi.fn(async () => {}),
        stopScreenshare: vi.fn(async () => {}),
        isMicrophoneEnabled: () => true,
        isCameraEnabled: () => false,
        muteAllRemote: vi.fn(),
        restoreAllRemote,
        refreshRemoteAudioElements,
        forceResubscribe,
      });

      // Enable DND first (so disable has something to revert)
      await dnd.setEnabled(true);
      await flushDndQueue();

      // Clear call history from enable phase
      restoreAllRemote.mockClear();
      refreshRemoteAudioElements.mockClear();
      forceResubscribe.mockClear();
      setMicrophoneEnabled.mockClear();
      order.length = 0;

      // Now disable DND (the path under test)
      await dnd.setEnabled(false);
      await flushDndQueue();

      expect(restoreAllRemote).toHaveBeenCalledTimes(1);
      expect(refreshRemoteAudioElements).toHaveBeenCalledTimes(1);
      expect(forceResubscribe).toHaveBeenCalledTimes(1);

      // Order: restoreAllRemote -> refreshRemoteAudioElements -> forceResubscribe
      const restoreIdx = order.indexOf('restoreAllRemote');
      const refreshIdx = order.indexOf('refreshRemoteAudioElements');
      const resubIdx = order.indexOf('forceResubscribe');
      expect(restoreIdx).toBeGreaterThanOrEqual(0);
      expect(refreshIdx).toBeGreaterThan(restoreIdx);
      expect(resubIdx).toBeGreaterThan(refreshIdx);
    });

    it('restores microphone only when micBeforeDND was true', async () => {
      const setMicrophoneEnabled = vi.fn(async () => {});
      const dnd = new DoNotDisturb({
        setMicrophoneEnabled,
        setCameraEnabled: vi.fn(async () => {}),
        stopScreenshare: vi.fn(async () => {}),
        isMicrophoneEnabled: () => true, // mic was ON before DND
        isCameraEnabled: () => false,
        muteAllRemote: vi.fn(),
        restoreAllRemote: vi.fn(),
        refreshRemoteAudioElements: vi.fn(),
        forceResubscribe: vi.fn(),
      });

      await dnd.setEnabled(true);
      await flushDndQueue();
      setMicrophoneEnabled.mockClear();

      await dnd.setEnabled(false);
      await flushDndQueue();

      // Mic was ON, so restore should call setMicrophoneEnabled(true)
      expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
    });

    it('does NOT restore microphone when micBeforeDND was false', async () => {
      const setMicrophoneEnabled = vi.fn<(enabled: boolean) => Promise<void>>(async () => {});
      const dnd = new DoNotDisturb({
        setMicrophoneEnabled,
        setCameraEnabled: vi.fn(async () => {}),
        stopScreenshare: vi.fn(async () => {}),
        isMicrophoneEnabled: () => false, // mic was OFF before DND
        isCameraEnabled: () => false,
        muteAllRemote: vi.fn(),
        restoreAllRemote: vi.fn(),
        refreshRemoteAudioElements: vi.fn(),
        forceResubscribe: vi.fn(),
      });

      await dnd.setEnabled(true);
      await flushDndQueue();
      setMicrophoneEnabled.mockClear();

      await dnd.setEnabled(false);
      await flushDndQueue();

      // Mic was OFF before DND; disableSideEffects must not re-enable it
      const calls = setMicrophoneEnabled.mock.calls.map((c) => c[0]);
      expect(calls).not.toContain(true);
    });

    it('tolerates missing optional callbacks (backwards compat)', async () => {
      // Construct DND without the new optional callbacks -> must not throw
      const dnd = new DoNotDisturb({
        setMicrophoneEnabled: vi.fn(async () => {}),
        setCameraEnabled: vi.fn(async () => {}),
        stopScreenshare: vi.fn(async () => {}),
        isMicrophoneEnabled: () => true,
        isCameraEnabled: () => false,
        muteAllRemote: vi.fn(),
        restoreAllRemote: vi.fn(),
        // forceResubscribe + refreshRemoteAudioElements intentionally omitted
      });

      await dnd.setEnabled(true);
      await flushDndQueue();
      await expect(dnd.setEnabled(false)).resolves.toBeUndefined();
      await flushDndQueue();

      expect(dnd.enabled).toBe(false);
    });
  });

  describe('stopMicOnMute integration (real TrackManager)', () => {
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

    function makeDnd(tm: TrackManager) {
      return new DoNotDisturb({
        setMicrophoneEnabled: (enabled) => tm.setMicrophoneEnabled(enabled),
        setCameraEnabled: vi.fn(async () => {}),
        stopScreenshare: vi.fn(async () => {}),
        isMicrophoneEnabled: () => tm.isMicrophoneEnabled,
        isCameraEnabled: () => false,
        muteAllRemote: vi.fn(),
        restoreAllRemote: vi.fn(),
      });
    }

    afterEach(() => {
      useAvSettingsStore.getState().reset();
    });

    it('with stopMicOnMute=true (default), DND-enable soft-mutes instantly and preserves the publication', async () => {
      const room = makeRoom();
      const tm = new TrackManager({
        getRoom: () => room,
        isSignalOpen: () => true,
        onTrackPublished: vi.fn(),
        onAllTracksUnpublished: vi.fn(),
        ensureConnected: vi.fn(async () => {}),
      });

      await tm.setMicrophoneEnabled(true);
      const firstTrack = room.localParticipant.trackPublications.get('mic')?.track;
      expect(firstTrack).toBeTruthy();

      const dnd = makeDnd(tm);
      await dnd.setEnabled(true);
      await flushDndQueue();

      // Hybrid mute: DND mutes instantly via soft-mute — the publication (and
      // its zone allow-list) survives, the capture is only released later by the
      // grace timer (covered in TrackManager.hybridMute.test.ts). The track is
      // silenced immediately regardless.
      expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
      expect(room.localParticipant.trackPublications.has('mic')).toBe(true);
      expect(firstTrack.mediaStreamTrack.enabled).toBe(false);
    });

    it('with stopMicOnMute=true (default), DND-disable within the grace window soft-unmutes the same track', async () => {
      const room = makeRoom();
      const tm = new TrackManager({
        getRoom: () => room,
        isSignalOpen: () => true,
        onTrackPublished: vi.fn(),
        onAllTracksUnpublished: vi.fn(),
        ensureConnected: vi.fn(async () => {}),
      });

      await tm.setMicrophoneEnabled(true);
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      const track = room.localParticipant.trackPublications.get('mic')?.track;

      const dnd = makeDnd(tm);
      await dnd.setEnabled(true);
      await flushDndQueue();

      await dnd.setEnabled(false);
      await flushDndQueue();

      // Restore before the grace release fired: a soft-unmute of the surviving
      // track, no fresh publish, audible again.
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
      expect(room.localParticipant.trackPublications.get('mic')?.track).toBe(track);
      expect(track.mediaStreamTrack.enabled).toBe(true);
    });

    it('with stopMicOnMute=false, DND-enable soft-mutes and DND-disable soft-unmutes (no republish)', async () => {
      useAvSettingsStore.getState().setSetting('stopMicOnMute', false);

      const room = makeRoom();
      const tm = new TrackManager({
        getRoom: () => room,
        isSignalOpen: () => true,
        onTrackPublished: vi.fn(),
        onAllTracksUnpublished: vi.fn(),
        ensureConnected: vi.fn(async () => {}),
      });

      await tm.setMicrophoneEnabled(true);
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);

      const dnd = makeDnd(tm);
      await dnd.setEnabled(true);
      await flushDndQueue();

      expect(room.localParticipant.unpublishTrack).not.toHaveBeenCalled();
      expect(room.localParticipant.trackPublications.has('mic')).toBe(true);

      await dnd.setEnabled(false);
      await flushDndQueue();

      // Soft-unmute path: still just the one original publish.
      expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    });
  });
});
