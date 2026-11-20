import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// vi.mock is hoisted above the imports, so the AVManager stub has to be
// hoisted with it.
const avStub = vi.hoisted(() => {
  const construct = vi.fn();
  const switchTo = vi.fn(async (_roomName: string) => {});
  const calls: string[] = [];
  const instances: FakeAVManager[] = [];

  class FakeAVManager {
    room: { on: () => void } | undefined = undefined;
    leave = vi.fn(() => {
      calls.push('leave');
      this.room = undefined;
      return Promise.resolve();
    });

    constructor(options: unknown) {
      construct(options);
      instances.push(this);
    }

    async switchTo(roomName: string): Promise<void> {
      await switchTo(roomName);
      this.room = { on: () => {} };
    }

    listDevices(): Promise<{ microphones: never[]; cameras: never[] }> {
      return Promise.resolve({ microphones: [], cameras: [] });
    }

    notifyDeviceChange(): void {}

    dispose(): void {
      calls.push('dispose');
    }
  }

  return { construct, switchTo, calls, instances, FakeAVManager };
});
vi.mock('../avManager', () => ({ AVManager: avStub.FakeAVManager }));

import { useAVManager } from './useAVManager';
import type { AVManager } from '../avManager';
import { AVLogger } from '../AVLogger';

function setup(onConnected?: () => void) {
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
      ...(onConnected ? { onConnected } : {}),
    }),
  );

  return { view, editorActiveRef, avRef };
}

// The start gate suspends AV until the world confirms the join.
// In these tests resume() stands in for that confirmed join: it lifts the
// gate and connects the normal way, so assertions below it keep proving the
// same gesture/teardown behavior as before, only behind the gate.
async function confirmJoin(view: { result: { current: { resume: () => void } } }): Promise<void> {
  view.result.current.resume();
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
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
    const { view, editorActiveRef, avRef } = setup();

    editorActiveRef.current = true;
    await confirmJoin(view);
    // The confirmed join alone must not start AV while the editor is
    // active; the real gesture below proves the editor still swallows it.
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
    const { view } = setup();

    await confirmJoin(view);
    await fireGesture();
    await fireGesture('keydown');

    expect(avStub.construct).toHaveBeenCalledTimes(1);
  });

  it('disarms the listeners once a room exists', async () => {
    const { view } = setup();

    await confirmJoin(view);
    expect(avStub.construct).toHaveBeenCalledTimes(1);

    await fireGesture();
    expect(avStub.construct).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledTimes(1);
  });

  it('retries on the next gesture after a failed connect', async () => {
    const { view } = setup();

    avStub.switchTo.mockRejectedValueOnce(new Error('livekit unreachable'));
    await confirmJoin(view);
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

describe('useAVManager teardown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    avStub.construct.mockClear();
    avStub.switchTo.mockClear();
    avStub.switchTo.mockImplementation(async () => {});
    avStub.calls.length = 0;
    avStub.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AVManager.dispose() leaves LiveKit before its teardown (avManager.test.ts).
  it('disposes the manager when the world unmounts', async () => {
    const { view, avRef } = setup();
    await confirmJoin(view);
    expect(avRef.current).toBe(avStub.instances[0]);

    view.unmount();

    expect(avStub.calls).toEqual(['dispose']);
    expect(avRef.current).toBeNull();
  });

  it('disposes a failed attempt before the next one, so a retry starts clean', async () => {
    const { view, avRef } = setup();
    avStub.switchTo.mockRejectedValueOnce(new Error('livekit unreachable'));

    await confirmJoin(view);

    expect(avStub.calls).toEqual(['dispose']);
    expect(avRef.current).toBeNull();
  });
});

describe('useAVManager suspension on terminal world errors', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    avStub.construct.mockClear();
    avStub.switchTo.mockClear();
    avStub.switchTo.mockImplementation(async () => {});
    avStub.calls.length = 0;
    avStub.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
  }

  // AVManager.dispose() leaves LiveKit before its teardown, bounded, and
  // disconnects the room itself after the bound (avManager.test.ts).
  it('disposes the manager, which leaves LiveKit, and drops the reference', async () => {
    const { view, avRef } = setup();
    await confirmJoin(view);
    const manager = avStub.instances[0];
    expect(avRef.current).toBe(manager);

    act(() => view.result.current.suspend());
    await settle();

    expect(avRef.current).toBeNull();
    expect(avStub.calls).toEqual(['dispose']);
  });

  it('blocks every connect path while suspended', async () => {
    const { view } = setup();
    act(() => view.result.current.suspend());

    await fireGesture();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      await view.result.current.connect();
    });

    expect(avStub.construct).not.toHaveBeenCalled();
  });

  it('rebuilds AV on resume the way a normal join does', async () => {
    const onConnected = vi.fn();
    const { view, avRef } = setup(onConnected);
    await confirmJoin(view);
    expect(onConnected).toHaveBeenCalledTimes(1);
    act(() => view.result.current.suspend());
    await settle();

    act(() => view.result.current.resume());
    await settle();

    expect(avStub.construct).toHaveBeenCalledTimes(2);
    expect(avStub.switchTo).toHaveBeenLastCalledWith('world');
    expect(avRef.current).toBe(avStub.instances[1]);
    expect(avRef.current?.room).toBeDefined();
    expect(onConnected).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild on a second resume without a new suspend', async () => {
    const { view } = setup();

    await confirmJoin(view);
    expect(avStub.construct).toHaveBeenCalledTimes(1);

    act(() => view.result.current.resume());
    await settle();

    expect(avStub.construct).toHaveBeenCalledTimes(1);
  });

  it('drops a connect suspended mid-handshake and resumes once it has unwound', async () => {
    let releaseJoin!: () => void;
    avStub.switchTo.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseJoin = resolve;
        }),
    );
    const failures = vi.spyOn(AVLogger, 'error');
    const onConnected = vi.fn();
    const { view, avRef } = setup(onConnected);
    // Start the join but keep it pending: the gate's resume begins the
    // normal connect, which blocks on the unreleased switchTo below.
    act(() => view.result.current.resume());
    const abandoned = avStub.instances[0];

    act(() => view.result.current.suspend());
    act(() => view.result.current.resume());
    await settle();
    expect(avStub.construct).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseJoin();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    expect(avRef.current).toBeNull();
    // The abandoned connect ends quietly: a suspend is no connection failure.
    expect(failures).not.toHaveBeenCalledWith('connection.failed', expect.anything());
    expect(onConnected).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await settle();

    expect(avStub.construct).toHaveBeenCalledTimes(2);
    expect(avRef.current).toBe(avStub.instances[1]);
    expect(avRef.current).not.toBe(abandoned);
    expect(onConnected).toHaveBeenCalledTimes(1);
    failures.mockRestore();
  });
});
