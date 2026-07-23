import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// vi.mock is hoisted above the imports, so the AVManager stub has to be
// hoisted with it.
const avStub = vi.hoisted(() => {
  const construct = vi.fn();
  const switchTo = vi.fn(async (_roomName: string) => {});

  class FakeAVManager {
    room: { on: () => void } | undefined = undefined;

    constructor(options: unknown) {
      construct(options);
    }

    async switchTo(roomName: string): Promise<void> {
      await switchTo(roomName);
      this.room = { on: () => {} };
    }

    listDevices(): Promise<{ microphones: never[]; cameras: never[] }> {
      return Promise.resolve({ microphones: [], cameras: [] });
    }

    notifyDeviceChange(): void {}

    dispose(): void {}
  }

  return { construct, switchTo, FakeAVManager };
});
vi.mock('../avManager', () => ({ AVManager: avStub.FakeAVManager }));

import { useAVManager } from './useAVManager';
import type { AVManager } from '../avManager';

function setup() {
  const editorActiveRef: React.MutableRefObject<boolean> = { current: false };
  const avRef: React.MutableRefObject<AVManager | null> = { current: null };

  const view = renderHook(() =>
    useAVManager({
      apiBase: 'http://localhost:3000',
      me: { id: 'u1', email: 'u1@example.test', name: 'User One' },
      editorActiveRef,
      avRef,
      setDevices: vi.fn(),
      setSelectedMicId: vi.fn(),
      setSelectedCamId: vi.fn(),
      buildParticipantList: vi.fn(),
    }),
  );

  return { view, editorActiveRef, avRef };
}

// Dispatching the gesture kicks off an async connect chain; a few microtask
// turns are needed before the AVManager stub has settled.
async function fireGesture(type: 'pointerdown' | 'keydown' = 'pointerdown'): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new Event(type));
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('useAVManager first-interaction connect', () => {
  beforeEach(() => {
    // Fake timers keep the 300 ms auto-connect and the 100 ms device refresh
    // from firing; the tests never advance the clock past them.
    vi.useFakeTimers();
    avStub.construct.mockClear();
    avStub.switchTo.mockClear();
    avStub.switchTo.mockImplementation(async () => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stays armed when the editor swallows the first gesture', async () => {
    const { editorActiveRef, avRef } = setup();

    editorActiveRef.current = true;
    await fireGesture();
    expect(avStub.construct).not.toHaveBeenCalled();
    expect(avRef.current).toBeNull();

    editorActiveRef.current = false;
    await fireGesture();
    expect(avStub.construct).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledWith('world');
  });

  it('does not connect twice for two gestures in a row', async () => {
    setup();

    await fireGesture();
    await fireGesture('keydown');

    expect(avStub.construct).toHaveBeenCalledTimes(1);
  });

  it('disarms the listeners once a room exists', async () => {
    setup();

    await fireGesture();
    expect(avStub.construct).toHaveBeenCalledTimes(1);

    await fireGesture();
    expect(avStub.construct).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledTimes(1);
  });

  it('retries on the next gesture after a failed connect', async () => {
    setup();

    avStub.switchTo.mockRejectedValueOnce(new Error('livekit unreachable'));
    await fireGesture();
    expect(avStub.switchTo).toHaveBeenCalledTimes(1);

    await fireGesture();
    expect(avStub.switchTo).toHaveBeenCalledTimes(2);
  });

  it('removes the listeners on unmount', async () => {
    const { view } = setup();

    view.unmount();
    await fireGesture();

    expect(avStub.construct).not.toHaveBeenCalled();
  });
});
