import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';

// vi.mock is hoisted above the imports, so the shared bridge stub has to be
// hoisted with it.
const bridge = vi.hoisted(() => ({
  setDoNotDisturb: vi.fn(),
  setMovementLocked: vi.fn(),
}));
vi.mock('../../game/bridge', () => ({ gameBridge: bridge }));

import { useDndRestore } from './useDndRestore';
import { persistDnd } from '../features/dndPersistence';
import type { AVManager } from '../avManager';

function makeAvRef(present: boolean): React.MutableRefObject<AVManager | null> {
  return { current: present ? ({} as AVManager) : null };
}

describe('useDndRestore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    bridge.setDoNotDisturb = vi.fn();
    bridge.setMovementLocked = vi.fn();
    vi.clearAllMocks();
  });

  it('restores a persisted DND once the AVManager exists', () => {
    persistDnd(true);
    renderHook(() => useDndRestore(makeAvRef(true)));

    expect(bridge.setDoNotDisturb).toHaveBeenCalledWith(true);
    expect(bridge.setMovementLocked).toHaveBeenCalledWith(true, 'dnd');
  });

  it('does nothing when no DND was persisted', () => {
    renderHook(() => useDndRestore(makeAvRef(true)));
    expect(bridge.setDoNotDisturb).not.toHaveBeenCalled();
  });

  it('does not restore before the AVManager exists (side effects would be skipped)', () => {
    persistDnd(true);
    renderHook(() => useDndRestore(makeAvRef(false)));
    expect(bridge.setDoNotDisturb).not.toHaveBeenCalled();
  });

  it('restores when the callback fires later (AVManager onConnected)', () => {
    persistDnd(true);
    const avRef = makeAvRef(false);
    const { result } = renderHook(() => useDndRestore(avRef));

    expect(bridge.setDoNotDisturb).not.toHaveBeenCalled();

    avRef.current = {} as AVManager;
    act(() => result.current());

    expect(bridge.setDoNotDisturb).toHaveBeenCalledWith(true);
  });

  it('honours an opt-out made while waiting for the AVManager', () => {
    persistDnd(true);
    const avRef = makeAvRef(false);
    const { result } = renderHook(() => useDndRestore(avRef));

    // User switches DND off before the AVManager arrives; that explicit choice
    // must win over the pending restore.
    persistDnd(false);
    avRef.current = {} as AVManager;
    act(() => result.current());

    expect(bridge.setDoNotDisturb).not.toHaveBeenCalled();
  });

  it('restores at most once', () => {
    persistDnd(true);
    const avRef = makeAvRef(true);
    const { result } = renderHook(() => useDndRestore(avRef));

    act(() => result.current());
    act(() => result.current());

    expect(bridge.setDoNotDisturb).toHaveBeenCalledTimes(1);
  });
});
