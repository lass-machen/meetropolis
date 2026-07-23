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

import { useDoNotDisturb } from './useDoNotDisturb';
import { readPersistedDnd } from '../features/dndPersistence';
import type { AVManager } from '../avManager';
import type { WorldRoom } from '../../types/colyseus';

function setup(avManagerPresent = true) {
  const setDoNotDisturb = vi.fn(async () => {});
  const avRef: React.MutableRefObject<AVManager | null> = {
    current: avManagerPresent ? ({ setDoNotDisturb } as unknown as AVManager) : null,
  };
  const dndRef: React.MutableRefObject<boolean> = { current: false };
  const send = vi.fn();
  const colyseusRef: React.MutableRefObject<WorldRoom | null> = {
    current: { send } as unknown as WorldRoom,
  };
  const setAvState = vi.fn();

  const view = renderHook(() => useDoNotDisturb({ enabled: true, avRef, dndRef, setAvState, colyseusRef }));
  return { view, avRef, dndRef, setAvState, send, setDoNotDisturb };
}

// act() returns a thenable; these callbacks are synchronous, so the result is
// intentionally discarded.
function toggleDnd(enabled: boolean): void {
  void act(() => {
    bridge.setDoNotDisturb(enabled);
  });
}

describe('useDoNotDisturb', () => {
  beforeEach(() => {
    window.localStorage.clear();
    bridge.setDoNotDisturb = vi.fn();
    bridge.setMovementLocked = vi.fn();
    vi.clearAllMocks();
  });

  it('persists DND so it survives a reload', () => {
    const { dndRef } = setup();

    // Toggling goes through the wrapped gameBridge funnel.
    toggleDnd(true);

    expect(dndRef.current).toBe(true);
    expect(readPersistedDnd()).toBe(true);
  });

  it('clears the persisted state when DND is switched off', () => {
    setup();
    toggleDnd(true);
    toggleDnd(false);
    expect(readPersistedDnd()).toBe(false);
  });
});
