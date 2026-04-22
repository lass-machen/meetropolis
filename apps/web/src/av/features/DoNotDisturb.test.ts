import { describe, expect, it, vi } from 'vitest';
import { DoNotDisturb } from './DoNotDisturb';

/**
 * Wait until the internal `enqueue()` chain has drained.
 *
 * `setEnabled()` schedules side-effects on a Promise chain; simply awaiting
 * `setEnabled()` is not enough because the returned promise resolves as soon
 * as `prepareEnable()` / `prepareDisable()` + `enqueue()` are done — NOT when
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
      const setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
        order.push(`setMicrophoneEnabled:${enabled}`);
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
});
