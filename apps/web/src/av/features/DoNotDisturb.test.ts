import { describe, expect, it, vi } from 'vitest';
import { DoNotDisturb } from './DoNotDisturb';

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
});

