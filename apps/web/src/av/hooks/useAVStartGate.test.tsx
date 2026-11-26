import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// Same stub convention as useAVManager.test.tsx: the hoisted fake stands in
// for the external LiveKit-backed AVManager SDK boundary (no SFK/network).
const avStub = vi.hoisted(() => {
  const construct = vi.fn();
  const switchTo = vi.fn(async (_roomName: string) => {});
  const instances: FakeAVManager[] = [];

  class FakeAVManager {
    room: { on: () => void } | undefined = undefined;
    leave = vi.fn(() => {
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

    dispose(): void {}
  }

  return { construct, switchTo, instances, FakeAVManager };
});
vi.mock('../avManager', () => ({ AVManager: avStub.FakeAVManager }));

// World-side unit mocks, same conventions as
// realtime/hooks/useColyseusConnection.test.ts: joinWorld is the controlled
// world boundary, overlays/i18n/icons only keep the import graph loadable.
const worldJoins = vi.hoisted(() => ({ joinWorld: vi.fn() }));
vi.mock('../../lib/colyseus', () => ({
  deriveTenant: () => 'workspace',
  joinWorld: worldJoins.joinWorld,
}));
vi.mock('../../lib/desktopLoader', () => ({ getDesktopModule: () => Promise.resolve(null) }));
vi.mock('../../lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../state/mapStore', () => ({
  useMapStore: { getState: () => ({ currentMapName: null }) },
}));
vi.mock('../../realtime/handlers/sessionDialogs', () => ({
  showServerRestartDialog: vi.fn(),
  showReconnectFailedDialog: vi.fn(),
}));
vi.mock('../../realtime/hooks/connectionOverlays', () => ({
  showGuestExpiredOverlay: vi.fn(),
  showAuthExpiredOverlay: vi.fn(),
  showClientTooOldOverlay: vi.fn(),
  showSessionTakenOverOverlay: vi.fn(),
  showLimitErrorOverlay: vi.fn(),
  showTranscriptionConsentOverlay: vi.fn(),
}));
vi.mock('react-dom/server', () => ({ renderToStaticMarkup: () => '<svg></svg>' }));
vi.mock('lucide-react', () => ({ Timer: 'Timer', Plug: 'Plug', TriangleAlert: 'TriangleAlert' }));
vi.mock('../../app/providers/i18n', () => ({ default: { t: (key: string) => key } }));

import { useAVManager } from './useAVManager';
import type { AVManager } from '../avManager';
import { performConnect, performHandleLeave } from '../../realtime/hooks/useColyseusConnection';
import type { ConnectionRefs } from '../../realtime/types';
import type { WorldRoom } from '../../types/colyseus';

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

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('useAVManager start gate (confirmed world join)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    avStub.construct.mockClear();
    avStub.switchTo.mockClear();
    avStub.switchTo.mockImplementation(async () => {});
    avStub.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not auto-connect on the 300 ms timer before the world confirmed the join', async () => {
    setup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await settle();

    expect(avStub.construct).not.toHaveBeenCalled();
  });

  it('does not connect on the first gesture before the world confirmed the join', async () => {
    setup();

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(avStub.construct).not.toHaveBeenCalled();
  });

  it('does not connect on a manual connect() before the world confirmed the join', async () => {
    const { view } = setup();

    await act(async () => {
      await view.result.current.connect();
    });

    expect(avStub.construct).not.toHaveBeenCalled();
  });

  it('connects the normal way once the confirmed join resumes AV', async () => {
    const onConnected = vi.fn();
    const { view, avRef } = setup(onConnected);

    act(() => view.result.current.resume());
    await settle();

    expect(avStub.construct).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledWith('world');
    expect(avRef.current).toBe(avStub.instances[0]);
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});

describe('start-gate seam (world join <-> AV gate)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    worldJoins.joinWorld.mockReset();
    avStub.construct.mockClear();
    avStub.switchTo.mockClear();
    avStub.switchTo.mockImplementation(async () => {});
    avStub.instances.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setupSeam() {
    const { view, avRef } = setup();
    const refs: ConnectionRefs = {
      reconnectAttemptsRef: { current: 0 },
      reconnectTimerRef: { current: null },
      lastCloseInfoRef: { current: {} },
      connectingRef: { current: false },
      coolDownUntilRef: { current: 0 },
      hasReceivedFullStateRef: { current: false },
      terminalOverlayRef: { current: false },
    };
    const colyseusRef: { current: WorldRoom | null } = { current: null };
    // The production seam: the world's resume/suspend drive the real hook.
    const seam = {
      suspendAv: () => view.result.current.suspend(),
      resumeAv: () => view.result.current.resume(),
    };
    const baseArgs = {
      apiBase: 'http://localhost:3000',
      me: { id: 'u1', email: 'u1@example.test', name: 'User One' },
      localPosRef: { current: { x: 1, y: 2 } },
      colyseusRef,
      dndRef: { current: false },
      setConnectionStatus: vi.fn(),
      refs,
      scheduleReconnect: vi.fn(() => undefined),
      ...seam,
    } as unknown as Parameters<typeof performConnect>[2];
    const leaveArgs = () => ({
      refs,
      colyseusRef,
      suspendAv: seam.suspendAv,
      scheduleReconnect: baseArgs.scheduleReconnect,
      resetRefsBeforeReconnect: () => {
        refs.hasReceivedFullStateRef.current = false;
      },
    });
    return { view, avRef, refs, colyseusRef, seam, baseArgs, leaveArgs };
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  }

  it('starts AV only behind the confirmed join and suspends it on world loss', async () => {
    const { view, avRef, colyseusRef, baseArgs, leaveArgs } = setupSeam();
    const onWorldConnected = vi.fn();

    // Before any join: auto timer, gesture and manual connect stay quiet.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    await act(async () => {
      await view.result.current.connect();
    });
    expect(avStub.construct).not.toHaveBeenCalled();

    // A pending join is no confirmation either.
    let releaseJoin!: (room: WorldRoom) => void;
    worldJoins.joinWorld.mockImplementationOnce(
      () =>
        new Promise<WorldRoom>((resolve) => {
          releaseJoin = resolve;
        }),
    );
    const joinPromise = performConnect(false, onWorldConnected, baseArgs);
    await flush();
    expect(avStub.construct).not.toHaveBeenCalled();

    // The resolved join confirms the world: the real resume starts AV.
    const room = { sessionId: 's1', leave: vi.fn() } as unknown as WorldRoom;
    await act(async () => {
      releaseJoin(room);
      await joinPromise;
    });
    await flush();
    expect(onWorldConnected).toHaveBeenCalledWith(room);
    expect(colyseusRef.current).toBe(room);
    expect(avStub.construct).toHaveBeenCalledTimes(1);
    expect(avStub.switchTo).toHaveBeenCalledWith('world');
    expect(avRef.current).not.toBeNull();

    // The real world loss suspends the real hook: no room, no AV.
    const onReconnect = vi.fn();
    performHandleLeave(1006, false, onReconnect, leaveArgs());
    expect(colyseusRef.current).toBeNull();
    expect(avRef.current).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });
    await act(async () => {
      await view.result.current.connect();
    });
    expect(avStub.construct).toHaveBeenCalledTimes(1);

    // Only a renewed confirmation rejoins AV.
    const room2 = { sessionId: 's2', leave: vi.fn() } as unknown as WorldRoom;
    worldJoins.joinWorld.mockResolvedValueOnce(room2);
    await act(async () => {
      await performConnect(false, onWorldConnected, { ...baseArgs, onReconnect });
    });
    await flush();
    expect(avStub.construct).toHaveBeenCalledTimes(2);
    expect(avRef.current).not.toBeNull();
  });
});
